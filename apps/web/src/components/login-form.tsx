"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, LockKeyhole, Mail, Sparkles } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (result?.error) {
      setError("That email and password combination was not recognized.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand-lockup brand-lockup-light">
          <span className="brand-mark"><CalendarDays size={19} strokeWidth={2.2} /></span>
          <span>FacultyFlow</span>
        </div>
        <div className="login-story-content">
          <div className="eyebrow light-eyebrow"><Sparkles size={14} /> Smart allocation workspace</div>
          <h1>Make every assignment<br />make sense.</h1>
          <p>Build conflict-free faculty schedules, keep workloads balanced, and handle change with less disruption.</p>
          <div className="login-feature-list">
            <div><span className="login-feature-icon">01</span><span><strong>Plan with constraints</strong><small>Skills, availability, workload and rest</small></span></div>
            <div><span className="login-feature-icon">02</span><span><strong>Repair with care</strong><small>Find the smallest reasonable change</small></span></div>
            <div><span className="login-feature-icon">03</span><span><strong>Keep people in control</strong><small>Review and approve every proposal</small></span></div>
          </div>
        </div>
        <div className="login-story-footer">DEPARTMENT OPERATIONS · COMPUTER SCIENCE</div>
      </section>
      <section className="login-panel-wrap">
        <ThemeToggle className="login-theme-toggle" />
        <form className="login-panel" onSubmit={submit}>
          <div className="login-panel-top"><span className="brand-mark brand-mark-mobile"><CalendarDays size={19} /></span><span className="login-label">SECURE WORKSPACE</span></div>
          <h2>Welcome back</h2>
          <p className="login-subtitle">Sign in to open your allocation workspace.</p>
          <label className="form-label" htmlFor="email">Email address</label>
          <div className="login-input-wrap"><Mail size={17} /><input id="email" type="email" autoComplete="username" placeholder="you@department.edu" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <label className="form-label" htmlFor="password">Password</label>
          <div className="login-input-wrap"><LockKeyhole size={17} /><input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : <>Sign in <ArrowRight size={17} /></>}</button>
          <div className="login-helper"><span className="secure-dot" /> Your department sign-in is protected.</div>
          <div className="login-demo-note"><strong>Local demo access</strong><span>Demo HOD and faculty credentials are listed in the project README.</span></div>
          <a className="login-directory-link" href="/directory">Browse the public CSE faculty directory</a>
        </form>
        <div className="login-panel-footer">A calmer way to run department schedules.</div>
      </section>
    </main>
  );
}
