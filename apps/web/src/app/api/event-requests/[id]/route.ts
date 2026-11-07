import { NextResponse } from "next/server";
import { hodUser } from "@/lib/access";
import { createLatestOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can retry an allocation." }, { status: 403 });
  const { id } = await context.params;
  const staffingRequest = await prisma.eventStaffingRequest.findUnique({ where: { id } });
  if (!staffingRequest || staffingRequest.status !== "PENDING") {
    return NextResponse.json({ error: "This staffing request is no longer awaiting allocation." }, { status: 404 });
  }
  if (staffingRequest.proposalId) return NextResponse.json({ error: "This request already has an allocation proposal." }, { status: 409 });
  if (staffingRequest.startsAt <= new Date()) return NextResponse.json({ error: "This event date has passed. The faculty member must submit a new request." }, { status: 400 });

  let eventId = staffingRequest.eventId;
  if (!eventId) {
    const minutes = Math.round((staffingRequest.endsAt.getTime() - staffingRequest.startsAt.getTime()) / 60_000);
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          name: staffingRequest.eventName,
          startsAt: staffingRequest.startsAt,
          endsAt: staffingRequest.endsAt,
          priority: 1,
          duties: { create: Array.from({ length: staffingRequest.requestedCount }, (_, index) => ({
            role: staffingRequest.requestedRole,
            positionIndex: index + 1,
            minutes,
          })) },
        },
        select: { id: true },
      });
      await tx.eventStaffingRequest.update({ where: { id }, data: { eventId: created.id } });
      await tx.disruption.create({
        data: {
          type: "EVENT_CHANGE",
          eventId: created.id,
          startsAt: staffingRequest.startsAt,
          endsAt: staffingRequest.endsAt,
          reason: `Legacy staffing request prepared by ${user.name ?? "HOD"}`,
          metadata: { action: "request", eventRequestId: id },
        },
      });
      return created;
    });
    eventId = event.id;
  }

  try {
    const { result, proposal } = await createLatestOptimizationProposal({
      createdBy: user.name ?? "HOD",
      staffingRequestId: id,
    });
    if (!proposal) return NextResponse.json({ error: `Optimizer returned ${result.status}. Review the event and try again.` }, { status: 422 });
    return NextResponse.json({ proposalId: proposal.id }, { status: 201 });
  } catch (error) {
    console.error("Staffing request allocation retry failed", error);
    return NextResponse.json({ error: "The optimizer could not create a proposal. Check that the service is running." }, { status: 503 });
  }
}
