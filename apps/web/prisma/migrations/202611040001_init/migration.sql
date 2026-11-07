CREATE TYPE "UserRole" AS ENUM ('HOD', 'FACULTY');
CREATE TYPE "EventStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ScheduleStatus" AS ENUM ('PROPOSED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');
CREATE TYPE "DisruptionType" AS ENUM ('ABSENCE', 'EVENT_CHANGE', 'REBALANCE');

CREATE TABLE "Faculty" (
  "id" TEXT NOT NULL,
  "employeeCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "targetMinutes" INTEGER NOT NULL DEFAULT 0,
  "maxMinutes" INTEGER NOT NULL,
  "committedMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Faculty_employeeCode_key" ON "Faculty"("employeeCode");
CREATE INDEX "Faculty_active_department_idx" ON "Faculty"("active", "department");

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'FACULTY',
  "facultyId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_facultyId_key" ON "User"("facultyId");

CREATE TABLE "Event" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "status" "EventStatus" NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Event_valid_interval" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "Event_startsAt_status_idx" ON "Event"("startsAt", "status");

CREATE TABLE "Duty" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "requiredSkill" TEXT,
  "positionIndex" INTEGER NOT NULL DEFAULT 1,
  "minutes" INTEGER NOT NULL,
  CONSTRAINT "Duty_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Duty_minutes_positive" CHECK ("minutes" > 0)
);
CREATE UNIQUE INDEX "Duty_eventId_role_positionIndex_key" ON "Duty"("eventId", "role", "positionIndex");
CREATE INDEX "Duty_eventId_idx" ON "Duty"("eventId");

CREATE TABLE "AvailabilityBlock" (
  "id" TEXT NOT NULL,
  "facultyId" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AvailabilityBlock_valid_interval" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "AvailabilityBlock_facultyId_startsAt_endsAt_idx" ON "AvailabilityBlock"("facultyId", "startsAt", "endsAt");

CREATE TABLE "PreferenceCost" (
  "dutyId" TEXT NOT NULL,
  "facultyId" TEXT NOT NULL,
  "cost" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PreferenceCost_pkey" PRIMARY KEY ("dutyId", "facultyId")
);

CREATE TABLE "ScheduleVersion" (
  "id" SERIAL NOT NULL,
  "parentId" INTEGER,
  "status" "ScheduleStatus" NOT NULL DEFAULT 'PROPOSED',
  "solver" TEXT NOT NULL,
  "solverStatus" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "objectiveJson" JSONB,
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "rejectedBy" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMPTZ(3),
  "rejectedAt" TIMESTAMPTZ(3),
  "rejectionReason" TEXT,
  CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduleVersion_status_createdAt_idx" ON "ScheduleVersion"("status", "createdAt");

CREATE TABLE "Assignment" (
  "id" TEXT NOT NULL,
  "scheduleVersionId" INTEGER NOT NULL,
  "dutyId" TEXT NOT NULL,
  "facultyId" TEXT NOT NULL,
  "protected" BOOLEAN NOT NULL DEFAULT false,
  "acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "changeWeight" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Assignment_scheduleVersionId_dutyId_key" ON "Assignment"("scheduleVersionId", "dutyId");
CREATE INDEX "Assignment_facultyId_scheduleVersionId_idx" ON "Assignment"("facultyId", "scheduleVersionId");

CREATE TABLE "Disruption" (
  "id" TEXT NOT NULL,
  "type" "DisruptionType" NOT NULL,
  "facultyId" TEXT,
  "eventId" TEXT,
  "startsAt" TIMESTAMPTZ(3),
  "endsAt" TIMESTAMPTZ(3),
  "reason" TEXT,
  "metadata" JSONB,
  "proposedVersionId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Disruption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Disruption_type_createdAt_idx" ON "Disruption"("type", "createdAt");

ALTER TABLE "User" ADD CONSTRAINT "User_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Duty" ADD CONSTRAINT "Duty_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreferenceCost" ADD CONSTRAINT "PreferenceCost_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreferenceCost" ADD CONSTRAINT "PreferenceCost_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ScheduleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Disruption" ADD CONSTRAINT "Disruption_proposedVersionId_fkey" FOREIGN KEY ("proposedVersionId") REFERENCES "ScheduleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
