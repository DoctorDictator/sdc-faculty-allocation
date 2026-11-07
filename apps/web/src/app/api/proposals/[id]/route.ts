import { NextResponse } from "next/server";
import { hodUser } from "@/lib/access";
import { loadOptimizationSnapshot, snapshotHash } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const REST_MINUTES = 30;

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can review proposal details." }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid proposal ID." }, { status: 400 });
  const proposal = await prisma.scheduleVersion.findUnique({
    where: { id },
    include: {
      assignments: { include: { faculty: true, duty: { include: { event: true } } } },
      parent: { include: { assignments: { include: { faculty: true, duty: { include: { event: true } } } } } },
    },
  });
  if (!proposal) return NextResponse.json({ error: "Schedule proposal was not found." }, { status: 404 });

  const [faculty, blocks] = await Promise.all([
    prisma.faculty.findMany(),
    prisma.availabilityBlock.findMany(),
  ]);
  const facultyById = new Map(faculty.map((person) => [person.id, person]));
  const proposedByDuty = new Map(proposal.assignments.map((assignment) => [assignment.dutyId, assignment]));
  const previousByDuty = new Map((proposal.parent?.assignments ?? []).map((assignment) => [assignment.dutyId, assignment]));
  const objective = proposal.objectiveJson as {
    mode?: string;
    lexicographicComplete?: boolean;
    objectiveLevels?: Array<{ objective: string; value?: number; status: string }>;
    uncovered?: Array<{ duty_id: string; role: string; event_name: string; reason: string }>;
    solverStats?: Record<string, number>;
  } | null;
  const { input } = await loadOptimizationSnapshot(proposal.parentId, "REPAIR");
  const isStale = snapshotHash(input) !== proposal.snapshotHash;
  const uncovered = objective?.uncovered ?? [];
  const uncoveredByDuty = new Map(uncovered.map((item) => [item.duty_id, item]));
  const proposedWorkload = new Map<string, number>();
  const proposedDutiesByFaculty = new Map<string, typeof proposal.assignments>();
  for (const assignment of proposal.assignments) {
    if (assignment.duty.event.status === "CANCELLED" || assignment.duty.event.status === "COMPLETED" || assignment.duty.event.endsAt < new Date()) continue;
    proposedWorkload.set(
      assignment.facultyId,
      (proposedWorkload.get(assignment.facultyId) ?? facultyById.get(assignment.facultyId)?.committedMinutes ?? 0) + assignment.duty.minutes,
    );
    const personDuties = proposedDutiesByFaculty.get(assignment.facultyId) ?? [];
    personDuties.push(assignment);
    proposedDutiesByFaculty.set(assignment.facultyId, personDuties);
  }

  const allDutyIds = new Set([...previousByDuty.keys(), ...proposedByDuty.keys()]);
  const changes = [...allDutyIds].flatMap((dutyId) => {
    const previous = previousByDuty.get(dutyId);
    const next = proposedByDuty.get(dutyId);
    if (previous?.facultyId === next?.facultyId) return [];
    const dutyAssignment = next ?? previous;
    if (!dutyAssignment) return [];
    const duty = dutyAssignment.duty;
    const oldFaculty = previous?.faculty ?? null;
    const newFaculty = next?.faculty ?? null;
    let reason = "Added as a new role in this schedule.";
    if (!next && duty.event.status === "CANCELLED") {
      reason = "Removed because the event was cancelled.";
    } else if (!next) {
      reason = uncoveredByDuty.get(dutyId)?.reason ?? "No eligible faculty member could cover this role.";
    } else if (oldFaculty && oldFaculty.id !== newFaculty?.id) {
      const unavailable = blocks.some(
        (block) => block.facultyId === oldFaculty.id && overlaps(
          duty.event.startsAt,
          duty.event.endsAt,
          new Date(block.startsAt.getTime() - REST_MINUTES * 60_000),
          new Date(block.endsAt.getTime() + REST_MINUTES * 60_000),
        ),
      );
      const hasSkill = !duty.requiredSkill || oldFaculty.skills.some((skill) => skill.toLowerCase() === duty.requiredSkill?.toLowerCase());
      const conflictingDuty = (proposedDutiesByFaculty.get(oldFaculty.id) ?? []).find(
        (assignment) => assignment.dutyId !== dutyId && overlaps(
          duty.event.startsAt,
          new Date(duty.event.endsAt.getTime() + REST_MINUTES * 60_000),
          assignment.duty.event.startsAt,
          new Date(assignment.duty.event.endsAt.getTime() + REST_MINUTES * 60_000),
        ),
      );
      const workloadWouldExceed = (proposedWorkload.get(oldFaculty.id) ?? oldFaculty.committedMinutes) + duty.minutes > oldFaculty.maxMinutes;
      if (!oldFaculty.active) reason = `${oldFaculty.name} is inactive for new assignments.`;
      else if (!hasSkill) reason = `${oldFaculty.name} no longer meets the ${duty.requiredSkill} qualification.`;
      else if (unavailable) reason = `${oldFaculty.name} is unavailable during this event.`;
      else if (conflictingDuty) reason = `${oldFaculty.name} has an overlapping assignment for ${conflictingDuty.duty.event.name}.`;
      else if (workloadWouldExceed) reason = `Keeping ${oldFaculty.name} on this role would exceed the maximum workload.`;
      else reason = "Reassigned to improve workload balance or preference fit after coverage and policy constraints were satisfied.";
    } else if (!oldFaculty) {
      reason = "Previously uncovered role assigned in this proposal.";
    }
    return [{
      dutyId,
      eventName: duty.event.name,
      role: duty.role,
      startsAt: duty.event.startsAt,
      priority: duty.event.priority,
      from: oldFaculty ? { id: oldFaculty.id, name: oldFaculty.name } : null,
      to: newFaculty ? { id: newFaculty.id, name: newFaculty.name } : null,
      protected: previous?.protected ?? false,
      reason,
    }];
  }).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const assignments = proposal.assignments
    .filter((assignment) => assignment.duty.event.status !== "CANCELLED" && assignment.duty.event.status !== "COMPLETED" && assignment.duty.event.endsAt >= new Date())
    .map((assignment) => ({
      dutyId: assignment.dutyId,
      eventName: assignment.duty.event.name,
      role: assignment.duty.role,
      requiredSkill: assignment.duty.requiredSkill,
      startsAt: assignment.duty.event.startsAt,
      endsAt: assignment.duty.event.endsAt,
      priority: assignment.duty.event.priority,
      facultyId: assignment.facultyId,
      facultyName: assignment.faculty.name,
      protected: assignment.protected,
      acknowledged: assignment.acknowledged,
    }))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return NextResponse.json({
    id: proposal.id,
    status: proposal.status,
    solverStatus: proposal.solverStatus,
    createdAt: proposal.createdAt,
    createdBy: proposal.createdBy,
    parentId: proposal.parentId,
    isStale,
    mode: objective?.mode ?? "ALLOCATE",
    lexicographicComplete: objective?.lexicographicComplete ?? false,
    objectiveLevels: objective?.objectiveLevels ?? [],
    solverStats: objective?.solverStats ?? {},
    assignments,
    changes,
    uncovered,
  });
}
