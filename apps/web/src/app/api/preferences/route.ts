import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const preferenceSchema = z.object({ dutyId: z.string().min(1), cost: z.union([z.literal(0), z.literal(5), z.literal(20)]) });

export async function POST(request: Request) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "FACULTY" || !user.facultyId) {
    return NextResponse.json({ error: "Faculty sign-in is required to update personal preferences." }, { status: 403 });
  }
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported preference." }, { status: 400 });
  const duty = await prisma.duty.findUnique({ where: { id: parsed.data.dutyId }, include: { event: true } });
  if (!duty || duty.event.status === "CANCELLED" || duty.event.endsAt < new Date()) {
    return NextResponse.json({ error: "That duty is no longer available for preference updates." }, { status: 404 });
  }
  await prisma.preferenceCost.upsert({
    where: { dutyId_facultyId: { dutyId: duty.id, facultyId: user.facultyId } },
    create: { dutyId: duty.id, facultyId: user.facultyId, cost: parsed.data.cost },
    update: { cost: parsed.data.cost },
  });
  return NextResponse.json({ ok: true, dutyId: duty.id, cost: parsed.data.cost });
}
