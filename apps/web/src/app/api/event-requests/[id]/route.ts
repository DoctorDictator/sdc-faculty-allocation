import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    approvedRole: z.string().trim().min(2).max(80),
    approvedCount: z.number().int().min(1).max(30),
    requiredSkill: z.string().trim().max(80).optional(),
    responseNote: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("decline"),
    responseNote: z.string().trim().max(500).optional(),
  }),
]);

function validateEventTime(startsAt: Date, endsAt: Date) {
  if (startsAt <= new Date()) return "This event date has passed. Ask the faculty member to submit a new request.";
  if (endsAt <= startsAt) return "End time must be after start time.";
  if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60_000) return "An event can last at most 24 hours.";
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "HOD") return NextResponse.json({ error: "Only the HOD can review staffing requests." }, { status: 403 });

  const { id } = await context.params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the staffing decision and approved role details." }, { status: 400 });
  const data = parsed.data;
  const existing = await prisma.eventStaffingRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Staffing request not found." }, { status: 404 });
  if (existing.status !== "PENDING") return NextResponse.json({ error: "This staffing request has already been reviewed." }, { status: 409 });

  const responseNote = data.responseNote || null;
  if (data.action === "decline") {
    const updated = await prisma.eventStaffingRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "DECLINED", responseNote, reviewedBy: user.name ?? "HOD", reviewedAt: new Date() },
    });
    if (!updated.count) return NextResponse.json({ error: "This staffing request has already been reviewed." }, { status: 409 });
    return NextResponse.json({ status: "DECLINED" });
  }

  const timeError = validateEventTime(existing.startsAt, existing.endsAt);
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });
  const requiredSkill = data.requiredSkill?.toLowerCase() || null;
  const minutes = Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000);

  try {
    const event = await prisma.$transaction(async (tx) => {
      const claimed = await tx.eventStaffingRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          approvedRole: data.approvedRole,
          approvedCount: data.approvedCount,
          requiredSkill,
          responseNote,
          reviewedBy: user.name ?? "HOD",
          reviewedAt: new Date(),
        },
      });
      if (!claimed.count) throw new Error("STAFFING_REQUEST_ALREADY_REVIEWED");

      const createdEvent = await tx.event.create({
        data: {
          name: existing.eventName,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          priority: 1,
          duties: {
            create: Array.from({ length: data.approvedCount }, (_, index) => ({
              role: data.approvedRole,
              requiredSkill,
              positionIndex: index + 1,
              minutes,
            })),
          },
        },
        select: { id: true, name: true },
      });

      await tx.eventStaffingRequest.update({ where: { id }, data: { eventId: createdEvent.id } });
      await tx.disruption.create({
        data: {
          type: "EVENT_CHANGE",
          eventId: createdEvent.id,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          reason: `Event staffing request approved by ${user.name ?? "HOD"}`,
          metadata: { action: "create", eventRequestId: id },
        },
      });
      return createdEvent;
    });
    return NextResponse.json({ status: "APPROVED", event });
  } catch (error) {
    if (error instanceof Error && error.message === "STAFFING_REQUEST_ALREADY_REVIEWED") {
      return NextResponse.json({ error: "This staffing request has already been reviewed." }, { status: 409 });
    }
    console.error("Event staffing request approval failed", error);
    return NextResponse.json({ error: "Could not approve this staffing request." }, { status: 500 });
  }
}
