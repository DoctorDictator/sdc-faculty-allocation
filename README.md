# FacultyFlow

A browser-based smart faculty allocation and schedule repair platform. The Next.js application provides the HOD and faculty workspaces, PostgreSQL stores versioned schedules and audit history, and a separate FastAPI service solves allocation proposals with OR-Tools CP-SAT.

## Run the web app

Requirements: Docker Desktop with Compose and available ports 3000, 5432, and 8000. Change the database and optimizer host ports in `.env` if needed.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). On first startup, Compose creates the database, applies migrations, and loads a demonstration department with 50 faculty, 12 events, 36 duty roles, skill profiles, and availability blocks. Seed data is not reapplied after the database contains faculty records.

Local demo accounts:

| Role | Email | Password |
| --- | --- | --- |
| HOD | `hod@faculty.local` | `LocalOnly-HOD-2026` |
| Faculty | `faculty@faculty.local` | `LocalOnly-Faculty-2026` |

The HOD can generate allocation or rebalance proposals, add events and roles, record absences, review changes, manage faculty sign-ins, and publish approved schedule versions. Faculty accounts can view their own assignments, set duty preferences, and report their own absences. The solver never writes to the published version; a proposal becomes live only after an HOD approval transaction confirms its baseline and input snapshot are still current.

## Public CSE faculty directory

Open `http://localhost:3000/directory` to browse the Manipal University Jaipur Department of Computer Science & Engineering faculty profiles. The checked-in snapshot contains all 89 CSE entries on the university's dedicated faculty list and their locally stored photos; 79 profiles list a public email address. Profiles without a published email are marked accordingly. The directory is public and separate from the scheduling records, so importing this reference data does not change who the solver can assign.

The source pages and refresh script are:

- Department page: <https://jaipur.manipal.edu/fosta/department-of-Computer-Science-Engineering.php>
- Faculty list and individual profiles: <https://jaipur.manipal.edu/fosta/faculty-list.php>
- Refresh snapshot and local photos from the repository root: `python apps/web/scripts/refresh_faculty_directory.py`

To change the demo credentials, edit `.env` before the first run. For a later reset of the demo records, stop the stack and run `docker compose down -v`, then start it again. This removes the local database volume.

## Local development

Run PostgreSQL and the optimizer with Compose, then run Next.js from its app folder:

```powershell
docker compose up -d db optimizer
Set-Location apps/web
npm install
Copy-Item .env.local.example .env.local
npx prisma generate
npm run db:deploy
npm run db:seed
npm run dev
```

The Compose service uses `OPTIMIZER_URL=http://optimizer:8000`. When running the web app directly on Windows, set `OPTIMIZER_URL=http://localhost:8000` in `apps/web/.env.local` and keep the optimizer service running in Compose. Use the `DATABASE_URL` and Auth.js secret values from `apps/web/.env.local.example`; the database password must match the root `.env` value.

## Workflows in this version

- **Initial allocation:** CP-SAT assigns qualified and available faculty, prevents overlapping duties, respects maximum workload, and balances the highest workload before preferences.
- **Faculty event staffing requests:** faculty can request an event with its date, time, task and headcount. The HOD can adjust the role, count and qualification, then approve it into the event register or decline it with a note. Approved duties enter the normal optimizer proposal; the HOD reviews and publishes the faculty assignments.
- **Rolling planning:** the optimizer works over the next 90 days by default. Change `SCHEDULING_HORIZON_DAYS` from 7 to 365 days to adjust the window; assignments beyond it are carried into new versions until they enter the active window.
- **Dynamic repair:** an absence, event change, or faculty profile update is recorded and asks CP-SAT to cover affected roles while minimizing changes. HODs can also preview a hypothetical absence in the Scenario Lab without changing live data.
- **Proposal governance:** each solution is stored as a candidate schedule version. HOD review shows the complete roster, changed assignments, uncovered roles, explanations, and objective levels. The HOD can protect a published assignment from reallocation; faculty can confirm their own assignments. Approval rechecks the published parent and a SHA-256 fingerprint of scheduling inputs inside a serializable transaction before publishing.
- **Fairness:** the solver uses sequential objectives: cover the most roles, prefer higher-priority coverage, preserve protected assignments, minimize schedule changes for repair/rebalance, minimize maximum capacity utilization, reduce deviation from target utilization, then respect faculty preferences. The API reports whether each level was proven optimal; time-limited feasible solutions are labelled `FEASIBLE`.
- **Auditability:** schedule versions, solver runs, absences, event changes, profile changes, and proposal decisions appear in the web dashboard history.
- **Explainers:** uncovered roles and reassignment changes include a reason based on qualification, availability, overlap, workload, or lower-priority balance/preference improvements.

The planner models fixed-time duties. Variable event start times, minimum-cost-flow fast repair, email delivery, background queues, and production deployment hardening remain follow-on work. Demo credentials and Compose defaults are for a local development environment.

## Verification

Run the mathematical optimizer tests:

```powershell
Set-Location services/optimizer
python -m pip install -r requirements.txt
python -m pytest -q
```

Run the web type check:

```powershell
Set-Location apps/web
npm run typecheck
```
