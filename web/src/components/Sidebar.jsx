import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Activity, BarChart3, Building2, Home, Plus, Search, SlidersHorizontal } from "lucide-react";
import { mandateColor, setToken } from "../api.js";

export default function Sidebar({ mandates, health }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const isAdmin = health?.username === "admin";
  const ai = health ? (health.llm ? "Assistant online" : "Assistant offline — screening still works") : "Connecting…";
  return (
    <aside className="side">
      <div className="side-box">
        <div className="brand"><span className="brand-mark">∞</span>∞ Eye</div>
        <NavLink to="/" end className="nav-link"><Home size={22} />Home</NavLink>
        <NavLink to="/dashboard" className="nav-link"><BarChart3 size={22} />Dashboard</NavLink>
        <NavLink to="/clients" className="nav-link"><Building2 size={22} />Clients</NavLink>
        {isAdmin && <NavLink to="/settings" className="nav-link"><SlidersHorizontal size={22} />Settings</NavLink>}
        {isAdmin && <NavLink to="/observability" className="nav-link"><Activity size={22} />Observability</NavLink>}
        <form className="side-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people: GST accountant Chennai" aria-label="Search talent" />
        </form>
      </div>
      <div className="side-box grow">
        <div className="side-title">
          <span>Your mandates</span>
          <NavLink to="/" className="icon-btn" title="New mandate"><Plus size={18} /></NavLink>
        </div>
        {mandates.length === 0 && <p className="muted" style={{ padding: "0 10px", fontSize: 14 }}>Paste a job description on Home to create your first mandate.</p>}
        {mandates.map((m) => (
          <NavLink key={m.id} to={`/mandates/${m.id}`} className={`mandate-row ${loc.pathname.startsWith(`/mandates/${m.id}`) ? "active" : ""}`}>
            <div className="tile" style={{ background: mandateColor(m.id) }}>{m.code.replace("M", "")}</div>
            <div style={{ minWidth: 0 }}>
              <div className="t1">{m.title}</div>
              <div className="t2">{m.client_name || "No client"}, {m.resumes} screened{m.band_a ? `, ${m.band_a} in Group A` : ""}</div>
            </div>
          </NavLink>
        ))}
      </div>
      <div className="side-box" style={{ fontSize: 12.5, padding: "10px 16px" }}>
        <div><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 8,
          background: health?.llm ? "var(--band-a)" : "var(--faint)" }} /><span className="muted">{ai}</span></div>
        <div className="row" style={{ marginTop: 6 }}>
          <span className="muted">Signed in as <b style={{ color: "var(--text)" }}>{health?.username || "…"}</b></span>
          <span className="spacer" />
          <button className="btn small ghost" onClick={() => { setToken(null); window.location.href = "/"; }}>Sign out</button>
        </div>
      </div>
    </aside>
  );
}
