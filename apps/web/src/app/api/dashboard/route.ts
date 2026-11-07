import { NextResponse } from "next/server";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { schedulingHorizonDays } from "@/lib/optimization";

export const dynamic = "force-dynamic";

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

async function optimizerIsAvailable() {
  const baseUrl = process.env.OPTIMIZER_URL || "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${baseUrl}/health`, { cache: "no-store", signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const isHod = user.role === "HOD";
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + schedulingHorizonDays() * 24 * 60 * 60 * 1000);
  const [allFaculty, allEvents, published, optimizerOnline] = await Promise.all([
    prisma.faculty.findMany({
      where: isHod ? {} : { id: user.facultyId ?? "" },
      include: { user: { select: { email: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.event.findMany({
      where: { status: { notIn: ["CANCELLED", "COMPLETED"] }, endsAt: { gte: now } },
      include: { duties: { include: { preferences: true }, orderBy: [{ role: "asc" }, { positionIndex: "asc" }] } },
      orderBy: [{ startsAt: "asc" }, { name: "asc" }],
    }),
    prisma.scheduleVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { id: "desc" },
      include: {
        assignments: {
          include: { faculty: true, duty: { include: { event: true } } },
        },
      },
    }),
    optimizerIsAvailable(),
  ]);
  const allAssignments = published?.assignments ?? [];
  const visibleAssignments = isHod
    ? allAssignments
    : allAssignments.filter((assignment) => assignment.facultyId === user.facultyId);
  const visibleEvents = isHod
    ? allEvents
    : allEvents.filter((event) => visibleAssignments.some((assignment) => assignment.duty.eventId === event.id));
  const visibleDutyIds = new Set(visibleEvents.flatMap((event) => event.duties.map((duty) => duty.id)));
  const planningDutyIds = new Set(visibleEvents
    .filter((event) => event.startsAt <= horizonEnd)
    .flatMap((event) => event.duties.map((duty) => duty.id)));
  const scheduledNow = visibleAssignments.filter((assignment) => planningDutyIds.has(assignment.dutyId));
  const conflictPairs = new Set<string>();
  for (let firstIndex = 0; firstIndex < scheduledNow.length; firstIndex += 1) {
    const first = scheduledNow[firstIndex];
    for (const second of scheduledNow.slice(firstIndex + 1)) {
      if (
        first.facultyId === second.facultyId &&
        overlaps(
          first.duty.event.startsAt,
          new Date(first.duty.event.endsAt.getTime() + 30 * 60_000),
          second.duty.event.startsAt,
          new Date(second.duty.event.endsAt.getTime() + 30 * 60_000),
        )
      ) {
        conflictPairs.add(`${first.dutyId}:${second.dutyId}`);
      }
    }
  }
  const facultyRows = allFaculty.map((person) => {
    const assignments = visibleAssignments.filter((assignment) => assignment.facultyId === person.id && planningDutyIds.has(assignment.dutyId));
    const workloadMinutes = person.committedMinutes + assignments.reduce((sum, assignment) => sum + assignment.duty.minutes, 0);
    return {
      id: person.id,
      employeeCode: person.employeeCode,
      name: person.name,
      title: person.title,
      department: person.department,
      skills: person.skills,
      active: person.active,
      hasLogin: Boolean(person.user),
      loginEmail: isHod ? person.user?.email ?? null : null,
      targetMinutes: person.targetMinutes,
      maxMinutes: person.maxMinutes,
      committedMinutes: person.committedMinutes,
      workloadMinutes,
      assignmentCount: assignments.length,
    };
  });
  const events = visibleEvents.map((event) => {
    const eventAssignments = allAssignments.filter((assignment) => assignment.duty.eventId === event.id);
    return {
      id: event.id,
      name: event.name,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      priority: event.priority,
      status: event.status,
      inPlanningWindow: event.startsAt <= horizonEnd,
      dutyCount: event.duties.length,
      assignedCount: eventAssignments.length,
      duties: event.duties.map((duty) => {
        const assignment = eventAssignments.find((item) => item.dutyId === duty.id);
        return {
          id: duty.id,
          role: duty.role,
          requiredSkill: duty.requiredSkill,
          positionIndex: duty.positionIndex,
          minutes: duty.minutes,
          facultyId: assignment && (isHod || assignment.facultyId === user.facultyId) ? assignment.facultyId : null,
          assignmentId: assignment && (isHod || assignment.facultyId === user.facultyId) ? assignment.id : null,
          protected: assignment && (isHod || assignment.facultyId === user.facultyId) ? assignment.protected : false,
          acknowledged: assignment && (isHod || assignment.facultyId === user.facultyId) ? assignment.acknowledged : false,
          facultyName: assignment && (isHod || assignment.facultyId === user.facultyId) ? assignment.faculty.name : null,
          assignedElsewhere: Boolean(assignment && !isHod && assignment.facultyId !== user.facultyId),
        };
      }),
    };
  });
  const preferences = !isHod && user.facultyId
    ? allEvents.flatMap((event) => event.duties.map((duty) => ({
        dutyId: duty.id,
        eventName: event.name,
        startsAt: event.startsAt,
        role: duty.role,
        positionIndex: duty.positionIndex,
        cost: duty.preferences.find((preference) => preference.facultyId === user.facultyId)?.cost ?? 5,
      })))
    : [];
  const planningEvents = events.filter((event) => event.inPlanningWindow);
  const dutiesCount = planningEvents.reduce((sum, event) => sum + event.dutyCount, 0);
  const assignedCount = planningEvents.reduce((sum, event) => sum + event.assignedCount, 0);
  const workloadValues = facultyRows.filter((person) => person.active).map((person) => person.workloadMinutes);
  const [openProposals, absences, activeAbsenceCount, versions, disruptions, solverRuns] = await Promise.all([
    isHod
      ? prisma.scheduleVersion.findMany({
        where: { status: "PROPOSED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { assignments: true, parent: { include: { assignments: true } } },
      })
      : Promise.resolve([]),
    prisma.availabilityBlock.findMany({
      where: { endsAt: { gte: now }, ...(isHod ? {} : { facultyId: user.facultyId ?? "" }) },
      include: { faculty: { select: { id: true, name: true } } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
    prisma.availabilityBlock.count({ where: { endsAt: { gte: now }, ...(isHod ? {} : { facultyId: user.facultyId ?? "" }) } }),
    prisma.scheduleVersion.findMany({
      where: isHod ? {} : { id: published?.id ?? -1 },
      orderBy: { id: "desc" },
      take: 10,
      include: { assignments: true },
    }),
    prisma.disruption.findMany({
      where: isHod ? {} : { facultyId: user.facultyId ?? "" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        faculty: { select: { id: true, name: true } },
        event: { select: { id: true, name: true } },
        proposedVersion: { select: { id: true, status: true } },
      },
    }),
    isHod ? prisma.solverRun.findMany({ orderBy: { createdAt: "desc" }, take: 12 }) : Promise.resolve([]),
  ]);
  const proposals = openProposals.map((proposal) => {
    const oldByDuty = new Map((proposal.parent?.assignments ?? []).map((assignment) => [assignment.dutyId, assignment.facultyId]));
    const newByDuty = new Map(proposal.assignments.map((assignment) => [assignment.dutyId, assignment.facultyId]));
    const allIds = new Set([...oldByDuty.keys(), ...newByDuty.keys()]);
    const changedCount = [...allIds].filter((id) => oldByDuty.get(id) !== newByDuty.get(id)).length;
    const objective = proposal.objectiveJson as { mode?: string; uncovered?: unknown[] } | null;
    return {
      id: proposal.id,
      status: proposal.status,
      solverStatus: proposal.solverStatus,
      createdAt: proposal.createdAt,
      createdBy: proposal.createdBy,
      assignmentCount: proposal.assignments.length,
      changedCount,
      mode: objective?.mode ?? "ALLOCATE",
      uncoveredCount: objective?.uncovered?.length ?? 0,
    };
  });
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, facultyId: user.facultyId },
    currentVersion: published ? { id: published.id, createdAt: published.createdAt } : null,
    stats: {
      activeFaculty: facultyRows.filter((person) => person.active).length,
      eventCount: planningEvents.length,
      dutyCount: dutiesCount,
      assignedCount,
      openRoles: Math.max(0, dutiesCount - assignedCount),
      coveragePercent: dutiesCount ? Math.round((assignedCount / dutiesCount) * 100) : 0,
      conflictCount: conflictPairs.size,
      maxWorkloadMinutes: Math.max(0, ...workloadValues),
      workloadSpreadMinutes: workloadValues.length ? Math.max(...workloadValues) - Math.min(...workloadValues) : 0,
      openProposalCount: proposals.length,
      activeAbsenceCount,
    },
    faculty: facultyRows,
    events,
    proposals,
    absences,
    preferences,
    optimizerOnline,
    planningHorizonDays: schedulingHorizonDays(),
    versions: versions.map((version) => ({
      id: version.id,
      parentId: version.parentId,
      status: version.status,
      solverStatus: version.solverStatus,
      assignmentCount: version.assignments.length,
      createdBy: version.createdBy,
      approvedBy: version.approvedBy,
      rejectedBy: version.rejectedBy,
      createdAt: version.createdAt,
      approvedAt: version.approvedAt,
      rejectedAt: version.rejectedAt,
      rejectionReason: version.rejectionReason,
    })),
    disruptions: disruptions.map((disruption) => ({
      id: disruption.id,
      type: disruption.type,
      startsAt: disruption.startsAt,
      endsAt: disruption.endsAt,
      reason: disruption.reason,
      action: (disruption.metadata as { action?: string } | null)?.action ?? null,
      optimizerStatus: (disruption.metadata as { optimizerStatus?: string } | null)?.optimizerStatus ?? null,
      createdAt: disruption.createdAt,
      facultyName: disruption.faculty?.name ?? null,
      eventName: disruption.event?.name ?? null,
      proposedVersionId: disruption.proposedVersionId,
      proposalStatus: disruption.proposedVersion?.status ?? null,
    })),
    solverRuns: solverRuns.map((run) => ({
      id: run.id,
      status: run.status,
      wallTimeMs: run.wallTimeMs,
      createdAt: run.createdAt,
      scheduleVersionId: run.scheduleVersionId,
      objectiveCount: Array.isArray(run.objectiveJson) ? run.objectiveJson.length : 0,
      candidateVariables: (run.statisticsJson as { candidate_variables?: number } | null)?.candidate_variables ?? null,
      branches: (run.statisticsJson as { branches?: number } | null)?.branches ?? null,
    })),
  });
}
