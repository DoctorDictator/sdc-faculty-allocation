import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";

export type OptimizationMode = "ALLOCATE" | "REPAIR" | "REBALANCE";

export function schedulingHorizonDays() {
  const configuredDays = Number(process.env.SCHEDULING_HORIZON_DAYS || 90);
  return Number.isFinite(configuredDays) ? Math.min(365, Math.max(7, Math.trunc(configuredDays))) : 90;
}

function planningHorizonEnd(now: Date) {
  return new Date(now.getTime() + schedulingHorizonDays() * 24 * 60 * 60 * 1000);
}

export async function loadOptimizationSnapshot(
  baseVersionId: number | null,
  mode: OptimizationMode,
  db: Prisma.TransactionClient = prisma,
) {
  const now = new Date();
  const horizonEnd = planningHorizonEnd(now);
  const [facultyRows, allEventRows, blocks, baseVersion] = await Promise.all([
    db.faculty.findMany({ orderBy: { id: "asc" } }),
    db.event.findMany({
      include: { duties: { include: { preferences: true }, orderBy: [{ role: "asc" }, { positionIndex: "asc" }] } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
    db.availabilityBlock.findMany({ orderBy: [{ facultyId: "asc" }, { startsAt: "asc" }, { endsAt: "asc" }, { id: "asc" }] }),
    baseVersionId
      ? db.scheduleVersion.findUnique({ where: { id: baseVersionId }, include: { assignments: true } })
      : Promise.resolve(null),
  ]);
  const eventRows = allEventRows.filter(
    (event) => event.status !== "CANCELLED" && event.status !== "COMPLETED" && event.endsAt >= now && event.startsAt <= horizonEnd,
  );
  const currentAssignments = baseVersion?.assignments ?? [];
  const futureDutyIds = new Set(eventRows.flatMap((event) => event.duties.map((duty) => duty.id)));
  const dutyStates = new Map(
    allEventRows.flatMap((event) => event.duties.map((duty) => [duty.id, { status: event.status, startsAt: event.startsAt, endsAt: event.endsAt }] as const)),
  );
  const baseline = currentAssignments
    .filter((assignment) => futureDutyIds.has(assignment.dutyId))
    .sort((a, b) => a.dutyId.localeCompare(b.dutyId))
    .map((assignment) => ({
      faculty_id: assignment.facultyId,
      duty_id: assignment.dutyId,
      protected: assignment.protected,
      acknowledged: assignment.acknowledged,
      change_weight: assignment.changeWeight,
    }));
  const input = {
    mode,
    faculty: facultyRows.map((person) => ({
      id: person.id,
      name: person.name,
      skills: person.skills,
      active: person.active,
      target_minutes: person.targetMinutes,
      max_minutes: person.maxMinutes,
      committed_minutes: person.committedMinutes,
    })),
    duties: eventRows.flatMap((event) =>
      event.duties.map((duty) => ({
        id: duty.id,
        event_id: event.id,
        event_name: event.name,
        role: duty.role,
        required_skill: duty.requiredSkill,
        forced_faculty_id: duty.forcedFacultyId,
        starts_at: event.startsAt.toISOString(),
        ends_at: event.endsAt.toISOString(),
        minutes: duty.minutes,
        priority: event.priority,
        preference_costs: Object.fromEntries(duty.preferences.map((entry) => [entry.facultyId, entry.cost])),
      })),
    ),
    unavailable: blocks.map((block) => ({
      faculty_id: block.facultyId,
      starts_at: block.startsAt.toISOString(),
      ends_at: block.endsAt.toISOString(),
    })),
    baseline,
    rest_minutes: 30,
    time_limit_seconds: 5,
  };
  const futureAssignments = new Set(futureDutyIds);
  const carriedAssignments = currentAssignments
    .filter((assignment) => {
      if (futureAssignments.has(assignment.dutyId)) return false;
      const state = dutyStates.get(assignment.dutyId);
      return Boolean(state && state.status !== "CANCELLED" && (state.status === "COMPLETED" || state.endsAt < now || state.startsAt > horizonEnd));
    })
    .sort((a, b) => a.dutyId.localeCompare(b.dutyId))
    .map((assignment) => ({
      facultyId: assignment.facultyId,
      dutyId: assignment.dutyId,
      protected: assignment.protected,
      acknowledged: assignment.acknowledged,
      changeWeight: assignment.changeWeight,
    }));
  return { input, carriedAssignments };
}

export function snapshotHash(input: Record<string, unknown>) {
  const { mode: _mode, time_limit_seconds: _limit, ...stableInput } = input;
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(stableInput))).digest("hex");
}

export async function runOptimizer(input: Record<string, unknown>) {
  const baseUrl = process.env.OPTIMIZER_URL || "http://127.0.0.1:8000";
  const response = await fetch(`${baseUrl}/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Optimizer returned ${response.status}: ${detail.slice(0, 400)}`);
  }
  return (await response.json()) as {
    status: string;
    mode: OptimizationMode;
    lexicographic_complete: boolean;
    objective_levels: Array<{ objective: string; value?: number; status: string }>;
    assignments: Array<{ faculty_id: string; duty_id: string }>;
    uncovered: Array<{ duty_id: string; role: string; event_name: string; reason: string }>;
    workloads: Array<{ faculty_id: string; name: string; minutes: number; target_minutes: number; maximum_minutes: number }>;
    solver_stats: Record<string, number>;
  };
}

export async function createOptimizationProposal(args: {
  baseVersionId: number | null;
  mode: OptimizationMode;
  createdBy: string;
  staffingRequestId?: string;
}) {
  const { input, carriedAssignments } = await loadOptimizationSnapshot(args.baseVersionId, args.mode);
  const runStartedAt = Date.now();
  let result: Awaited<ReturnType<typeof runOptimizer>>;
  try {
    result = await runOptimizer(input);
  } catch (error) {
    await prisma.solverRun.create({
      data: {
        solver: "Google OR-Tools CP-SAT",
        status: "ERROR",
        wallTimeMs: Date.now() - runStartedAt,
        objectiveJson: { message: "The optimizer request failed before returning a solution." },
        statisticsJson: {},
      },
    });
    throw error;
  }
  const solverRun = {
    solver: "Google OR-Tools CP-SAT",
    status: result.status,
    wallTimeMs: Math.round((result.solver_stats.total_wall_time_seconds ?? result.solver_stats.wall_time_seconds ?? 0) * 1000),
    objectiveJson: result.objective_levels as Prisma.InputJsonValue,
    statisticsJson: result.solver_stats as Prisma.InputJsonValue,
  };
  if (!["OPTIMAL", "FEASIBLE"].includes(result.status)) {
    await prisma.solverRun.create({ data: solverRun });
    return { result, proposal: null };
  }
  const existingByDuty = new Map(input.baseline.map((assignment) => [assignment.duty_id, assignment]));
  const forcedDutyIds = new Set(input.duties.flatMap((duty) => duty.forced_faculty_id ? [duty.id] : []));
  const solverAssignments = result.assignments.map((assignment) => {
    const previous = existingByDuty.get(assignment.duty_id);
    const sameFaculty = previous?.faculty_id === assignment.faculty_id;
    return {
      facultyId: assignment.faculty_id,
      dutyId: assignment.duty_id,
      protected: forcedDutyIds.has(assignment.duty_id) || (sameFaculty ? previous.protected : false),
      acknowledged: sameFaculty ? previous.acknowledged : false,
      changeWeight: sameFaculty ? previous.change_weight : 1,
    };
  });
  const proposal = await prisma.$transaction(async (tx) => {
    const version = await tx.scheduleVersion.create({
      data: {
        parentId: args.baseVersionId,
        status: "PROPOSED",
        solver: "Google OR-Tools CP-SAT",
        solverStatus: result.status,
        snapshotHash: snapshotHash(input),
        objectiveJson: {
          mode: args.mode,
          lexicographicComplete: result.lexicographic_complete,
          objectiveLevels: result.objective_levels,
          uncovered: result.uncovered,
          workloads: result.workloads,
          solverStats: result.solver_stats,
        } as Prisma.InputJsonValue,
        createdBy: args.createdBy,
        ...(args.staffingRequestId ? { staffingRequest: { connect: { id: args.staffingRequestId } } } : {}),
        assignments: {
          create: [...carriedAssignments, ...solverAssignments],
        },
      },
      include: { assignments: true },
    });
    await tx.solverRun.create({ data: { ...solverRun, scheduleVersionId: version.id } });
    return version;
  });
  return { result, proposal };
}

export async function createLatestOptimizationProposal(args: { createdBy: string; staffingRequestId?: string }) {
  const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
  return createOptimizationProposal({
    baseVersionId: current?.id ?? null,
    mode: current ? "REPAIR" : "ALLOCATE",
    createdBy: args.createdBy,
    staffingRequestId: args.staffingRequestId,
  });
}
