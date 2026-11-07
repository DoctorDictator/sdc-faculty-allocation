import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { authorizedUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const assignmentUpdateSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("acknowledged"), value: z.boolean() }),
  z.object({ field: z.literal("protected"), value: z.boolean() }),
]);

class AssignmentUpdateConflict extends Error {}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizedUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const parsed = assignmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a supported assignment update." }, { status: 400 });
  if (parsed.data.field === "acknowledged" && user.role !== "FACULTY") {
    return NextResponse.json({ error: "Only faculty can acknowledge their own assignments." }, { status: 403 });
  }
  if (parsed.data.field === "protected" && user.role !== "HOD") {
    return NextResponse.json({ error: "Only the HOD can protect published assignments." }, { status: 403 });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.findUnique({
        where: { id },
        include: { faculty: true, duty: { include: { event: true } }, scheduleVersion: true },
      });
      if (!assignment) throw new AssignmentUpdateConflict("Assignment was not found.");
      const current = await tx.scheduleVersion.findFirst({ where: { status: "PUBLISHED" }, orderBy: { id: "desc" } });
      if (!current || current.id !== assignment.scheduleVersionId || assignment.scheduleVersion.status !== "PUBLISHED") {
        throw new AssignmentUpdateConflict("Only assignments in the current published schedule can be updated.");
      }
      if (assignment.duty.event.status === "CANCELLED" || assignment.duty.event.status === "COMPLETED" || assignment.duty.event.endsAt < new Date()) {
        throw new AssignmentUpdateConflict("This duty is no longer open for updates.");
      }
      if (parsed.data.field === "acknowledged" && assignment.facultyId !== user.facultyId) {
        throw new AssignmentUpdateConflict("You can acknowledge only your own assignments.");
      }
      const acknowledged = parsed.data.field === "acknowledged" ? parsed.data.value : assignment.acknowledged;
      const protectedAssignment = parsed.data.field === "protected" ? parsed.data.value : assignment.protected;
      const updated = await tx.assignment.update({
        where: { id },
        data: {
          acknowledged,
          protected: protectedAssignment,
          changeWeight: protectedAssignment ? 20 : acknowledged ? 5 : 1,
        },
        select: { id: true, acknowledged: true, protected: true, changeWeight: true },
      });
      await tx.disruption.create({
        data: {
          type: "ASSIGNMENT",
          facultyId: assignment.facultyId,
          eventId: assignment.duty.eventId,
          reason: parsed.data.field === "acknowledged"
            ? (parsed.data.value ? "Faculty acknowledged a published assignment" : "Faculty withdrew assignment acknowledgement")
            : (parsed.data.value ? "HOD protected a published assignment" : "HOD released assignment protection"),
          metadata: { action: parsed.data.field, value: parsed.data.value, assignmentId: assignment.id },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, assignment: result });
  } catch (error) {
    if (error instanceof AssignmentUpdateConflict) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Assignment was not found." ? 404 : 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "The schedule changed while this assignment was being updated. Refresh and try again." }, { status: 409 });
    }
    console.error("Assignment update failed", error);
    return NextResponse.json({ error: "Could not update this assignment." }, { status: 500 });
  }
}
