"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import ThemeToggle from "@/components/theme-toggle";
import {
  ArrowRight,
  Bell,
  Beaker,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";

type User = { id: string; name: string; email: string; role: "HOD" | "FACULTY"; facultyId: string | null };
type Faculty = {
  id: string; employeeCode: string; name: string; title: string; department: string; skills: string[];
  active: boolean; hasLogin: boolean; loginEmail: string | null; targetMinutes: number; maxMinutes: number; committedMinutes: number; workloadMinutes: number; assignmentCount: number;
};
type Duty = { id: string; role: string; requiredSkill: string | null; positionIndex: number; minutes: number; facultyId: string | null; assignmentId: string | null; protected: boolean; acknowledged: boolean; facultyName: string | null; assignedElsewhere: boolean };
type EventItem = { id: string; name: string; startsAt: string; endsAt: string; priority: number; status: string; inPlanningWindow: boolean; dutyCount: number; assignedCount: number; duties: Duty[] };
type Proposal = { id: number; status: string; solverStatus: string; createdAt: string; createdBy: string; assignmentCount: number; changedCount: number; mode: string; uncoveredCount: number };
type ScheduleVersionRow = { id: number; parentId: number | null; status: string; solverStatus: string; assignmentCount: number; createdBy: string; approvedBy: string | null; rejectedBy: string | null; createdAt: string; approvedAt: string | null; rejectedAt: string | null; rejectionReason: string | null };
type PreferenceItem = { dutyId: string; eventName: string; startsAt: string; role: string; positionIndex: number; cost: number };
type DisruptionItem = { id: string; type: string; startsAt: string | null; endsAt: string | null; reason: string | null; action: string | null; optimizerStatus: string | null; createdAt: string; facultyName: string | null; eventName: string | null; proposedVersionId: number | null; proposalStatus: string | null };
type SolverRunItem = { id: number; status: string; wallTimeMs: number | null; createdAt: string; scheduleVersionId: number | null; objectiveCount: number; candidateVariables: number | null; branches: number | null };
type ScenarioResult = {
  status: string; hasSolution: boolean; lexicographicComplete: boolean; mode: string; changedCount: number; assignmentCount: number;
  uncovered: Array<{ duty_id: string; role: string; event_name: string; reason: string }>;
  changes: Array<{ dutyId: string; eventName: string; role: string; startsAt: string; from: string | null; to: string | null }>;
  objectiveLevels: Array<{ objective: string; value?: number; status: string }>;
  solverStats: Record<string, number>;
  scenario: { facultyName: string; startsAt: string; endsAt: string };
};
type ProposalDetail = {
  id: number; status: string; solverStatus: string; createdAt: string; createdBy: string; parentId: number | null; isStale: boolean;
  mode: string; lexicographicComplete: boolean;
  objectiveLevels: Array<{ objective: string; value?: number; status: string }>;
  solverStats: Record<string, number>;
  assignments: Array<{ dutyId: string; eventName: string; role: string; requiredSkill: string | null; startsAt: string; endsAt: string; priority: number; facultyId: string; facultyName: string; protected: boolean; acknowledged: boolean }>;
  changes: Array<{ dutyId: string; eventName: string; role: string; startsAt: string; priority: number; from: { id: string; name: string } | null; to: { id: string; name: string } | null; protected: boolean; reason: string }>;
  uncovered: Array<{ duty_id: string; role: string; event_name: string; reason: string }>;
};
type DashboardData = {
  user: User;
  currentVersion: { id: number; createdAt: string } | null;
  optimizerOnline: boolean;
  planningHorizonDays: number;
  stats: { activeFaculty: number; eventCount: number; dutyCount: number; assignedCount: number; openRoles: number; coveragePercent: number; conflictCount: number; maxWorkloadMinutes: number; workloadSpreadMinutes: number; openProposalCount: number; activeAbsenceCount: number };
  faculty: Faculty[];
  events: EventItem[];
  proposals: Proposal[];
  absences: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null; faculty: { id: string; name: string } }>;
  preferences: PreferenceItem[];
  versions: ScheduleVersionRow[];
  disruptions: DisruptionItem[];
  solverRuns: SolverRunItem[];
};

type Section = "Overview" | "Schedule" | "Scenarios" | "Faculty" | "Events" | "Availability" | "Preferences" | "Approvals";
type EventRole = { role: string; requiredSkill: string; count: number };

const sections: { name: Section; icon: typeof LayoutDashboard; label: string }[] = [
  { name: "Overview", icon: LayoutDashboard, label: "Overview" },
  { name: "Schedule", icon: CalendarDays, label: "Schedule" },
  { name: "Scenarios", icon: Beaker, label: "Scenario lab" },
  { name: "Faculty", icon: Users, label: "Faculty" },
  { name: "Events", icon: CalendarPlus, label: "Events & duties" },
  { name: "Availability", icon: Clock3, label: "Availability" },
  { name: "Preferences", icon: Sparkles, label: "My preferences" },
  { name: "Approvals", icon: ClipboardCheck, label: "Proposals" },
];

function dateTimeField(offset: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTime(value: string | Date) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function shortDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function timeRange(start: string | Date, end: string | Date) {
  const format = (value: string | Date) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));
  return `${format(start)} – ${format(end)}`;
}

function fullDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function initials(value: string) {
  return value.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function classForPriority(priority: number) {
  return priority >= 3 ? "priority-high" : priority === 2 ? "priority-medium" : "priority-low";
}

export default function Dashboard({ user }: { user: User }) {
  const [section, setSection] = useState<Section>("Overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"event" | "reschedule" | "absence" | "faculty" | null>(null);
  const [editingFaculty, setEditingFaculty] = useState<Faculty | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [loginAccess, setLoginAccess] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [proposalDetails, setProposalDetails] = useState<Record<number, ProposalDetail>>({});
  const [openProposalId, setOpenProposalId] = useState<number | null>(null);
  const [proposalLoadingId, setProposalLoadingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [eventRoles, setEventRoles] = useState<EventRole[]>([
    { role: "Coordinator", requiredSkill: "coordination", count: 1 },
    { role: "Invigilator", requiredSkill: "invigilation", count: 2 },
  ]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the scheduling workspace.");
      setData(await response.json());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function toggleProposalDetails(id: number) {
    if (openProposalId === id) {
      setOpenProposalId(null);
      return;
    }
    setOpenProposalId(id);
    if (proposalDetails[id]) return;
    setProposalLoadingId(id);
    try {
      const response = await fetch(`/api/proposals/${id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load proposal details.");
      setProposalDetails((current) => ({ ...current, [id]: result as ProposalDetail }));
    } catch (cause) {
      setOpenProposalId(null);
      setError(cause instanceof Error ? cause.message : "Could not load proposal details.");
    } finally {
      setProposalLoadingId(null);
    }
  }

  const isHod = user.role === "HOD";
  const visibleFaculty = useMemo(() => {
    const rows = data?.faculty ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((person) => `${person.name} ${person.employeeCode} ${person.title} ${person.skills.join(" ")}`.toLowerCase().includes(query));
  }, [data?.faculty, search]);

  async function generateProposal() {
    if (!isHod) return;
    setBusy("optimize");
    setError("");
    try {
      const mode = data?.currentVersion ? "REBALANCE" : "ALLOCATE";
      const response = await fetch("/api/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Proposal generation failed.");
      setToast(`Proposal ${result.proposalId} is ready for review.`);
      setSection("Approvals");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposal generation failed.");
    } finally {
      setBusy("");
    }
  }

  async function approveProposal(id: number) {
    setBusy(`approve-${id}`);
    setError("");
    try {
      const response = await fetch(`/api/proposals/${id}/approve`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not publish this schedule.");
      setOpenProposalId(null);
      setProposalDetails({});
      setToast(`Schedule V${result.versionId} is now published.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setBusy("");
    }
  }

  async function rejectProposal(id: number) {
    setBusy(`reject-${id}`);
    setError("");
    try {
      const reason = window.prompt("Why are you rejecting this proposal?", "");
      if (reason === null) return;
      if (reason.trim().length > 240) throw new Error("Keep the rejection reason under 240 characters.");
      const response = await fetch(`/api/proposals/${id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not reject this proposal.");
      setOpenProposalId(null);
      setProposalDetails({});
      setToast(`Proposal V${id} was rejected.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposal rejection failed.");
    } finally {
      setBusy("");
    }
  }

  async function removeAbsence(id: string) {
    setBusy(`absence-${id}`);
    setError("");
    try {
      const response = await fetch(`/api/absences/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update availability.");
      setSection(result.proposalId ? "Approvals" : "Availability");
      setToast(result.proposalId ? `Availability updated. Repair proposal ${result.proposalId} is ready.` : result.warning || "Availability updated.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update availability.");
    } finally {
      setBusy("");
    }
  }

  async function savePreference(dutyId: string, cost: number) {
    setBusy(`preference-${dutyId}`);
    setError("");
    try {
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dutyId, cost }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this preference.");
      setData((current) => current ? {
        ...current,
        preferences: current.preferences.map((item) => item.dutyId === dutyId ? { ...item, cost } : item),
      } : current);
      setToast("Preference saved for your next schedule proposal.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this preference.");
    } finally {
      setBusy("");
    }
  }

  async function updateAssignment(assignmentId: string, field: "acknowledged" | "protected", value: boolean) {
    setBusy("assignment-" + assignmentId);
    setError("");
    try {
      const response = await fetch("/api/assignments/" + assignmentId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update this assignment.");
      setToast(field === "acknowledged"
        ? value ? "Assignment confirmed." : "Assignment confirmation removed."
        : value ? "Assignment protected from reallocation." : "Assignment protection removed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this assignment.");
    } finally {
      setBusy("");
    }
  }

  async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("event");
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      startsAt: new Date(String(form.get("startsAt"))).toISOString(),
      endsAt: new Date(String(form.get("endsAt"))).toISOString(),
      priority: Number(form.get("priority") || 1),
      roles: eventRoles,
    };
    try {
      const response = await fetch(editingEvent ? `/api/events/${editingEvent.id}` : "/api/events", {
        method: editingEvent ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingEvent ? { action: "reschedule", startsAt: payload.startsAt, endsAt: payload.endsAt, priority: payload.priority } : payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add the event.");
      setModal(null);
      if (!editingEvent) setEventRoles([
        { role: "Coordinator", requiredSkill: "coordination", count: 1 },
        { role: "Invigilator", requiredSkill: "invigilation", count: 2 },
      ]);
      setEditingEvent(null);
      setToast(editingEvent ? result.proposalId ? `Event rescheduled. Repair proposal ${result.proposalId} is ready.` : result.warning || "Event rescheduled." : "Event added and recorded. Generate a schedule proposal when you are ready.");
      setSection(editingEvent && result.proposalId ? "Approvals" : "Events");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the event.");
    } finally {
      setBusy("");
    }
  }

  async function saveAbsence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("absence");
    setError("");
    const form = new FormData(event.currentTarget);
    const facultyId = isHod ? String(form.get("facultyId") || "") : (user.facultyId ?? "");
    const payload = {
      facultyId,
      startsAt: new Date(String(form.get("startsAt"))).toISOString(),
      endsAt: new Date(String(form.get("endsAt"))).toISOString(),
      reason: String(form.get("reason") || ""),
    };
    try {
      const response = await fetch("/api/absences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not report the absence.");
      setModal(null);
      setSection(result.proposalId ? "Approvals" : "Overview");
      setToast(result.proposalId ? `Absence recorded and repair proposal ${result.proposalId} created.` : result.warning || "Absence recorded.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not report the absence.");
    } finally {
      setBusy("");
    }
  }

  function openFacultyForm(person: Faculty | null = null) {
    setEditingFaculty(person);
    setLoginAccess(false);
    setError("");
    setModal("faculty");
  }

  function openEventReschedule(event: EventItem) {
    setEditingEvent(event);
    setError("");
    setModal("reschedule");
  }

  function openNewEvent() {
    setEditingEvent(null);
    setEventRoles([
      { role: "Coordinator", requiredSkill: "coordination", count: 1 },
      { role: "Invigilator", requiredSkill: "invigilation", count: 2 },
    ]);
    setError("");
    setModal("event");
  }

  async function cancelEvent(event: EventItem) {
    if (!window.confirm(`Cancel ${event.name}? The optimizer will prepare an updated proposal.`)) return;
    setBusy(`cancel-${event.id}`);
    setError("");
    try {
      const response = await fetch(`/api/events/${event.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not cancel this event.");
      setToast(result.proposalId ? `Event cancelled. Repair proposal ${result.proposalId} is ready.` : result.warning || "Event cancelled.");
      setSection(result.proposalId ? "Approvals" : "Events");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel this event.");
    } finally {
      setBusy("");
    }
  }

  async function saveFaculty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("faculty");
    setError("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      employeeCode: String(form.get("employeeCode") || "").trim(),
      name: String(form.get("name") || "").trim(),
      title: String(form.get("title") || "").trim(),
      department: String(form.get("department") || "").trim(),
      skills: String(form.get("skills") || "").split(",").map((skill) => skill.trim()).filter(Boolean),
      targetMinutes: Math.round(Number(form.get("targetHours") || 0) * 60),
      maxMinutes: Math.round(Number(form.get("maxHours") || 0) * 60),
      active: editingFaculty ? form.get("active") === "on" : true,
    };
    if (loginAccess) {
      payload.login = { email: String(form.get("accountEmail") || "").trim(), password: String(form.get("accountPassword") || "") };
    }
    try {
      const response = await fetch(editingFaculty ? `/api/faculty/${editingFaculty.id}` : "/api/faculty", {
        method: editingFaculty ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this faculty profile.");
      setModal(null);
      setToast(result.proposalId
        ? `Profile updated. Repair proposal ${result.proposalId} is ready for review.`
        : result.warning || (loginAccess ? "Faculty profile and sign-in saved." : editingFaculty ? "Faculty profile updated." : "Faculty profile added."));
      setSection(result.proposalId ? "Approvals" : "Faculty");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this faculty profile.");
    } finally {
      setBusy("");
    }
  }

  const sectionTitle = section === "Events" ? "Events & duties" : section;
  const today = fullDate(new Date());

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup"><span className="brand-mark"><CalendarDays size={18} strokeWidth={2.2} /></span><span>FacultyFlow</span></div>
        <div className="workspace-picker"><span className="workspace-avatar">CS</span><span className="workspace-copy"><strong>Computer Science</strong><small>Department workspace</small></span><span className="workspace-chevron">⌄</span></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {sections.filter((item) => (item.name !== "Preferences" || !isHod) && (item.name !== "Scenarios" || isHod)).map(({ name, icon: Icon, label }) => (
            <button className={`nav-item ${section === name ? "active" : ""}`} key={name} onClick={() => { setSection(name); setMobileNavOpen(false); }}>
              <Icon size={17} strokeWidth={1.9} /><span>{label}</span>
              {name === "Approvals" && Boolean(data?.stats.openProposalCount) && <span className="nav-count">{data?.stats.openProposalCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="solver-card"><div className="solver-card-icon"><Zap size={15} fill="currentColor" /></div><div><strong>{data?.optimizerOnline ? "Optimizer online" : data ? "Optimizer offline" : "Checking optimizer"}</strong><small>CP-SAT · {data?.optimizerOnline ? "Ready" : data ? "Unavailable" : "Connecting"}</small></div><span className={`online-dot ${data && !data.optimizerOnline ? "offline" : ""}`} /></div>
          <button className="nav-item help-item" onClick={() => setToast("Need a hand? Review the project README for setup and demo access.")}><CircleAlert size={17} /><span>Help & documentation</span></button>
          <div className="account-row"><span className="avatar avatar-user">{initials(user.name)}</span><span className="account-copy"><strong>{user.name}</strong><small>{isHod ? "Head of department" : "Faculty member"}</small></span><button title="Sign out" aria-label="Sign out" className="icon-button sign-out" onClick={() => void signOut({ redirectTo: "/login" })}><LogOut size={16} /></button></div>
        </div>
      </aside>
      {mobileNavOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{sectionTitle}</strong></div>
          <div className="topbar-right"><ThemeToggle /><div className="date-chip"><CalendarDays size={15} />{today}</div><span className="topbar-divider" /><button className="icon-button notification-button" title="Notifications" onClick={() => setSection("Approvals")}><Bell size={17} />{Boolean(data?.stats.openProposalCount) && <i />}</button><span className="avatar avatar-small">{initials(user.name)}</span></div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow">{isHod ? "DEPARTMENT OPERATIONS" : "FACULTY WORKSPACE"}</div><h1>{section === "Overview" ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}` : sectionTitle}</h1><p>{section === "Overview" ? "Your department schedule, workload and changes in one place." : section === "Schedule" ? "A clear view of who is assigned, when and where." : section === "Scenarios" ? "Explore a hypothetical absence and see the likely schedule repair without changing the live plan." : section === "Faculty" ? "Skills, availability and workload at a glance." : section === "Events" ? "Create academic activities and define the roles they need." : section === "Availability" ? "Review reported time away and correct availability records." : section === "Preferences" ? "Tell the planner which duties fit you best." : "Review solver proposals before anything goes live."}</p></div>
            <div className="heading-actions">
              <button className="button button-secondary" onClick={() => setModal("absence")}><CircleAlert size={16} />Report absence</button>
              {isHod && <button className="button button-primary" onClick={() => void generateProposal()} disabled={busy === "optimize" || data?.optimizerOnline === false} title={data?.optimizerOnline === false ? "Start the optimizer service to create a schedule." : undefined}><Sparkles size={16} />{busy === "optimize" ? "Optimizing…" : data?.optimizerOnline === false ? "Optimizer offline" : data?.currentVersion ? "Rebalance schedule" : "Generate allocation"}</button>}
            </div>
          </div>

          {error && <div className="inline-alert" role="alert"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setError("")}><X size={16} /></button></div>}
          {loading && !data ? <LoadingState /> : data ? (
            <>
              {section === "Overview" && <Overview data={data} isHod={isHod} openEvent={openNewEvent} jumpTo={setSection} />}
              {section === "Schedule" && <ScheduleSection events={data.events.filter((event) => event.inPlanningWindow)} currentVersion={data.currentVersion} versions={data.versions} disruptions={data.disruptions} solverRuns={data.solverRuns} isHod={isHod} planningHorizonDays={data.planningHorizonDays} busy={busy} updateAssignment={updateAssignment} />}
              {section === "Scenarios" && isHod && <ScenarioSection faculty={data.faculty} optimizerOnline={data.optimizerOnline} planningHorizonDays={data.planningHorizonDays} />}
              {section === "Faculty" && <FacultySection faculty={visibleFaculty} search={search} setSearch={setSearch} reportAbsence={() => setModal("absence")} isHod={isHod} addFaculty={() => openFacultyForm()} editFaculty={openFacultyForm} />}
              {section === "Events" && <EventsSection events={data.events} isHod={isHod} openEvent={openNewEvent} reschedule={openEventReschedule} cancelEvent={cancelEvent} busy={busy} />}
              {section === "Availability" && <AvailabilitySection absences={data.absences} isHod={isHod} busy={busy} removeAbsence={removeAbsence} />}
              {section === "Preferences" && <PreferencesSection preferences={data.preferences} busy={busy} save={savePreference} />}
              {section === "Approvals" && <ApprovalsSection proposals={data.proposals} isHod={isHod} busy={busy} approve={approveProposal} reject={rejectProposal} generate={generateProposal} details={proposalDetails} openId={openProposalId} loadingId={proposalLoadingId} toggleDetails={toggleProposalDetails} optimizerOnline={data.optimizerOnline} />}
            </>
          ) : <div className="empty-workspace"><CircleAlert size={22} /><h2>Workspace unavailable</h2><p>{error || "Refresh the page to retry."}</p><button className="button button-primary" onClick={() => void refresh()}>Try again</button></div>}
          <footer className="page-footer"><span>FacultyFlow <i>·</i> Department scheduling workspace</span><span>All proposals require review before publishing.</span></footer>
        </div>
      </main>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setEditingEvent(null); setError(""); } }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-header"><div><div className="eyebrow">{modal === "event" || modal === "reschedule" ? "PLAN A DUTY" : modal === "absence" ? "UPDATE AVAILABILITY" : "FACULTY DIRECTORY"}</div><h2 id="modal-title">{modal === "event" ? "Add an event" : modal === "reschedule" ? "Reschedule event" : modal === "absence" ? "Report an absence" : editingFaculty ? "Edit faculty profile" : "Add faculty member"}</h2></div><button className="icon-button" aria-label="Close" onClick={() => { setModal(null); setError(""); }}><X size={19} /></button></div>
          {modal === "event" || modal === "reschedule" ? <form className="modal-form" onSubmit={saveEvent}>
            <label className="form-label">Event name<input name="name" defaultValue={editingEvent?.name ?? ""} placeholder="e.g. Semester 5 midterm" minLength={3} maxLength={160} required={!editingEvent} disabled={Boolean(editingEvent)} /></label>
            <div className="form-grid"><label className="form-label">Starts<input name="startsAt" type="datetime-local" defaultValue={editingEvent ? localDateTime(editingEvent.startsAt) : dateTimeField(1, 10)} required /></label><label className="form-label">Ends<input name="endsAt" type="datetime-local" defaultValue={editingEvent ? localDateTime(editingEvent.endsAt) : dateTimeField(1, 12)} required /></label></div>
            <label className="form-label">Priority<select name="priority" defaultValue={String(editingEvent?.priority ?? 2)}><option value="1">Standard</option><option value="2">Important</option><option value="3">Critical</option></select></label>
            {!editingEvent && <><div className="role-builder-title"><span>Required roles</span><button className="text-button" type="button" onClick={() => setEventRoles((roles) => [...roles, { role: "New role", requiredSkill: "invigilation", count: 1 }])}><Plus size={14} />Add role</button></div>
            <div className="role-builder">{eventRoles.map((role, index) => <div className="role-row" key={`${index}-${role.role}`}><input aria-label="Role name" value={role.role} onChange={(event) => setEventRoles((roles) => roles.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item))} required /><input aria-label="Required skill" value={role.requiredSkill} onChange={(event) => setEventRoles((roles) => roles.map((item, itemIndex) => itemIndex === index ? { ...item, requiredSkill: event.target.value } : item))} required /><select aria-label="Number of positions" value={role.count} onChange={(event) => setEventRoles((roles) => roles.map((item, itemIndex) => itemIndex === index ? { ...item, count: Number(event.target.value) } : item))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {value === 1 ? "position" : "positions"}</option>)}</select><button type="button" aria-label="Remove role" className="icon-button remove-role" disabled={eventRoles.length <= 1} onClick={() => setEventRoles((roles) => roles.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button></div>)}</div></>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => { setModal(null); setEditingEvent(null); }}>Cancel</button><button className="button button-primary" type="submit" disabled={busy === "event"}>{busy === "event" ? "Saving…" : editingEvent ? "Save schedule change" : "Add event"}</button></div>
          </form> : modal === "absence" ? <form className="modal-form" onSubmit={saveAbsence}>
            {isHod && <label className="form-label">Faculty member<select name="facultyId" required defaultValue=""><option value="" disabled>Select faculty</option>{data?.faculty.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.employeeCode}</option>)}</select></label>}
            <div className="form-grid"><label className="form-label">Unavailable from<input name="startsAt" type="datetime-local" defaultValue={dateTimeField(1, 9)} required /></label><label className="form-label">Available again<input name="endsAt" type="datetime-local" defaultValue={dateTimeField(1, 17)} required /></label></div>
            <label className="form-label">Reason <span className="optional-label">Optional</span><input name="reason" placeholder="Leave, illness, academic duty…" maxLength={240} /></label>
            <div className="modal-note"><ShieldCheck size={17} /><span>The optimizer will prepare a repair proposal. The published schedule changes only after HOD approval.</span></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy === "absence"}>{busy === "absence" ? "Finding replacements…" : "Report and reallocate"}</button></div>
          </form> : <form className="modal-form" onSubmit={saveFaculty}>
            <div className="form-grid"><label className="form-label">Employee code<input name="employeeCode" defaultValue={editingFaculty?.employeeCode ?? ""} placeholder="FC-051" required /></label><label className="form-label">Full name<input name="name" defaultValue={editingFaculty?.name ?? ""} placeholder="Faculty name" required /></label></div>
            <div className="form-grid"><label className="form-label">Academic title<input name="title" defaultValue={editingFaculty?.title ?? "Assistant Professor"} required /></label><label className="form-label">Department<input name="department" defaultValue={editingFaculty?.department ?? "Computer Science"} required /></label></div>
            <label className="form-label">Skills <span className="optional-label">Comma-separated qualification codes</span><input name="skills" defaultValue={editingFaculty?.skills.join(", ") ?? "invigilation"} placeholder="invigilation, lab_safety" required /></label>
            <div className="form-grid"><label className="form-label">Target workload · hours<input name="targetHours" type="number" min="0" max="168" step="0.5" defaultValue={(editingFaculty?.targetMinutes ?? 240) / 60} required /></label><label className="form-label">Maximum workload · hours<input name="maxHours" type="number" min="0.5" max="168" step="0.5" defaultValue={(editingFaculty?.maxMinutes ?? 480) / 60} required /></label></div>
            {editingFaculty && <label className="toggle-row"><input name="active" type="checkbox" defaultChecked={editingFaculty.active} /><span><strong>Active for new assignments</strong><small>Inactive faculty stay in historical schedule versions.</small></span></label>}
            <label className="toggle-row"><input type="checkbox" checked={loginAccess} onChange={(event) => setLoginAccess(event.target.checked)} /><span><strong>{editingFaculty?.hasLogin ? "Update faculty sign-in" : "Create a faculty sign-in"}</strong><small>{editingFaculty?.hasLogin ? "Set a new email or password for this account." : "Set the initial password for this faculty workspace."}</small></span></label>
            {loginAccess && <div className="form-grid"><label className="form-label">Login email<input name="accountEmail" type="email" defaultValue={editingFaculty?.loginEmail ?? ""} placeholder="faculty@department.edu" required /></label><label className="form-label">Password<input name="accountPassword" type="password" minLength={8} autoComplete="new-password" required /></label></div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy === "faculty"}>{busy === "faculty" ? "Saving…" : editingFaculty ? "Save changes" : "Add faculty"}</button></div>
          </form>}
        </section>
      </div>}
      {toast && <div className="toast-message" role="status"><CheckCircle2 size={18} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function LoadingState() {
  return <div className="loading-state"><div className="skeleton skeleton-title" /><div className="stats-grid">{[0, 1, 2, 3].map((item) => <div className="skeleton skeleton-stat" key={item} />)}</div><div className="skeleton skeleton-panel" /></div>;
}

function Overview({ data, isHod, openEvent, jumpTo }: { data: DashboardData; isHod: boolean; openEvent: () => void; jumpTo: (section: Section) => void }) {
  const { stats } = data;
  const topFaculty = [...data.faculty].sort((a, b) => b.workloadMinutes - a.workloadMinutes).slice(0, 6);
  const horizonEvents = data.events.filter((event) => event.inPlanningWindow);
  return <>
    {!data.currentVersion && isHod && <div className="first-plan-banner"><div className="first-plan-icon"><Sparkles size={18} /></div><div><strong>Your schedule is ready to be planned</strong><p>There are {stats.eventCount} upcoming events and {stats.dutyCount} roles. Generate a proposal to see a balanced allocation.</p></div><span className="first-plan-step">FIRST PLAN</span></div>}
    <div className="stats-grid">
      <StatCard label="Active faculty" value={stats.activeFaculty} detail="Available in the department" icon={<Users size={18} />} tone="teal" />
      <StatCard label="Upcoming events" value={stats.eventCount} detail={`${stats.dutyCount} roles to cover`} icon={<CalendarDays size={18} />} tone="blue" />
      <StatCard label="Current coverage" value={`${stats.coveragePercent}%`} detail={stats.openRoles ? `${stats.openRoles} roles still open` : "All roles currently assigned"} icon={<CheckCircle2 size={18} />} tone={stats.openRoles ? "amber" : "green"} />
      <StatCard label="Schedule conflicts" value={stats.conflictCount} detail={stats.conflictCount ? "Needs attention" : "No overlaps detected"} icon={<ShieldCheck size={18} />} tone={stats.conflictCount ? "red" : "green"} />
    </div>
    <div className="overview-grid">
      <section className="panel workload-panel">
        <div className="panel-heading"><div><div className="eyebrow">WORKLOAD BALANCE</div><h2>Faculty distribution</h2></div><button className="subtle-link" onClick={() => jumpTo("Faculty")}>View faculty <ArrowRight size={14} /></button></div>
        <div className="workload-legend"><span><i className="legend-dot legend-current" />Current assignments</span><span><i className="legend-dot legend-target" />Target workload</span></div>
        {topFaculty.length ? <div className="workload-list">{topFaculty.map((person) => {
          const width = Math.min(100, Math.round((person.workloadMinutes / Math.max(person.maxMinutes, 1)) * 100));
          const target = Math.min(100, Math.round((person.targetMinutes / Math.max(person.maxMinutes, 1)) * 100));
          return <div className="workload-row" key={person.id}><span className="workload-name">{person.name}</span><div className="workload-track"><span className="workload-fill" style={{ width: `${width}%` }} /><i className="target-marker" style={{ left: `${target}%` }} /></div><span className="workload-value">{(person.workloadMinutes / 60).toFixed(person.workloadMinutes % 60 ? 1 : 0)}h</span></div>;
        })}</div> : <EmptyInline title="No faculty records yet" body="Add faculty details to start planning." />}
        <div className="panel-footnote"><span>Max workload: <strong>{data.faculty.length ? `${Math.round(Math.min(...data.faculty.map((person) => person.maxMinutes)) / 60)}h per faculty` : "—"}</strong></span><span>Spread: <strong>{Math.floor(stats.workloadSpreadMinutes / 60)}h</strong></span></div>
      </section>
      <section className="panel health-panel">
        <div className="panel-heading"><div><div className="eyebrow">ALLOCATION HEALTH</div><h2>Schedule status</h2></div><span className={`status-pill ${data.currentVersion ? "status-published" : "status-draft"}`}><i />{data.currentVersion ? `V${data.currentVersion.id} published` : "Not published"}</span></div>
        <div className="coverage-ring-wrap"><div className="coverage-ring" style={{ "--coverage": `${stats.coveragePercent * 3.6}deg` } as React.CSSProperties}><div><strong>{stats.coveragePercent}%</strong><small>covered</small></div></div><div className="coverage-copy"><strong>{stats.assignedCount} of {stats.dutyCount} roles assigned</strong><span>{stats.openRoles ? `${stats.openRoles} roles need a faculty member.` : "Every duty currently has an assignment."}</span></div></div>
        <div className="health-checks"><div><span className="health-check-icon"><Check size={13} /></span><span>Qualification matching</span><strong>Enabled</strong></div><div><span className="health-check-icon"><Check size={13} /></span><span>Availability constraints</span><strong>Enabled</strong></div><div><span className="health-check-icon"><Check size={13} /></span><span>Workload balancing</span><strong>Enabled</strong></div></div>
        <button className="health-action" onClick={() => jumpTo("Approvals")}>{stats.openProposalCount ? `${stats.openProposalCount} proposal${stats.openProposalCount === 1 ? "" : "s"} to review` : "Open proposal queue"}<ChevronRight size={16} /></button>
      </section>
      <section className="panel upcoming-panel">
        <div className="panel-heading"><div><div className="eyebrow">NEXT UP</div><h2>Upcoming events</h2></div><button className="subtle-link" onClick={() => jumpTo("Events")}>View all <ArrowRight size={14} /></button></div>
        {horizonEvents.slice(0, 5).map((event) => <EventLine key={event.id} event={event} />)}
        {!horizonEvents.length && <EmptyInline title="No events in this planning window" body="Add an event or wait for an existing event to enter the rolling planning window." action={isHod ? <button className="text-button" onClick={openEvent}><Plus size={14} />Add an event</button> : undefined} />}
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading"><div><div className="eyebrow">ACTION CENTER</div><h2>Needs your attention</h2></div><span className="attention-count">{stats.openRoles + stats.openProposalCount}</span></div>
        {stats.openProposalCount > 0 && <button className="attention-item" onClick={() => jumpTo("Approvals")}><span className="attention-icon attention-purple"><ClipboardCheck size={16} /></span><span><strong>{stats.openProposalCount} schedule proposal{stats.openProposalCount === 1 ? "" : "s"}</strong><small>Review solver changes before publishing.</small></span><ChevronRight size={16} /></button>}
        {stats.openRoles > 0 && <button className="attention-item" onClick={() => jumpTo("Events")}><span className="attention-icon attention-orange"><CircleAlert size={16} /></span><span><strong>{stats.openRoles} open role{stats.openRoles === 1 ? "" : "s"}</strong><small>Upcoming duties need an assignment.</small></span><ChevronRight size={16} /></button>}
        {stats.conflictCount > 0 && <button className="attention-item" onClick={() => jumpTo("Schedule")}><span className="attention-icon attention-red"><ShieldCheck size={16} /></span><span><strong>Schedule overlap detected</strong><small>Rebalance to resolve this conflict.</small></span><ChevronRight size={16} /></button>}
        {!stats.openRoles && !stats.openProposalCount && !stats.conflictCount && <div className="all-clear"><span><CheckCircle2 size={17} /></span><div><strong>You are all caught up</strong><small>No open roles or approvals right now.</small></div></div>}
        {isHod && <button className="quick-add-link" onClick={openEvent}><Plus size={14} />Add a new event</button>}
      </section>
    </div>
  </>;
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string | number; detail: string; icon: React.ReactNode; tone: string }) {
  return <article className="stat-card"><div className={`stat-icon stat-${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></article>;
}

function EventLine({ event }: { event: EventItem }) {
  const isAssigned = event.assignedCount === event.dutyCount;
  return <div className="event-line"><div className="event-date-block"><strong>{new Intl.DateTimeFormat("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(event.startsAt))}</strong><small>{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(new Date(event.startsAt)).toUpperCase()}</small></div><div className="event-line-copy"><strong>{event.name}</strong><span><Clock3 size={12} />{timeRange(event.startsAt, event.endsAt)}<i>·</i>{event.dutyCount} roles</span></div><div className="event-line-state"><span className={`priority-dot ${classForPriority(event.priority)}`} />{isAssigned ? <span className="mini-status mini-done">Assigned</span> : <span className="mini-status mini-open">Open</span>}</div></div>;
}

function EmptyInline({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-inline"><strong>{title}</strong><span>{body}</span>{action}</div>;
}

function ScheduleSection({ events, currentVersion, versions, disruptions, solverRuns, isHod, planningHorizonDays, busy, updateAssignment }: {
  events: EventItem[];
  currentVersion: DashboardData["currentVersion"];
  versions: ScheduleVersionRow[];
  disruptions: DisruptionItem[];
  solverRuns: SolverRunItem[];
  isHod: boolean;
  planningHorizonDays: number;
  busy: string;
  updateAssignment: (assignmentId: string, field: "acknowledged" | "protected", value: boolean) => void;
}) {
  return <div className="section-stack">
    <section className="panel schedule-panel">
      <div className="panel-heading"><div><div className="eyebrow">DEPARTMENT CALENDAR</div><h2>Upcoming schedule</h2></div><span className="view-range">Next {planningHorizonDays} days{currentVersion ? " | Published V" + currentVersion.id : ""}</span></div>
      {events.length ? <div className="schedule-list">{events.map((event) => (
        <article className="schedule-event" key={event.id}>
          <div className="schedule-event-date"><strong>{new Intl.DateTimeFormat("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(event.startsAt))}</strong><span>{new Intl.DateTimeFormat("en-IN", { weekday: "short", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(event.startsAt))}</span></div>
          <div className="schedule-event-main">
            <div className="schedule-event-heading"><div><h3>{event.name}</h3><span><Clock3 size={13} />{timeRange(event.startsAt, event.endsAt)}</span></div><span className={"event-priority " + classForPriority(event.priority)}>{event.priority >= 3 ? "Critical" : event.priority === 2 ? "Important" : "Standard"}</span></div>
            <div className="duty-grid">{event.duties.map((duty) => <DutyAssignmentCard key={duty.id} duty={duty} roleCount={event.duties.filter((item) => item.role === duty.role).length} isHod={isHod} busy={busy} updateAssignment={updateAssignment} />)}</div>
          </div>
        </article>
      ))}</div> : <EmptyInline title="No events in this planning window" body={"Events within the next " + planningHorizonDays + " days will appear here."} />}
    </section>
    <section className="panel schedule-history">
      <div className="panel-heading"><div><div className="eyebrow">VERSION HISTORY</div><h2>Schedule versions</h2></div><span className="view-range">Published and reviewed history</span></div>
      {versions.length ? <div className="history-list">{versions.map((version) => <div className="history-row" key={version.id}>
        <span className={"history-version-icon history-" + version.status.toLowerCase()}>{version.status === "PUBLISHED" ? <CheckCircle2 size={15} /> : version.status === "REJECTED" ? <X size={15} /> : <ClipboardCheck size={15} />}</span>
        <div className="history-copy"><strong>Version {version.id} <span className={"history-status history-status-" + version.status.toLowerCase()}>{version.status}</span></strong><small>{shortDate(version.createdAt)} | created by {version.createdBy}{version.approvedBy ? " | approved by " + version.approvedBy : version.rejectedBy ? " | rejected by " + version.rejectedBy : ""}</small>{version.rejectionReason && <small className="history-reason">Reason: {version.rejectionReason}</small>}</div>
        <span className="history-count">{version.assignmentCount} roles</span>
      </div>)}</div> : <EmptyInline title="No schedule versions yet" body="The first approved proposal will appear here." />}
    </section>
    <section className="panel schedule-history">
      <div className="panel-heading"><div><div className="eyebrow">CHANGE AUDIT</div><h2>Recent disruptions</h2></div><span className="view-range">Recorded availability and event changes</span></div>
      {disruptions.length ? <div className="history-list">{disruptions.map((item) => <div className="disruption-row" key={item.id}>
        <span className="history-version-icon history-proposed">{item.type === "ABSENCE" ? <Clock3 size={15} /> : item.type === "EVENT_CHANGE" ? <CalendarDays size={15} /> : item.type === "ASSIGNMENT" ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}</span>
        <div className="history-copy"><strong>{item.type === "ABSENCE" ? "Availability change" : item.type === "EVENT_CHANGE" ? "Event change" : item.type === "ASSIGNMENT" ? "Assignment status" : "Workload rebalance"}{item.action ? <span className="history-action">{item.action}</span> : null}</strong><small>{shortDate(item.createdAt)}{item.facultyName ? " | " + item.facultyName : ""}{item.eventName ? " | " + item.eventName : ""}</small><small>{item.reason || "Change recorded"}{item.optimizerStatus ? " | optimizer " + item.optimizerStatus : ""}{item.proposedVersionId ? " | proposal V" + item.proposedVersionId : ""}</small></div>
        {item.proposalStatus && <span className={"history-status history-status-" + item.proposalStatus.toLowerCase()}>{item.proposalStatus}</span>}
      </div>)}</div> : <EmptyInline title="No changes recorded" body="Absences, event changes and optimization requests will appear here." />}
    </section>
    {isHod && <section className="panel schedule-history">
      <div className="panel-heading"><div><div className="eyebrow">SOLVER ACTIVITY</div><h2>Recent optimization runs</h2></div><span className="view-range">Latest 12 attempts</span></div>
      {solverRuns.length ? <div className="history-list">{solverRuns.map((run) => <div className="history-row" key={run.id}>
        <span className="history-version-icon history-proposed"><Sparkles size={15} /></span>
        <div className="history-copy"><strong>Run {run.id} <span className={run.status === "OPTIMAL" ? "history-status history-status-published" : run.status === "FEASIBLE" ? "history-status history-status-proposed" : "history-status history-status-rejected"}>{run.status}</span></strong><small>{shortDate(run.createdAt)} | {run.wallTimeMs === null ? "time unavailable" : (run.wallTimeMs / 1000).toFixed(2) + "s"}{run.scheduleVersionId ? " | proposal V" + run.scheduleVersionId : " | no proposal created"}</small><small>{run.candidateVariables === null ? "No candidate statistics returned" : run.candidateVariables + " candidate assignments"}{run.branches === null ? "" : " | " + run.branches + " search branches"}{run.objectiveCount ? " | " + run.objectiveCount + " objective levels" : ""}</small></div>
      </div>)}</div> : <EmptyInline title="No optimizer runs yet" body="Allocation and repair attempts will be recorded here." />}
    </section>}

  </div>;
}

function DutyAssignmentCard({ duty, roleCount, isHod, busy, updateAssignment }: {
  duty: Duty;
  roleCount: number;
  isHod: boolean;
  busy: string;
  updateAssignment: (assignmentId: string, field: "acknowledged" | "protected", value: boolean) => void;
}) {
  const assigned = Boolean(duty.assignmentId || duty.assignedElsewhere);
  const canManage = Boolean(duty.assignmentId && (isHod || (!duty.assignedElsewhere && duty.facultyId)));
  return <div className={"duty-card " + (assigned ? "duty-filled" : "duty-unfilled")}>
    <span className="duty-card-role">{duty.role}{roleCount > 1 ? " " + duty.positionIndex : ""}</span>
    <span className="duty-card-person">{duty.facultyName ? <><span className="avatar avatar-xs">{initials(duty.facultyName)}</span>{duty.facultyName}</> : duty.assignedElsewhere ? "Faculty assigned" : <><CircleAlert size={14} />Needs assignment</>}</span>
    {assigned && <span className="assignment-confirmation">{duty.protected ? "Protected by HOD" : duty.acknowledged ? "Confirmed" : ""}</span>}
    {canManage && duty.assignmentId && <button
      className="assignment-action"
      disabled={busy === "assignment-" + duty.assignmentId}
      onClick={() => updateAssignment(duty.assignmentId!, isHod ? "protected" : "acknowledged", isHod ? !duty.protected : !duty.acknowledged)}
    >{isHod ? duty.protected ? "Release protection" : "Protect" : duty.acknowledged ? "Withdraw" : "Confirm duty"}</button>}
  </div>;
}

function FacultySection({ faculty, search, setSearch, reportAbsence, isHod, addFaculty, editFaculty }: { faculty: Faculty[]; search: string; setSearch: (value: string) => void; reportAbsence: () => void; isHod: boolean; addFaculty: () => void; editFaculty: (person: Faculty) => void }) {
  const activeCount = faculty.filter((person) => person.active).length;
  return <div className="section-stack"><div className="section-summary-row"><div className="panel summary-chip"><span className="summary-chip-icon"><Users size={17} /></span><span><strong>{activeCount} active faculty</strong><small>Across this workspace</small></span></div><div className="panel summary-chip"><span className="summary-chip-icon lavender"><ShieldCheck size={17} /></span><span><strong>{new Set(faculty.flatMap((person) => person.skills)).size} skill groups</strong><small>Used for qualification matching</small></span></div></div>
    <section className="panel directory-panel"><div className="panel-heading"><div><div className="eyebrow">FACULTY DIRECTORY</div><h2>Faculty and workload</h2></div><div className="directory-actions"><label className="table-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search faculty" /></label>{isHod && <button className="button button-primary button-compact" onClick={addFaculty}><Plus size={14} />Add faculty</button>}</div></div>
      <div className="faculty-table-wrap"><table className="faculty-table"><thead><tr><th>Faculty member</th><th>Skills</th><th>Assignments</th><th>Workload</th><th>Status</th><th></th></tr></thead><tbody>{faculty.map((person) => <tr key={person.id}><td><div className="faculty-name-cell"><span className="avatar avatar-table">{initials(person.name)}</span><span><strong>{person.name}</strong><small>{person.title} · {person.employeeCode}</small></span></div></td><td><div className="skill-list">{person.skills.slice(0, 3).map((skill) => <span className="skill-chip" key={skill}>{skill.replaceAll("_", " ")}</span>)}{person.skills.length > 3 && <span className="skill-extra">+{person.skills.length - 3}</span>}</div></td><td><span className="assignment-count">{person.assignmentCount}</span></td><td><div className="faculty-workload"><span>{(person.workloadMinutes / 60).toFixed(person.workloadMinutes % 60 ? 1 : 0)}h <small>/ {Math.round(person.maxMinutes / 60)}h</small></span><div className="mini-track"><i style={{ width: `${Math.min(100, person.workloadMinutes / Math.max(1, person.maxMinutes) * 100)}%` }} /></div></div></td><td><span className={`faculty-status ${person.active ? "faculty-active" : "faculty-inactive"}`}><i />{person.active ? "Active" : "Inactive"}</span></td><td><div className="faculty-row-actions">{isHod && <button className="table-action" onClick={() => editFaculty(person)}>Edit</button>}<button className="table-action" onClick={reportAbsence}>Absence</button></div></td></tr>)}</tbody></table>{!faculty.length && <EmptyInline title="No matching faculty" body="Try another name, skill or employee code." />}</div>
    </section></div>;
}

function AvailabilitySection({ absences, isHod, busy, removeAbsence }: { absences: DashboardData["absences"]; isHod: boolean; busy: string; removeAbsence: (id: string) => void }) {
  return <div className="section-stack"><section className="panel availability-panel"><div className="panel-heading"><div><div className="eyebrow">TIME AWAY</div><h2>{isHod ? "Department availability" : "Your reported absences"}</h2></div><span className="proposal-total">{absences.length} active record{absences.length === 1 ? "" : "s"}</span></div>
    {absences.length ? <div className="absence-list">{absences.map((absence) => <article className="absence-row" key={absence.id}><span className="absence-icon"><Clock3 size={17} /></span><div className="absence-main"><strong>{absence.faculty.name}</strong><span>{shortDate(absence.startsAt)} · {timeRange(absence.startsAt, absence.endsAt)}</span></div><span className="absence-reason">{absence.reason || "Reported absence"}</span><button className="table-action" onClick={() => void removeAbsence(absence.id)} disabled={busy === `absence-${absence.id}`}>{busy === `absence-${absence.id}` ? "Updating…" : "Remove"}</button></article>)}</div> : <EmptyInline title="No active availability blocks" body="Reported leave and time away will appear here." />}
  </section><div className="event-tip"><ShieldCheck size={17} /><span><strong>Schedule safety</strong> Availability changes affect new proposals. The published schedule stays in effect until the HOD approves a replacement.</span></div></div>;
}

function PreferencesSection({ preferences, busy, save }: { preferences: PreferenceItem[]; busy: string; save: (dutyId: string, cost: number) => void }) {
  return <div className="section-stack"><div className="event-tip"><Sparkles size={17} /><span><strong>Your preferences inform the next proposal.</strong> Coverage, qualifications and availability remain higher priority than preference scores.</span></div>
    <section className="panel preference-panel"><div className="panel-heading"><div><div className="eyebrow">PERSONAL PREFERENCES</div><h2>Upcoming duty preferences</h2></div><span className="proposal-total">{preferences.length} roles</span></div>
      {preferences.length ? <div className="preference-list">{preferences.map((item) => <article className="preference-row" key={item.dutyId}><span className="preference-date"><strong>{new Intl.DateTimeFormat("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(item.startsAt))}</strong><small>{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(new Date(item.startsAt)).toUpperCase()}</small></span><div className="preference-copy"><strong>{item.eventName}</strong><span>{item.role}{item.positionIndex > 1 ? ` ${item.positionIndex}` : ""}</span></div><label className="preference-select-label"><span>Preference</span><select value={item.cost} disabled={busy === `preference-${item.dutyId}`} onChange={(event) => void save(item.dutyId, Number(event.target.value))}><option value={0}>Prefer</option><option value={5}>No preference</option><option value={20}>Avoid if possible</option></select></label></article>)}</div> : <EmptyInline title="No future duties to review" body="Your HOD will add upcoming duties to the schedule workspace." />}
    </section></div>;
}

function EventsSection({ events, isHod, openEvent, reschedule, cancelEvent, busy }: { events: EventItem[]; isHod: boolean; openEvent: () => void; reschedule: (event: EventItem) => void; cancelEvent: (event: EventItem) => void; busy: string }) {
  return <div className="section-stack"><section className="panel events-page-panel"><div className="panel-heading"><div><div className="eyebrow">EVENT REGISTER</div><h2>Activities requiring coverage</h2></div>{isHod && <button className="button button-primary button-compact" onClick={openEvent}><Plus size={15} />Add event</button>}</div>
    {events.length ? <div className="event-register">{events.map((event) => <div className="event-register-row" key={event.id}><span className={`event-type-icon ${classForPriority(event.priority)}`}><CalendarDays size={18} /></span><div className="event-register-main"><strong>{event.name}</strong>{!event.inPlanningWindow && <span className="outside-horizon-tag">Outside current planning window</span>}<span>{shortDate(event.startsAt)} · {timeRange(event.startsAt, event.endsAt)} · {event.dutyCount} roles</span></div><div className="event-progress"><div><span>{event.assignedCount}/{event.dutyCount} covered</span><strong>{event.dutyCount ? Math.round(event.assignedCount / event.dutyCount * 100) : 0}%</strong></div><div className="progress-track"><i style={{ width: `${event.dutyCount ? event.assignedCount / event.dutyCount * 100 : 0}%` }} /></div></div><span className={`event-priority ${classForPriority(event.priority)}`}>{event.priority >= 3 ? "Critical" : event.priority === 2 ? "Important" : "Standard"}</span>{isHod && <div className="event-register-actions"><button className="table-action" onClick={() => reschedule(event)}>Reschedule</button><button className="table-action table-action-danger" onClick={() => void cancelEvent(event)} disabled={busy === `cancel-${event.id}`}>{busy === `cancel-${event.id}` ? "Cancelling…" : "Cancel"}</button></div>}</div>)}</div> : <EmptyInline title="No upcoming events" body="Add academic events and the roles each one needs." action={isHod ? <button className="button button-primary button-compact" onClick={openEvent}><Plus size={15} />Add event</button> : undefined} />}
  </section><div className="event-tip"><Sparkles size={17} /><span><strong>Tip</strong> Define roles by skill and quantity. The optimizer will match only qualified faculty who are available during the event.</span></div></div>;
}

function ScenarioSection({ faculty, optimizerOnline, planningHorizonDays }: { faculty: Faculty[]; optimizerOnline: boolean; planningHorizonDays: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScenarioResult | null>(null);
  async function runScenario(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const startsAt = new Date(String(form.get("startsAt") || ""));
    const endsAt = new Date(String(form.get("endsAt") || ""));
    try {
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facultyId: String(form.get("facultyId") || ""), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not simulate this scenario.");
      setResult(payload as ScenarioResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not simulate this scenario.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }
  const activeFaculty = faculty.filter((person) => person.active);
  return <div className="section-stack">
    <div className="event-tip"><Beaker size={17} /><span><strong>Preview only.</strong> A scenario run does not change the published schedule, create a proposal or alter availability records.</span></div>
    <section className="panel scenario-panel">
      <div className="panel-heading"><div><div className="eyebrow">WHAT IF?</div><h2>Simulate a faculty absence</h2></div><span className="view-range">Next {planningHorizonDays} days</span></div>
      <p className="scenario-copy">Choose a time window to see how the optimizer would cover affected roles and whether other assignments would need to move.</p>
      <form className="scenario-form" onSubmit={runScenario}>
        <label className="form-label">Faculty member<select name="facultyId" required defaultValue=""><option value="" disabled>Select faculty</option>{activeFaculty.map((person) => <option key={person.id} value={person.id}>{person.name} | {person.employeeCode}</option>)}</select></label>
        <div className="form-grid"><label className="form-label">Unavailable from<input name="startsAt" type="datetime-local" defaultValue={dateTimeField(1, 9)} required /></label><label className="form-label">Available again<input name="endsAt" type="datetime-local" defaultValue={dateTimeField(1, 17)} required /></label></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!optimizerOnline && <div className="form-error" role="status">Start the optimizer service to run a scenario.</div>}
        <div className="scenario-form-actions"><button className="button button-primary" type="submit" disabled={busy || !optimizerOnline}><Beaker size={15} />{busy ? "Simulating..." : "Run scenario"}</button></div>
      </form>
    </section>
    {result && <section className="panel scenario-result">
      <div className="panel-heading"><div><div className="eyebrow">SIMULATION RESULT</div><h2>Absence: {result.scenario.facultyName}</h2></div><span className={result.status === "OPTIMAL" ? "solver-status solver-optimal" : result.status === "FEASIBLE" ? "solver-status solver-feasible" : "solver-status solver-error"}><i />{result.status}</span></div>
      <p className="scenario-copy">{shortDate(result.scenario.startsAt)} | {timeRange(result.scenario.startsAt, result.scenario.endsAt)}. {!result.hasSolution ? "No feasible candidate was returned." : result.lexicographicComplete ? "All objective levels were proven optimal." : "The optimizer found a feasible candidate; lower-priority objectives may improve with more solve time."}</p>
      {!result.hasSolution && <div className="proposal-stale-warning"><CircleAlert size={15} /><span>The solver did not return a feasible schedule for this scenario.</span></div>}
      <div className="proposal-detail-summary"><div><span>Assigned roles</span><strong>{result.assignmentCount}</strong></div><div><span>Assignments changed</span><strong>{result.changedCount}</strong></div><div><span>Uncovered roles</span><strong className={result.uncovered.length ? "metric-uncovered" : ""}>{result.uncovered.length}</strong></div><div><span>Solver time</span><strong>{(result.solverStats.total_wall_time_seconds ?? 0).toFixed(2)}s</strong></div></div>
      <div className="scenario-result-grid">
        <section className="proposal-review-section"><div className="proposal-review-heading"><h4>Reassignment chain</h4><span>{result.changes.length}</span></div>{!result.hasSolution ? <div className="proposal-empty-detail">No assignment comparison is available for this solver result.</div> : result.changes.length ? <div className="proposal-change-list">{result.changes.map((change) => <article className="proposal-change-row" key={change.dutyId}><div className="proposal-change-main"><strong>{change.eventName} | {change.role}</strong><small>{shortDate(change.startsAt)}</small></div><div className="proposal-change-arrow"><span>{change.from ?? "Unassigned"}</span><ArrowRight size={13} /><span>{change.to ?? "Uncovered"}</span></div></article>)}</div> : <div className="proposal-empty-detail">No published assignment needs to move.</div>}</section>
        <section className="proposal-review-section"><div className="proposal-review-heading"><h4>Roles left uncovered</h4><span className={result.uncovered.length ? "metric-uncovered" : ""}>{result.uncovered.length}</span></div>{!result.hasSolution ? <div className="proposal-empty-detail">The solver could not evaluate role coverage.</div> : result.uncovered.length ? <div className="proposal-uncovered-list">{result.uncovered.map((item) => <article key={item.duty_id}><strong>{item.event_name} | {item.role}</strong><p>{item.reason}</p></article>)}</div> : <div className="proposal-empty-detail">The current plan can cover every required role in this scenario.</div>}</section>
      </div>
      <section className="proposal-review-section"><div className="proposal-review-heading"><h4>Objective levels</h4><span>{result.objectiveLevels.length}</span></div><ol className="objective-level-list">{result.objectiveLevels.map((level, index) => <li key={level.objective}><span>{index + 1}</span><strong>{level.objective.replaceAll("_", " ")}</strong><b>{level.value ?? "--"}</b><small>{level.status}</small></li>)}</ol></section>
    </section>}
  </div>;
}

function ApprovalsSection({ proposals, isHod, busy, approve, reject, generate, details, openId, loadingId, toggleDetails, optimizerOnline }: {
  proposals: Proposal[];
  isHod: boolean;
  busy: string;
  approve: (id: number) => void;
  reject: (id: number) => void;
  generate: () => void;
  details: Record<number, ProposalDetail>;
  openId: number | null;
  loadingId: number | null;
  toggleDetails: (id: number) => void;
  optimizerOnline: boolean;
}) {
  return <div className="section-stack">
    <div className="approval-intro panel">
      <span className="approval-intro-icon"><ShieldCheck size={20} /></span>
      <div><strong>People stay in control</strong><p>Review coverage, changes and solver priorities before publishing a new schedule version.</p></div>
      {isHod && <button className="button button-secondary button-compact" onClick={() => void generate()} disabled={!optimizerOnline}><Sparkles size={15} />Run optimizer</button>}
    </div>
    <section className="panel proposal-list-panel">
      <div className="panel-heading"><div><div className="eyebrow">HOD REVIEW</div><h2>Schedule proposals</h2></div><span className="proposal-total">{proposals.length} awaiting review</span></div>
      {proposals.length ? <div className="proposal-list">{proposals.map((proposal) => (
        <article className={openId === proposal.id ? "proposal-card proposal-card-open" : "proposal-card"} key={proposal.id}>
          <div className="proposal-icon"><Sparkles size={17} /></div>
          <div className="proposal-main">
            <div className="proposal-card-title"><h3>Schedule proposal <span>V{proposal.id}</span></h3><span className={proposal.solverStatus === "OPTIMAL" ? "solver-status solver-optimal" : "solver-status solver-feasible"}><i />{proposal.solverStatus}</span></div>
            <p>{proposal.mode === "ALLOCATE" ? "Initial allocation" : proposal.mode === "REPAIR" ? "Disruption repair" : "Department rebalance"} | created by {proposal.createdBy} | {shortDate(proposal.createdAt)}</p>
            <div className="proposal-metrics"><span><strong>{proposal.assignmentCount}</strong> assigned roles</span><span><strong>{proposal.changedCount}</strong> changes from baseline</span><span className={proposal.uncoveredCount ? "metric-uncovered" : ""}><strong>{proposal.uncoveredCount}</strong> uncovered</span></div>
            {isHod && <button className="proposal-review-toggle" aria-expanded={openId === proposal.id} onClick={() => void toggleDetails(proposal.id)}>{loadingId === proposal.id ? "Loading review details..." : openId === proposal.id ? "Hide review details" : "Review full allocation"} <ChevronDown size={14} /></button>}
          </div>
          <div className="proposal-actions">{isHod ? <>
            <button className="button button-secondary button-compact" onClick={() => void reject(proposal.id)} disabled={busy === "reject-" + proposal.id}>{busy === "reject-" + proposal.id ? "Rejecting..." : "Reject"}</button>
            <button className="button button-primary button-compact" onClick={() => void approve(proposal.id)} disabled={busy === "approve-" + proposal.id || !details[proposal.id] || details[proposal.id].isStale} title={!details[proposal.id] ? "Review the full allocation before publishing." : details[proposal.id].isStale ? "Scheduling inputs changed. Generate a new proposal before publishing." : undefined}>{busy === "approve-" + proposal.id ? "Publishing..." : details[proposal.id]?.isStale ? "Stale proposal" : <>Approve &amp; publish <ArrowRight size={15} /></>}</button>
          </> : <span className="pending-review">Awaiting HOD</span>}</div>
          {isHod && openId === proposal.id && <ProposalReviewContent detail={details[proposal.id]} loading={loadingId === proposal.id} />}
        </article>
      ))}</div> : <div className="empty-proposals"><span className="empty-proposals-icon"><ClipboardCheck size={20} /></span><h3>No proposals waiting</h3><p>{isHod ? "Generate an allocation or rebalance proposal to review solver recommendations." : "Your HOD has not shared a schedule proposal yet."}</p>{isHod && <button className="button button-primary" onClick={() => void generate()} disabled={!optimizerOnline}><Sparkles size={16} />Generate a proposal</button>}</div>}
    </section>
  </div>;
}

function ProposalReviewContent({ detail, loading }: { detail?: ProposalDetail; loading: boolean }) {
  if (loading && !detail) return <div className="proposal-detail proposal-detail-loading"><span className="loading-pulse" />Loading the proposed assignment plan...</div>;
  if (!detail) return null;
  const statusLabel = detail.lexicographicComplete ? "All objective levels proven optimal" : "Feasible plan; some objectives may improve with more solve time";
  return <div className="proposal-detail">
    {detail.isStale && <div className="proposal-stale-warning"><CircleAlert size={15} /><span>Scheduling data changed after this proposal was created. Generate a fresh proposal before publishing.</span></div>}
    <div className="proposal-detail-summary">
      <div><span>Solver result</span><strong>{detail.solverStatus}</strong></div><div><span>Changes</span><strong>{detail.changes.length}</strong></div>
      <div><span>Uncovered roles</span><strong className={detail.uncovered.length ? "metric-uncovered" : ""}>{detail.uncovered.length}</strong></div>
      <div><span>Solver time</span><strong>{(detail.solverStats.total_wall_time_seconds ?? detail.solverStats.wall_time_seconds ?? 0).toFixed(2)}s</strong></div>
    </div>
    <p className="proposal-lex-status">{statusLabel}. Coverage and hard constraints come before changes, workload balance and preferences.</p>
    <div className="proposal-review-grid">
      <section className="proposal-review-section">
        <div className="proposal-review-heading"><h4>Assignment changes</h4><span>{detail.changes.length}</span></div>
        {detail.changes.length ? <div className="proposal-change-list">{detail.changes.map((change) => <article className="proposal-change-row" key={change.dutyId}>
          <div className="proposal-change-main"><strong>{change.eventName} | {change.role}</strong><small>{shortDate(change.startsAt)}{change.protected ? " | protected assignment changed" : ""}</small></div>
          <div className="proposal-change-arrow"><span>{change.from?.name ?? "Unassigned"}</span><ArrowRight size={13} /><span>{change.to?.name ?? "Uncovered"}</span></div><p>{change.reason}</p>
        </article>)}</div> : <div className="proposal-empty-detail">This proposal keeps all current assignments.</div>}
      </section>
      <section className="proposal-review-section">
        <div className="proposal-review-heading"><h4>Uncovered roles</h4><span className={detail.uncovered.length ? "metric-uncovered" : ""}>{detail.uncovered.length}</span></div>
        {detail.uncovered.length ? <div className="proposal-uncovered-list">{detail.uncovered.map((item) => <article key={item.duty_id}><strong>{item.event_name} | {item.role}</strong><p>{item.reason}</p></article>)}</div> : <div className="proposal-empty-detail">Every required role is covered.</div>}
      </section>
    </div>
    <section className="proposal-review-section proposal-allocation-section">
      <div className="proposal-review-heading"><h4>Proposed assignments</h4><span>{detail.assignments.length} roles</span></div>
      {detail.assignments.length ? <div className="proposal-assignment-table-wrap"><table className="proposal-assignment-table"><thead><tr><th>Event / role</th><th>When</th><th>Faculty</th><th>Qualification</th></tr></thead><tbody>{detail.assignments.map((assignment) => <tr key={assignment.dutyId}><td><strong>{assignment.eventName}</strong><small>{assignment.role}</small></td><td>{shortDate(assignment.startsAt)}<small>{timeRange(assignment.startsAt, assignment.endsAt)}</small></td><td>{assignment.facultyName}{assignment.protected && <small>Protected</small>}</td><td>{assignment.requiredSkill?.replaceAll("_", " ") ?? "General"}</td></tr>)}</tbody></table></div> : <div className="proposal-empty-detail">No future duties are in this schedule version.</div>}
    </section>
    <section className="proposal-review-section">
      <div className="proposal-review-heading"><h4>Optimization priorities</h4><span>{detail.objectiveLevels.length} levels</span></div>
      <ol className="objective-level-list">{detail.objectiveLevels.map((level, index) => <li key={level.objective}><span>{index + 1}</span><strong>{level.objective.replaceAll("_", " ")}</strong><b>{level.value ?? "?"}</b><small>{level.status}</small></li>)}</ol>
    </section>
  </div>;
}

