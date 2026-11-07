import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { createOptimizationProposal } from "@/lib/optimization";

const eventSchema = z.object({
  name: z.string().trim().min(3).max(160),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  priority: z.number().int().min(1).max(3).default(1),
  roles: z.array(z.object({
    role: z.string().trim().min(2).max(80),
    requiredSkill: z.string().trim().min(2).max(80),
    count: z.number().int().min(1).max(10),
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
  return NextResponse.json({ event, disruptionId: disruption.id }, { status: 201 });
}
