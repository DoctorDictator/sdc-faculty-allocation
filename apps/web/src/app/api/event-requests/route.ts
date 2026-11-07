import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { createLatestOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({
  eventName: z.string().trim().min(3).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  requestedRole: z.string().trim().min(2).max(80),
  requestedCount: z.number().int().min(1).max(30),
  reason: z.string().trim().max(500).optional(),
  preferredFacultyIds: z.array(z.string().min(1)).max(30).default([]),
});

function validateEventTime(startsAt: Date, endsAt: Date) {
  if (startsAt <= new Date()) return "Choose a future event start time.";
  if (endsAt <= startsAt) return "End time must be after start time.";
  if (endsAt.getTime() - startsAt.getTime() < 60_000) return "The event must last at least one minute.";
  if (endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60_000) return "An event can last at most 24 hours.";
  return null;
}

export async function GET() {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const requests = await prisma.eventStaffingRequest.findMany({
    where: user.role === "HOD" ? {} : { requesterId: user.facultyId ?? "" },
    include: {
      requester: { select: { id: true, name: true, employeeCode: true } },
      event: { select: { id: true, name: true } },
      proposal: { select: { id: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "FACULTY" || !user.facultyId) {
    return NextResponse.json({ error: "A faculty sign-in is required to request event staffing." }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the event details and number of people requested." }, { status: 400 });
  const data = parsed.data;
  const timeError = validateEventTime(data.startsAt, data.endsAt);
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });

  if (new Set(data.preferredFacultyIds).size !== data.preferredFacultyIds.length) {
    return NextResponse.json({ error: "Choose each preferred faculty member only once." }, { status: 400 });
  }
  const preferredFaculty = await prisma.faculty.findMany({
    where: { id: { in: data.preferredFacultyIds }, active: true },
    select: { id: true, name: true },
  });
  if (preferredFaculty.length !== data.preferredFacultyIds.length) {
    return NextResponse.json({ error: "One or more preferred faculty members are no longer active." }, { status: 400 });
  }

  const minutes = Math.round((data.endsAt.getTime() - data.startsAt.getTime()) / 60_000);
  const staffingRequest = await prisma.$transaction(async (tx) => {
    const createdRequest = await tx.eventStaffingRequest.create({
      data: {
        requesterId: user.facultyId!,
        eventName: data.eventName,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        requestedRole: data.requestedRole,
        requestedCount: data.requestedCount,
        reason: data.reason || null,
        assignedFacultyNames: preferredFaculty.map((person) => person.name),
      },
    });
    const event = await tx.event.create({
      data: {
        name: data.eventName,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        priority: 1,
        duties: {
          create: Array.from({ length: data.requestedCount }, (_, index) => ({
            role: data.requestedRole,
            positionIndex: index + 1,
            minutes,
            ...(preferredFaculty.length ? {
              preferences: { create: preferredFaculty.map((person) => ({ facultyId: person.id, cost: 0 })) },
            } : {}),
          })),
        },
      },
      select: { id: true },
    });
    await tx.eventStaffingRequest.update({ where: { id: createdRequest.id }, data: { eventId: event.id } });
    await tx.disruption.create({
      data: {
        type: "EVENT_CHANGE",
        eventId: event.id,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: `Staffing request submitted by ${user.name ?? "faculty"}`,
        metadata: { action: "request", eventRequestId: createdRequest.id },
      },
    });
    return createdRequest;
  });

  try {
    const { result, proposal } = await createLatestOptimizationProposal({
      createdBy: user.name ?? "Faculty",
      staffingRequestId: staffingRequest.id,
    });
    if (!proposal) {
      return NextResponse.json({
        request: staffingRequest,
        proposalId: null,
        warning: `The request was saved, but the optimizer returned ${result.status}. The HOD can retry allocation from the dashboard.`,
      }, { status: 201 });
    }
    return NextResponse.json({ request: staffingRequest, proposalId: proposal.id }, { status: 201 });
  } catch (error) {
    console.error("Staffing request proposal generation failed", error);
    return NextResponse.json({
      request: staffingRequest,
      proposalId: null,
      warning: "The request was saved, but allocation could not run. The HOD can retry from the dashboard.",
    }, { status: 201 });
  }
}
