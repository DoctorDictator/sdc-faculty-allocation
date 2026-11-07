ALTER TABLE "EventStaffingRequest"
  ADD COLUMN "assignedFacultyNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Duty"
  ADD COLUMN "forcedFacultyId" TEXT;

CREATE INDEX "Duty_forcedFacultyId_idx" ON "Duty"("forcedFacultyId");

ALTER TABLE "Duty"
  ADD CONSTRAINT "Duty_forcedFacultyId_fkey"
  FOREIGN KEY ("forcedFacultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
