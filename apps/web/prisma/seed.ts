import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed PostgreSQL.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function futureAt(dayOffset: number, hour: number, minute = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const localIndia = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + dayOffset, hour, minute));
  return new Date(localIndia.getTime() - 330 * 60_000);
}

async function main() {
  const existingFaculty = await prisma.faculty.count();
  if (existingFaculty > 0 && process.env.SEED_RESET !== "1") {
    console.log(`Database already has ${existingFaculty} faculty records; skipping demo seed.`);
    return;
  }
  await prisma.$transaction([
    prisma.assignment.deleteMany(),
    prisma.solverRun.deleteMany(),
    prisma.disruption.deleteMany(),
    prisma.scheduleVersion.deleteMany(),
    prisma.availabilityBlock.deleteMany(),
    prisma.preferenceCost.deleteMany(),
    prisma.duty.deleteMany(),
    prisma.event.deleteMany(),
    prisma.user.deleteMany(),
    prisma.faculty.deleteMany(),
  ]);

  const skillNames = [
    "invigilation",
    "coordination",
    "lab_safety",
    "viva_panel",
    "admissions",
    "seminar_host",
    "accreditation",
    "accessibility",
  ];
  const facultyRows = Array.from({ length: 50 }, (_, index) => {
    const skills = ["invigilation"];
    if (index % 5 < 2 || index < 6) skills.push("coordination");
    if (index % 4 === 0) skills.push("lab_safety");
    if (index % 3 === 0) skills.push("viva_panel");
    if (index % 6 === 0) skills.push("admissions");
    if (index % 8 === 0) skills.push("seminar_host");
    if (index % 10 === 0) skills.push("accreditation");
    if (index % 7 === 0) skills.push("accessibility");
    return {
      id: `faculty-${String(index + 1).padStart(3, "0")}`,
      employeeCode: `FC-${String(index + 1).padStart(3, "0")}`,
      name: `Faculty ${String(index + 1).padStart(2, "0")}`,
      title: index % 4 === 0 ? "Associate Professor" : index % 3 === 0 ? "Senior Lecturer" : "Assistant Professor",
      department: "Computer Science",
      skills,
      active: true,
      targetMinutes: 240,
      maxMinutes: 480,
      committedMinutes: (index % 5) * 30,
    };
  });
  await prisma.faculty.createMany({ data: facultyRows });

  const hodEmail = (process.env.DEMO_HOD_EMAIL || "hod@faculty.local").toLowerCase();
  const hodPassword = process.env.DEMO_HOD_PASSWORD || "LocalOnly-HOD-2026";
  const hodPasswordHash = await bcrypt.hash(hodPassword, 12);
  await prisma.user.create({
    data: {
      email: hodEmail,
      name: "Dr. Maya Rao",
      passwordHash: hodPasswordHash,
      role: "HOD",
    },
  });

  const facultyEmail = (process.env.DEMO_FACULTY_EMAIL || "faculty@faculty.local").toLowerCase();
  const facultyPassword = process.env.DEMO_FACULTY_PASSWORD || "LocalOnly-Faculty-2026";
  await prisma.user.create({
    data: {
      email: facultyEmail,
      name: "Faculty 01",
      passwordHash: await bcrypt.hash(facultyPassword, 12),
      role: "FACULTY",
      facultyId: facultyRows[0].id,
    },
  });

  const eventDefinitions = Array.from({ length: 12 }, (_, index) => {
    const dayOffset = 1 + Math.floor(index / 3);
    const hour = [9, 10, 13][index % 3];
    const startsAt = futureAt(dayOffset, hour);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const eventName = [
      "Midterm assessment",
      "Capstone viva",
      "Research review",
      "Lab practical",
      "Admissions panel",
      "Department seminar",
    ][index % 6];
    return {
      id: `event-${String(index + 1).padStart(3, "0")}`,
      name: `${eventName} ${String(index + 1).padStart(2, "0")}`,
      startsAt,
      endsAt,
      priority: index % 4 === 0 ? 3 : index % 2 === 0 ? 2 : 1,
      status: "PLANNED" as const,
      duties: {
        create: [
          { id: `duty-${index + 1}-coord`, role: "Coordinator", requiredSkill: "coordination", positionIndex: 1, minutes: 120 },
          { id: `duty-${index + 1}-inv-1`, role: "Invigilator", requiredSkill: "invigilation", positionIndex: 1, minutes: 120 },
          { id: `duty-${index + 1}-inv-2`, role: "Invigilator", requiredSkill: "invigilation", positionIndex: 2, minutes: 120 },
        ],
      },
    };
  });
  await prisma.event.createMany({ data: eventDefinitions.map(({ duties: _duties, ...event }) => event) });
  await prisma.duty.createMany({ data: eventDefinitions.flatMap((event) => event.duties.create.map((duty) => ({ ...duty, eventId: event.id }))) });

  const preferenceRows = eventDefinitions.flatMap((event) =>
    event.duties.create.flatMap((duty) =>
      facultyRows.map((person) => ({
        dutyId: duty.id,
        facultyId: person.id,
        cost: 5,
      })),
    ),
  );
  await prisma.preferenceCost.createMany({ data: preferenceRows });

  await prisma.availabilityBlock.createMany({
    data: [
      { facultyId: facultyRows[0].id, startsAt: futureAt(1, 8), endsAt: futureAt(1, 12), reason: "Research commitment" },
      { facultyId: facultyRows[2].id, startsAt: futureAt(2, 12), endsAt: futureAt(2, 17), reason: "Approved leave" },
      { facultyId: facultyRows[7].id, startsAt: futureAt(5, 8), endsAt: futureAt(5, 16), reason: "Conference travel" },
      { facultyId: facultyRows[13].id, startsAt: futureAt(6, 10), endsAt: futureAt(6, 14), reason: "Academic duty" },
    ],
  });

  console.log(`Seeded ${facultyRows.length} faculty, ${eventDefinitions.length} events, and ${eventDefinitions.length * 3} duty roles.`);
  console.log(`Demo HOD login: ${hodEmail} / ${hodPassword}`);
  console.log(`Demo faculty login: ${facultyEmail} / ${facultyPassword}`);
  console.log(`Seeded skills: ${skillNames.join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
