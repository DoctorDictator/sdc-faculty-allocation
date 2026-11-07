import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { createOptimizationProposal } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  employeeCode: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(160),
  title: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  skills: z.array(z.string().trim().min(2).max(80)).max(30),
  targetMinutes: z.number().int().min(0).max(10080),
  maxMinutes: z.number().int().min(1).max(10080),
  active: z.boolean(),
  login: z.object({ email: z.email(), password: z.string().min(8).max(128) }).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can edit faculty profiles." }, { status: 403 });
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the faculty details and workload limits." }, { status: 400 });
  const data = parsed.data;
  if (data.maxMinutes < data.targetMinutes) return NextResponse.json({ error: "Maximum workload must be at least the target workload." }, { status: 400 });
  try {
    const existing = await prisma.faculty.findUnique({ where: { id }, select: { committedMinutes: true } });
    if (!existing) return NextResponse.json({ error: "Faculty member was not found." }, { status: 404 });
    if (data.maxMinutes < existing.committedMinutes) {
      return NextResponse.json({ error: "Maximum workload cannot be lower than already committed workload." }, { status: 400 });
    }
    const passwordHash = data.login ? await bcrypt.hash(data.login.password, 12) : null;
    const { faculty, disruption } = await prisma.$transaction(async (tx) => {
      const faculty = await tx.faculty.update({
        where: { id },
        data: {
          ...data,
          skills: [...new Set(data.skills.map((skill) => skill.toLowerCase()))],
        },
        select: { id: true, name: true, employeeCode: true },
      });
      const linkedUser = data.login
        ? await tx.user.findUnique({ where: { facultyId: id }, select: { id: true } })
        : null;
      if (data.login && passwordHash) {
        if (linkedUser) {
          await tx.user.update({
            where: { id: linkedUser.id },
            data: { email: data.login.email.toLowerCase(), name: faculty.name, passwordHash },
          });
        } else {
          await tx.user.create({
            data: {
              email: data.login.email.toLowerCase(),
              name: faculty.name,
              passwordHash,
              role: "FACULTY",
              facultyId: id,
            },
          });
        }
      } else {
        await tx.user.updateMany({ where: { facultyId: id }, data: { name: faculty.name } });
      }
      const disruption = await tx.disruption.create({
        data: {
          type: "REBALANCE",
          facultyId: id,
          reason: "Faculty scheduling profile changed",
          metadata: { action: "profile_update", facultyName: faculty.name },
        },
      });
      return { faculty, disruption };
    });
    const current = await prisma.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
    if (!current) return NextResponse.json({ faculty, proposalId: null, disruptionId: disruption.id }, { status: 200 });
    try {
      const { result, proposal } = await createOptimizationProposal({
        baseVersionId: current.id,
        mode: "REPAIR",
        createdBy: user.name ?? "HOD",
      });
      await prisma.disruption.update({
        where: { id: disruption.id },
        data: {
          proposedVersionId: proposal?.id ?? null,
          metadata: { action: "profile_update", optimizerStatus: result.status, facultyName: faculty.name },
        },
      });
      return NextResponse.json({
        faculty,
        proposalId: proposal?.id ?? null,
        optimizerStatus: result.status,
        warning: proposal ? undefined : `Profile updated, but optimizer returned ${result.status}; no proposal could be created.`,
      }, { status: proposal ? 200 : 202 });
    } catch (error) {
      console.error("Faculty profile repair failed", error);
      await prisma.disruption.update({ where: { id: disruption.id }, data: { metadata: { action: "profile_update", optimizerStatus: "ERROR", facultyName: faculty.name } } });
      return NextResponse.json({ faculty, proposalId: null, warning: "Profile updated, but no repair proposal was created." });
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "That employee code or login email is already in use." }, { status: 409 });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
      return NextResponse.json({ error: "Faculty member was not found." }, { status: 404 });
    }
    console.error("Faculty update failed", error);
    return NextResponse.json({ error: "Could not update this faculty profile." }, { status: 500 });
  }
}
