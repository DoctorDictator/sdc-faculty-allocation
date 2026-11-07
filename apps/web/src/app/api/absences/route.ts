import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { createOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const absenceSchema = z.object({
  facultyId: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().max(240).optional(),
});

export async function POST(request: Request) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = absenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the absence details." }, { status: 400 });
  const data = parsed.data;
  if (user.role !== "HOD" && user.facultyId !== data.facultyId) {
    return NextResponse.json({ error: "Faculty can report an absence only for themselves." }, { status: 403 });
  }
  if (data.endsAt <= data.startsAt) return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
  const faculty = await prisma.faculty.findUnique({ where: { id: data.facultyId }, select: { id: true } });
  if (!faculty) return NextResponse.json({ error: "Faculty member was not found." }, { status: 404 });
  const { block, disruption } = await prisma.$transaction(async (tx) => {
    const block = await tx.availabilityBlock.create({
      data: {
        facultyId: data.facultyId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: data.reason || "Reported absence",
      },
    });
    const disruption = await tx.disruption.create({
      data: {
        type: "ABSENCE",
        facultyId: data.facultyId,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: data.reason || "Reported absence",
        metadata: { action: "create" },
      },
    });
    return { block, disruption };
  });
  const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
  try {
    const { result, proposal } = await createOptimizationProposal({
      baseVersionId: current?.id ?? null,
      mode: current ? "REPAIR" : "ALLOCATE",
      createdBy: user.name ?? "Faculty",
    });
    await prisma.disruption.update({
      where: { id: disruption.id },
      data: {
        proposedVersionId: proposal?.id ?? null,
        metadata: { action: "create", optimizerStatus: result.status },
      },
    });
    return NextResponse.json({
      blockId: block.id,
      proposalId: proposal?.id ?? null,
      optimizerStatus: result.status,
      disruptionId: disruption.id,
      warning: proposal ? undefined : `Absence recorded, but optimizer returned ${result.status}; no proposal could be created.`,
    }, { status: proposal ? 201 : 202 });
  } catch (error) {
    console.error("Absence repair failed", error);
    await prisma.disruption.update({
      where: { id: disruption.id },
      data: { metadata: { action: "create", optimizerStatus: "ERROR" } },
    });
    return NextResponse.json({ blockId: block.id, warning: "The absence was recorded, but the repair proposal could not be generated." }, { status: 202 });
  }
}
