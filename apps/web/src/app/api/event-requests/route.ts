import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({
  eventName: z.string().trim().min(3).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  requestedRole: z.string().trim().min(2).max(80),
  requestedCount: z.number().int().min(1).max(30),
  reason: z.string().trim().max(500).optional(),
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

  const staffingRequest = await prisma.eventStaffingRequest.create({
    data: {
      requesterId: user.facultyId,
      eventName: data.eventName,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      requestedRole: data.requestedRole,
      requestedCount: data.requestedCount,
      reason: data.reason || null,
    },
    select: { id: true, eventName: true, requestedCount: true, requestedRole: true, status: true },
  });
  return NextResponse.json({ request: staffingRequest }, { status: 201 });
}
