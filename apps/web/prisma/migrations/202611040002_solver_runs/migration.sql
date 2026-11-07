CREATE TABLE "SolverRun" (
  "id" SERIAL NOT NULL,
  "scheduleVersionId" INTEGER,
  "solver" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "wallTimeMs" INTEGER,
  "objectiveJson" JSONB,
  "statisticsJson" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolverRun_pkey" PRIMARY KEY ("id")
);

ALTER TYPE "DisruptionType" ADD VALUE 'ASSIGNMENT';

CREATE INDEX "SolverRun_status_createdAt_idx" ON "SolverRun"("status", "createdAt");
CREATE INDEX "SolverRun_scheduleVersionId_idx" ON "SolverRun"("scheduleVersionId");

ALTER TABLE "SolverRun"
  ADD CONSTRAINT "SolverRun_scheduleVersionId_fkey"
  FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Disruption"
  ADD CONSTRAINT "Disruption_facultyId_fkey"
  FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Disruption"
  ADD CONSTRAINT "Disruption_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreferenceCost" ALTER COLUMN "cost" SET DEFAULT 5;

CREATE UNIQUE INDEX "ScheduleVersion_one_published_key"
  ON "ScheduleVersion" ("status")
  WHERE "status" = 'PUBLISHED';
