import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { createOptimizationProposal, type OptimizationMode } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const requestSchema = z.object({ mode: z.enum(["ALLOCATE", "REPAIR", "REBALANCE"]).optional() });

export async function POST(request: Request) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can generate an allocation proposal." }, { status: 403 });
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Choose a supported optimization mode." }, { status: 400 });
  const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
  const mode: OptimizationMode = body.data.mode ?? (current ? "REBALANCE" : "ALLOCATE");
  try {
    const { result, proposal } = await createOptimizationProposal({
      baseVersionId: current?.id ?? null,
      mode,
      createdBy: user.name ?? "HOD",
    });
    if (!proposal) {
      return NextResponse.json({ error: `Optimizer returned ${result.status}.`, result }, { status: 422 });
    }
    return NextResponse.json({ proposalId: proposal.id, result }, { status: 201 });
  } catch (error) {
    console.error("Proposal generation failed", error);
    return NextResponse.json({ error: "The optimizer could not create a proposal. Check that the optimization service is running." }, { status: 503 });
  }
}
