import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { createLatestOptimizationProposal } from "@/lib/optimization";

const eventSchema = z.object({
  name: z.string().trim().min(3).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  priority: z.number().int().min(1).max(3).default(1),
  roles: z.array(z.object({
    role: z.string().trim().min(2).max(80),
    requiredSkill: z.string().trim().min(2).max(80),
    count: z.number().int().min(1).max(10),
    facultyIds: z.array(z.string().min(1)).max(10).default([]),
  })).min(1).max(8).refine(
    (roles) => new Set(roles.map((role) => role.role.toLowerCase())).size === roles.length,
    "Use one row per role and set its staffing count in the quantity field.",
  ),
});

export async function POST(request: Request) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can add an event." }, { status: 403 });
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the event details and role requirements." }, { status: 400 });
  const data = parsed.data;
  if (data.startsAt <= new Date()) return NextResponse.json({ error: "Choose a future event start time." }, { status: 400 });
  if (data.endsAt <= data.startsAt) return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  if (data.endsAt.getTime() - data.startsAt.getTime() < 60_000) return NextResponse.json({ error: "An event must last at least one minute." }, { status: 400 });
  if (data.endsAt.getTime() - data.startsAt.getTime() > 24 * 60 * 60_000) {
    return NextResponse.json({ error: "A duty event can last at most 24 hours. Split longer activities into separate events." }, { status: 400 });
  }
  const minutes = Math.round((data.endsAt.getTime() - data.startsAt.getTime()) / 60_000);
  const selectedIds = data.roles.flatMap((role) => role.facultyIds);
  if (data.roles.some((role) => role.facultyIds.length > role.count || new Set(role.facultyIds).size !== role.facultyIds.length)) {
    return NextResponse.json({ error: "Each role can have up to its headcount of selected faculty, with no duplicates." }, { status: 400 });
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    return NextResponse.json({ error: "Select a faculty member for only one role at this event." }, { status: 400 });
  }
  const selectedFaculty = await prisma.faculty.findMany({ where: { id: { in: selectedIds }, active: true } });
  if (selectedFaculty.length !== selectedIds.length) {
    return NextResponse.json({ error: "One or more selected faculty members are no longer active." }, { status: 400 });
  }
  const selectedById = new Map(selectedFaculty.map((person) => [person.id, person]));
  for (const role of data.roles) {
    const unqualified = role.facultyIds.find((facultyId) => {
      const person = selectedById.get(facultyId);
      return !person?.skills.some((skill) => skill.toLowerCase() === role.requiredSkill.toLowerCase());
    });
    if (unqualified) {
      return NextResponse.json({ error: `Selected faculty must have the ${role.requiredSkill} skill for ${role.role}.` }, { status: 400 });
    }
  }
  const { event, disruption } = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        name: data.name,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        priority: data.priority,
        duties: {
          create: data.roles.flatMap((role) =>
            Array.from({ length: role.count }, (_, index) => ({
              role: role.role,
              requiredSkill: role.requiredSkill.toLowerCase(),
              forcedFacultyId: role.facultyIds[index] ?? null,
              positionIndex: index + 1,
              minutes,
            })),
          ),
        },
      },
      select: { id: true, name: true },
    });
    const disruption = await tx.disruption.create({
      data: {
        type: "EVENT_CHANGE",
        eventId: event.id,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: `New event added by ${user.name ?? "HOD"}`,
        metadata: { action: "create" },
      },
    });
    return { event, disruption };
  });
  try {
    const { result, proposal } = await createLatestOptimizationProposal({ createdBy: user.name ?? "HOD" });
    if (!proposal) {
      return NextResponse.json({
        event,
        disruptionId: disruption.id,
        proposalId: null,
        warning: `The event was saved, but the optimizer returned ${result.status}. Adjust the selections and run allocation again.`,
      }, { status: 201 });
    }
    return NextResponse.json({ event, disruptionId: disruption.id, proposalId: proposal.id }, { status: 201 });
  } catch (error) {
    console.error("Event proposal generation failed", error);
    return NextResponse.json({
      event,
      disruptionId: disruption.id,
      proposalId: null,
      warning: "The event was saved, but allocation could not run. Try generating a proposal from the dashboard.",
    }, { status: 201 });
  }
}
