import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { loadOptimizationSnapshot, runOptimizer, schedulingHorizonDays, type OptimizationMode } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const scenarioSchema = z.object({
  facultyId: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export async function POST(request: Request) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can simulate scheduling scenarios." }, { status: 403 });
  const parsed = scenarioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a faculty member and a valid time window." }, { status: 400 });
  const scenario = parsed.data;
  if (scenario.endsAt <= scenario.startsAt || scenario.endsAt <= new Date()) {
    return NextResponse.json({ error: "The scenario must have a future end time after its start." }, { status: 400 });
  }
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + schedulingHorizonDays() * 24 * 60 * 60 * 1000);
  if (scenario.startsAt > horizonEnd) {
    return NextResponse.json({ error: `Choose a start time within the next ${schedulingHorizonDays()} days.` }, { status: 400 });
  }
  const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
  const mode: OptimizationMode = current ? "REPAIR" : "ALLOCATE";
  try {
    const { input: rawInput } = await loadOptimizationSnapshot(current?.id ?? null, mode);
    const input = rawInput as {
      faculty: Array<{ id: string; name: string; active: boolean }>;
      duties: Array<{ id: string; event_name: string; role: string; starts_at: string; ends_at: string; required_skill: string | null }>;
      baseline: Array<{ faculty_id: string; duty_id: string }>;
      unavailable: Array<{ faculty_id: string; starts_at: string; ends_at: string }>;
      [key: string]: unknown;
    };
    const facultyMember = input.faculty.find((person) => person.id === scenario.facultyId && person.active);
    if (!facultyMember) return NextResponse.json({ error: "Choose an active faculty member." }, { status: 404 });
    input.unavailable = [...input.unavailable, {
      faculty_id: scenario.facultyId,
      starts_at: scenario.startsAt.toISOString(),
      ends_at: scenario.endsAt.toISOString(),
    }];
    const result = await runOptimizer(input);
    const hasSolution = ["OPTIMAL", "FEASIBLE"].includes(result.status);
    const oldByDuty = new Map(input.baseline.map((assignment) => [assignment.duty_id, assignment.faculty_id]));
    const newByDuty = new Map(result.assignments.map((assignment) => [assignment.duty_id, assignment.faculty_id]));
    const facultyById = new Map(input.faculty.map((person) => [person.id, person.name]));
    const dutyById = new Map(input.duties.map((duty) => [duty.id, duty]));
    const dutyIds = new Set([...oldByDuty.keys(), ...newByDuty.keys()]);
    const changes = [...dutyIds].flatMap((dutyId) => {
      const fromId = oldByDuty.get(dutyId) ?? null;
      const toId = newByDuty.get(dutyId) ?? null;
      if (fromId === toId) return [];
      const duty = dutyById.get(dutyId);
      if (!duty) return [];
      return [{
        dutyId,
        eventName: duty.event_name,
        role: duty.role,
        startsAt: duty.starts_at,
        from: fromId ? facultyById.get(fromId) ?? "Faculty member" : null,
        to: toId ? facultyById.get(toId) ?? "Faculty member" : null,
      }];
    }).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return NextResponse.json({
      status: result.status,
      lexicographicComplete: result.lexicographic_complete,
      mode,
      hasSolution,
      changedCount: hasSolution ? changes.length : 0,
      assignmentCount: hasSolution ? result.assignments.length : 0,
      uncovered: result.uncovered,
      changes: hasSolution ? changes : [],
      objectiveLevels: result.objective_levels,
      solverStats: result.solver_stats,
      scenario: { facultyName: facultyMember.name, startsAt: scenario.startsAt, endsAt: scenario.endsAt },
    });
  } catch (error) {
    console.error("Scenario simulation failed", error);
    return NextResponse.json({ error: "The optimizer could not simulate this scenario. Check that the optimization service is running." }, { status: 503 });
  }
}
