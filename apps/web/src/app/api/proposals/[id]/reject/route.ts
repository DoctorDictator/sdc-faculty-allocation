import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const rejectSchema = z.object({ reason: z.string().trim().max(240).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can reject a proposal." }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid proposal ID." }, { status: 400 });
  const parsed = rejectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Review the rejection reason." }, { status: 400 });
  const result = await prisma.scheduleVersion.updateMany({
    where: { id, status: "PROPOSED" },
    data: {
      status: "REJECTED",
      rejectedBy: user.name ?? user.email ?? "HOD",
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason || "Rejected by HOD",
    },
  });
  if (result.count !== 1) return NextResponse.json({ error: "This proposal is no longer awaiting review." }, { status: 404 });
  return NextResponse.json({ ok: true, proposalId: id });
}
