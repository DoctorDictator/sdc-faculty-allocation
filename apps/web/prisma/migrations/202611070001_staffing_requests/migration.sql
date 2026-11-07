CREATE TYPE "StaffingRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

CREATE TABLE "EventStaffingRequest" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "eventId" TEXT,
  "eventName" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "requestedRole" TEXT NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "reason" TEXT,
  "status" "StaffingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "approvedRole" TEXT,
  "approvedCount" INTEGER,
  "requiredSkill" TEXT,
  "responseNote" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventStaffingRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventStaffingRequest_valid_interval" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "EventStaffingRequest_requestedCount_positive" CHECK ("requestedCount" > 0),
  CONSTRAINT "EventStaffingRequest_approvedCount_positive" CHECK ("approvedCount" IS NULL OR "approvedCount" > 0)
);

CREATE UNIQUE INDEX "EventStaffingRequest_eventId_key" ON "EventStaffingRequest"("eventId");
CREATE INDEX "EventStaffingRequest_status_createdAt_idx" ON "EventStaffingRequest"("status", "createdAt");
CREATE INDEX "EventStaffingRequest_requesterId_createdAt_idx" ON "EventStaffingRequest"("requesterId", "createdAt");

ALTER TABLE "EventStaffingRequest"
  ADD CONSTRAINT "EventStaffingRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventStaffingRequest"
  ADD CONSTRAINT "EventStaffingRequest_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
