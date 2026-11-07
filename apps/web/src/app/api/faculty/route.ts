import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hodUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const facultySchema = z.object({
  employeeCode: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(160),
  title: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  skills: z.array(z.string().trim().min(2).max(80)).max(30),
  targetMinutes: z.number().int().min(0).max(10080),
  maxMinutes: z.number().int().min(1).max(10080),
  active: z.boolean().default(true),
  login: z.object({ email: z.email(), password: z.string().min(8).max(128) }).optional(),
});

export async function POST(request: Request) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can add a faculty profile." }, { status: 403 });
  const parsed = facultySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the faculty details and workload limits." }, { status: 400 });
  const data = parsed.data;
  if (data.maxMinutes < data.targetMinutes) return NextResponse.json({ error: "Maximum workload must be at least the target workload." }, { status: 400 });
  try {
    const faculty = await prisma.faculty.create({
      data: {
        employeeCode: data.employeeCode,
        name: data.name,
        title: data.title,
        department: data.department,
        skills: [...new Set(data.skills.map((skill) => skill.toLowerCase()))],
        active: data.active,
        targetMinutes: data.targetMinutes,
        maxMinutes: data.maxMinutes,
        user: data.login
          ? {
              create: {
                email: data.login.email.toLowerCase(),
                name: data.name,
                passwordHash: await bcrypt.hash(data.login.password, 12),
                role: "FACULTY",
              },
            }
          : undefined,
      },
      select: { id: true, name: true, employeeCode: true },
    });
    return NextResponse.json({ faculty }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "That employee code or login email is already in use." }, { status: 409 });
    }
    console.error("Faculty creation failed", error);
    return NextResponse.json({ error: "Could not add this faculty profile." }, { status: 500 });
  }
}
