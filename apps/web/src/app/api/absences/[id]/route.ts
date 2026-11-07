import { NextResponse } from "next/server";
import { authorizedUser } from "@/lib/access";
import { createOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const block = await prisma.availabilityBlock.findUnique({ where: { id } });
  if (!block) return NextResponse.json({ error: "Availability block was not found." }, { status: 404 });
  if (user.role !== "HOD" && block.facultyId !== user.facultyId) {
    return NextResponse.json({ error: "You can remove only your own absence report." }, { status: 403 });
  }
  const { disruption } = await prisma.$transaction(async (tx) => {
    await tx.availabilityBlock.delete({ where: { id } });
    const disruption = await tx.disruption.create({
      data: {
        type: "ABSENCE",
        facultyId: block.facultyId,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        reason: "Availability block removed",
        metadata: { action: "remove", blockId: id },
      },
    });
    return { disruption };
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
        metadata: { action: "remove", blockId: id, optimizerStatus: result.status },
      },
    });
    return NextResponse.json({
      ok: true,
      blockId: id,
      proposalId: proposal?.id ?? null,
      optimizerStatus: result.status,
      warning: proposal ? undefined : `Availability updated, but optimizer returned ${result.status}; no proposal could be created.`,
    }, { status: proposal ? 200 : 202 });
  } catch (error) {
    console.error("Availability repair failed", error);
    await prisma.disruption.update({
      where: { id: disruption.id },
      data: { metadata: { action: "remove", blockId: id, optimizerStatus: "ERROR" } },
    });
    return NextResponse.json({ ok: true, blockId: id, warning: "Availability was updated, but the optimizer could not create a proposal." }, { status: 202 });
  }
}
