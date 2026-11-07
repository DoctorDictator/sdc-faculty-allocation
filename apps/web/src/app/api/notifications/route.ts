import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const readSchema = z.object({ id: z.string().cuid().optional(), markAll: z.boolean().optional() }).refine(
  (value) => Boolean(value.id) !== Boolean(value.markAll),
  "Choose one notification or mark all as read.",
);

export async function PATCH(request: Request) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose one notification or mark all as read." }, { status: 400 });
  const readAt = new Date();
  if (parsed.data.markAll) {
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt } });
  } else {
    const result = await prisma.notification.updateMany({
      where: { id: parsed.data.id, userId: user.id, readAt: null },
      data: { readAt },
    });
    if (!result.count) return NextResponse.json({ error: "Notification not found or already read." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
