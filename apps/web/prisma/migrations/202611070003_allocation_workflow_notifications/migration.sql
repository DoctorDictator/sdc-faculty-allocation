ALTER TABLE "EventStaffingRequest"
  ADD COLUMN "proposalId" INTEGER;

CREATE UNIQUE INDEX "EventStaffingRequest_proposalId_key"
  ON "EventStaffingRequest"("proposalId");

ALTER TABLE "EventStaffingRequest"
  ADD CONSTRAINT "EventStaffingRequest_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "ScheduleVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "section" TEXT NOT NULL DEFAULT 'Schedule',
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification"("userId", "readAt", "createdAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
