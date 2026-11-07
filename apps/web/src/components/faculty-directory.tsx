"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Mail, Search } from "lucide-react";

type FacultyProfile = {
  sourceId: string;
  name: string;
  title: string;
  department: string;
  email: string | null;
  photoPath: string | null;
  profileUrl: string;
};

export default function FacultyDirectory({
  faculty,
  retrievedAt,
}: {
  faculty: FacultyProfile[];
  retrievedAt: string;
}) {
  const [query, setQuery] = useState("");
  const visibleFaculty = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return faculty;
    return faculty.filter((person) =>
      `${person.name} ${person.title} ${person.email ?? ""}`.toLowerCase().includes(normalized),
    );
  }, [faculty, query]);
  const emailCount = faculty.filter((person) => person.email).length;
  const date = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(retrievedAt));

  return (
    <main className="directory-page">
      <header className="directory-topbar">
        <Link href="/login" className="directory-brand"><span className="brand-mark">F</span>FacultyFlow</Link>
        <Link className="directory-login-link" href="/login">Sign in to scheduling</Link>
      </header>
      <section className="directory-content">
        <div className="directory-heading">
          <div className="eyebrow">MANIPAL UNIVERSITY JAIPUR · FOSTA</div>
          <h1>Computer Science &amp; Engineering faculty</h1>
          <p>Browse the department’s publicly listed faculty profiles, contact emails and photos.</p>
          <div className="directory-metrics">
            <span><strong>{faculty.length}</strong> faculty profiles</span>
            <span><strong>{emailCount}</strong> public email addresses</span>
          </div>
        </div>

        <label className="directory-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, role or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search faculty directory"
          />
        </label>

        {visibleFaculty.length ? (
          <div className="directory-grid">
            {visibleFaculty.map((person) => (
              <article className="directory-card" key={person.sourceId}>
                <a className="directory-photo" href={person.profileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${person.name}'s official profile`}>
                  {person.photoPath ? (
                    <Image src={person.photoPath} alt={person.name} fill sizes="(max-width: 620px) 90vw, (max-width: 1000px) 45vw, 300px" />
                  ) : (
                    <span className="directory-photo-fallback">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  )}
                </a>
                <div className="directory-card-body">
                  <h2>{person.name}</h2>
                  <p className="directory-title">{person.title}</p>
                  <a className={`directory-email${person.email ? "" : " directory-email-missing"}`} href={person.email ? `mailto:${person.email}` : person.profileUrl} target={person.email ? undefined : "_blank"} rel={person.email ? undefined : "noreferrer"}>
                    <Mail size={15} aria-hidden="true" />
                    <span>{person.email ?? "Email not listed on profile"}</span>
                  </a>
                  <a className="directory-profile-link" href={person.profileUrl} target="_blank" rel="noreferrer">
                    Official profile <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="directory-empty">No faculty profiles match “{query}”.</div>
        )}

        <footer className="directory-source">
          <span>Data and photos from Manipal University Jaipur’s public CSE faculty pages. Retrieved {date}.</span>
          <a href="https://jaipur.manipal.edu/fosta/department-of-Computer-Science-Engineering.php" target="_blank" rel="noreferrer">View department page <ArrowUpRight size={13} /></a>
        </footer>
      </section>
    </main>
  );
}
