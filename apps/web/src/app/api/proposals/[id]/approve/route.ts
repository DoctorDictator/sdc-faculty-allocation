import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { hodUser } from "@/lib/access";
import { loadOptimizationSnapshot, snapshotHash } from "@/lib/optimization";
import { prisma } from "@/lib/prisma";

class ApprovalConflict extends Error {}
class StaleProposal extends Error {}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await hodUser();
  if (!user) return NextResponse.json({ error: "Only the HOD can approve a schedule." }, { status: 403 });
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid proposal ID." }, { status: 400 });
  try {
    const proposal = await prisma.scheduleVersion.findUnique({ where: { id } });
    if (!proposal || proposal.status !== "PROPOSED") return NextResponse.json({ error: "This proposal is no longer awaiting approval." }, { status: 404 });
    await prisma.$transaction(
      async (tx) => {
        const currentProposal = await tx.scheduleVersion.findUnique({
          where: { id },
          include: {
            assignments: { include: { duty: { include: { event: true } } } },
            staffingRequest: { include: { requester: { include: { user: true } } } },
          },
        });
        if (!currentProposal || currentProposal.status !== "PROPOSED") throw new ApprovalConflict("This proposal was already processed.");
        const { input } = await loadOptimizationSnapshot(currentProposal.parentId, "REPAIR", tx);
        if (snapshotHash(input) !== currentProposal.snapshotHash) {
          throw new StaleProposal("The scheduling data changed after this proposal was created. Generate a fresh proposal.");
        }
        const current = await tx.scheduleVersion.findFirst({
          where: { status: "PUBLISHED" },
          orderBy: { id: "desc" },
          include: { assignments: { include: { duty: { include: { event: true } } } } },
        });
        if ((current?.id ?? null) !== currentProposal.parentId) throw new ApprovalConflict("A newer schedule was published. Generate a fresh proposal.");
        if (current) {
          const superseded = await tx.scheduleVersion.updateMany({
            where: { id: current.id, status: "PUBLISHED" },
            data: { status: "SUPERSEDED" },
          });
          if (superseded.count !== 1) throw new ApprovalConflict("The published schedule changed during approval.");
        }
        const published = await tx.scheduleVersion.updateMany({
          where: { id, status: "PROPOSED" },
          data: { status: "PUBLISHED", approvedBy: user.name ?? user.email ?? "HOD", approvedAt: new Date() },
        });
        if (published.count !== 1) throw new ApprovalConflict("This proposal was already processed.");

        const oldByDuty = new Map((current?.assignments ?? []).map((assignment) => [assignment.dutyId, assignment.facultyId]));
        const newByDuty = new Map(currentProposal.assignments.map((assignment) => [assignment.dutyId, assignment.facultyId]));
        const notificationRows: Array<{ userId: string; title: string; message: string; section: string }> = [];
        for (const assignment of currentProposal.assignments) {
          if (oldByDuty.get(assignment.dutyId) === assignment.facultyId) continue;
          const account = await tx.user.findFirst({ where: { facultyId: assignment.facultyId }, select: { id: true } });
          if (account) {
            notificationRows.push({
              userId: account.id,
              title: "You have been assigned an event task",
              message: `${assignment.duty.event.name}: ${assignment.duty.role}, ${assignment.duty.event.startsAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
              section: "Schedule",
            });
          }
        }
        for (const assignment of current?.assignments ?? []) {
          if (newByDuty.has(assignment.dutyId) && newByDuty.get(assignment.dutyId) === assignment.facultyId) continue;
          const account = await tx.user.findFirst({ where: { facultyId: assignment.facultyId }, select: { id: true } });
          if (account) {
            notificationRows.push({
              userId: account.id,
              title: "Your event assignment changed",
              message: `${assignment.duty.event.name}: ${assignment.duty.role} is no longer assigned to you in schedule V${id}.`,
              section: "Schedule",
            });
          }
        }
        if (currentProposal.staffingRequest) {
          const staffingRequest = currentProposal.staffingRequest;
          await tx.eventStaffingRequest.update({
            where: { id: staffingRequest.id },
            data: {
              status: "APPROVED",
              approvedRole: staffingRequest.requestedRole,
              approvedCount: staffingRequest.requestedCount,
              reviewedBy: user.name ?? "HOD",
              reviewedAt: new Date(),
            },
          });
          if (staffingRequest.requester.user) {
            notificationRows.push({
              userId: staffingRequest.requester.user.id,
              title: "Your staffing request was approved",
              message: `The allocation for ${staffingRequest.eventName} is now published in schedule V${id}.`,
              section: "Schedule",
            });
          }
        }
        const dutyIds = currentProposal.assignments.map((assignment) => assignment.dutyId);
        if (dutyIds.length) {
          await tx.duty.updateMany({ where: { id: { in: dutyIds }, forcedFacultyId: { not: null } }, data: { forcedFacultyId: null } });
        }
        if (notificationRows.length) await tx.notification.createMany({ data: notificationRows });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json({ ok: true, versionId: id });
  } catch (error) {
    if (error instanceof StaleProposal) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ApprovalConflict || (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002"))) {
      return NextResponse.json({ error: error.message || "Concurrent schedule approval detected. Refresh and try again." }, { status: 409 });
    }
    console.error("Schedule approval failed", error);
    return NextResponse.json({ error: "Schedule approval failed." }, { status: 500 });
  }
}
