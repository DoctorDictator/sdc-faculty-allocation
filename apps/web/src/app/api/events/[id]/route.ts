import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { createOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("reschedule"),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    priority: z.number().int().min(1).max(3).optional(),
  }),
]);

class EventChangeConflict extends Error {}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can change an event." }, { status: 403 });
  const { id } = await context.params;
  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the event change details." }, { status: 400 });
  if (parsed.data.action === "reschedule" && (parsed.data.endsAt <= parsed.data.startsAt || parsed.data.startsAt <= new Date())) {
    return NextResponse.json({ error: "Choose a future start time and an end time after it." }, { status: 400 });
  }
  if (parsed.data.action === "reschedule" && parsed.data.endsAt.getTime() - parsed.data.startsAt.getTime() < 60_000) {
    return NextResponse.json({ error: "An event must last at least one minute." }, { status: 400 });
  }
  if (parsed.data.action === "reschedule" && parsed.data.endsAt.getTime() - parsed.data.startsAt.getTime() > 24 * 60 * 60_000) {
    return NextResponse.json({ error: "A duty event can last at most 24 hours. Split longer activities into separate events." }, { status: 400 });
  }
  let updated: { id: string; name: string };
  let disruption: { id: string };
  try {
    ({ updated, disruption } = await prisma.$transaction(async (tx) => {
      const existing = await tx.event.findUnique({ where: { id }, select: { id: true, name: true, startsAt: true, endsAt: true, status: true, priority: true } });
      if (!existing) throw new EventChangeConflict("Event was not found.");
      if (existing.endsAt < new Date() || existing.status === "COMPLETED" || existing.status === "CANCELLED") {
        throw new EventChangeConflict("Past or closed events cannot be changed.");
      }
      let updated: { id: string; name: string };
      if (parsed.data.action === "cancel") {
        updated = await tx.event.update({ where: { id }, data: { status: "CANCELLED" }, select: { id: true, name: true } });
      } else {
        const minutes = Math.round((parsed.data.endsAt.getTime() - parsed.data.startsAt.getTime()) / 60_000);
        updated = await tx.event.update({
          where: { id },
          data: {
            startsAt: parsed.data.startsAt,
            endsAt: parsed.data.endsAt,
            priority: parsed.data.priority ?? existing.priority,
            duties: { updateMany: { where: { eventId: id }, data: { minutes } } },
          },
          select: { id: true, name: true },
        });
      }
      const disruption = await tx.disruption.create({
        data: {
          type: "EVENT_CHANGE",
          eventId: id,
          startsAt: parsed.data.action === "reschedule" ? parsed.data.startsAt : existing.startsAt,
          endsAt: parsed.data.action === "reschedule" ? parsed.data.endsAt : existing.endsAt,
          reason: parsed.data.action === "cancel" ? "Event cancelled" : "Event rescheduled",
          metadata: { action: parsed.data.action },
        },
        select: { id: true },
      });
      return { updated, disruption };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof EventChangeConflict) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Event was not found." ? 404 : 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "The event changed while you were editing it. Refresh and try again." }, { status: 409 });
    }
    throw error;
  }
  const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
  let proposalId: number | null = null;
  let optimizerStatus: string | null = null;
  try {
    const { result, proposal } = await createOptimizationProposal({
      baseVersionId: current?.id ?? null,
      mode: current ? "REPAIR" : "ALLOCATE",
      createdBy: user.name ?? "HOD",
    });
    proposalId = proposal?.id ?? null;
    optimizerStatus = result.status;
    await prisma.disruption.update({
      where: { id: disruption.id },
      data: { proposedVersionId: proposalId, metadata: { action: parsed.data.action, optimizerStatus } },
    });
  } catch (error) {
    console.error("Event reallocation failed", error);
    await prisma.disruption.update({
      where: { id: disruption.id },
      data: { metadata: { action: parsed.data.action, optimizerStatus: "ERROR" } },
    });
    return NextResponse.json({ event: updated, disruptionId: disruption.id, warning: "Event changed, but the optimizer could not create a proposal." }, { status: 202 });
  }
  return NextResponse.json({
    event: updated,
    disruptionId: disruption.id,
    proposalId,
    optimizerStatus,
    warning: proposalId ? undefined : `Optimizer returned ${optimizerStatus}; no proposal could be created.`,
  }, { status: proposalId ? 200 : 202 });
}
