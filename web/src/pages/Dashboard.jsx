import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, inr } from "../api.js";
import { Check } from "lucide-react";
const fmt = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z").toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "");

const ORIGIN = { naukri: "Naukri", upload: "Uploaded", inbound: "Inbound", linkedin: "LinkedIn", github: "GitHub", pool: "Talent pool" };
const BAND_COLORS = { A: "#5fd6a2", B: "#7fb8ff", Review: "#c3a6ff", "Do not advance": "#7b7a84" };

function Kpi({ v, l }) {
  return <div className="kpi"><div className="v">{v ?? "—"}</div><div className="l">{l}</div></div>;
}

export default function Dashboard({ mandates }) {
  const [d, setD] = useState(null);
  const [mid, setMid] = useState("");
  const [err, setErr] = useState("");
  const [today, setToday] = useState(null);
  const loadToday = () => api.get("/today").then(setToday).catch(() => {});
  useEffect(() => { api.get(`/dashboard${mid ? `?mandate_id=${mid}` : ""}`).then(setD).catch((e) => setErr(e.message)); }, [mid]);
  useEffect(() => { loadToday(); }, []);
  const done = async (t) => { await api.patch(`/tasks/${t.id}`, { done: true }); loadToday(); };
  if (err) return <div className="page error">{err}</div>;
  if (!d) return <div className="page muted">Loading…</div>;
  const k = d.kpis;
  const maxF = Math.max(1, ...d.funnel.map((f) => f.count));
  const bands = Object.entries(d.bands).map(([band, count]) => ({ band: band === "Do not advance" ? "Not a fit" : band, raw: band, count }));

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <span className="spacer" />
        <select className="select" style={{ width: 280 }} value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Filter by mandate">
          <option value="">All mandates</option>
          {mandates.map((m) => <option key={m.id} value={m.id}>{m.code}: {m.title}</option>)}
        </select>
      </div>

      {today && (
        <div className="two" style={{ marginBottom: 30 }}>
          <div className="card">
            <h3>Today's actions {today.due.length > 0 && <span className="tag">{today.due.length}</span>}</h3>
            {today.due.length === 0 && <p className="faint" style={{ margin: 0 }}>Nothing due. Tasks appear here automatically after outreach, interviews and offers.</p>}
            <ul className="today-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {today.due.map((t) => <li key={t.id}><button className="icon-btn" title="Done" onClick={() => done(t)}><Check size={16} /></button>
                <div style={{ flex: 1 }}>{t.title}<div className="faint" style={{ fontSize: 12 }}>{t.code ? <Link to={`/mandates/${t.mandate_id}/scout`}>{t.code}</Link> : null} {t.due_at < new Date().toISOString().slice(0, 19).replace("T", " ") ? <span style={{ color: "var(--danger)" }}>overdue</span> : "due"} {fmt(t.due_at)}</div></div></li>)}
            </ul>
            {today.interviews.length > 0 && <><h3 style={{ marginTop: 14 }}>Interviews this week</h3><ul className="today-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>{today.interviews.map((x) => <li key={x.id}><div>{x.name} · round {x.round} · {fmt(x.scheduled_at)} <span className="faint">{x.code} · {x.status}</span></div></li>)}</ul></>}
            {today.upcoming.length > 0 && <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>Next: {today.upcoming.slice(0, 3).map((t) => t.title).join(" · ")}</p>}
          </div>
          <div className="card">
            <h3>Shortlist awaiting your review {today.awaiting_review.length > 0 && <span className="tag">{today.awaiting_review.length}</span>}</h3>
            {today.awaiting_review.length === 0 && <p className="faint" style={{ margin: 0 }}>No strong profiles waiting. New Group A/B candidates show here until you review them.</p>}
            <ul className="today-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {today.awaiting_review.slice(0, 8).map((m) => <li key={m.id}><span className={`band ${m.band}`}>{m.score}</span><div style={{ flex: 1 }}>{m.name} <span className="faint">· {m.mandate_title}</span></div><Link className="btn small ghost" to={`/mandates/${m.mandate_id}/scout`}>Review</Link></li>)}
            </ul>
            {today.stale.length > 0 && <p className="faint" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>Details to re-verify (60+ days): {today.stale.slice(0, 5).map((c) => c.name).join(", ")}{today.stale.length > 5 ? ` and ${today.stale.length - 5} more` : ""}.</p>}
          </div>
        </div>
      )}

      <h2>Business</h2>
      <div className="kpis">
        <Kpi v={inr(k.revenue)} l="Revenue from joined candidates" />
        <Kpi v={inr(k.pipeline)} l="Pipeline (offers not yet joined)" />
        <Kpi v={inr(k.cost)} l="Recruiter cost" />
        <Kpi v={inr(k.profit)} l="Profit" />
      </div>

      <h2 style={{ marginTop: 30 }}>Activity and speed</h2>
      <div className="kpis">
        <Kpi v={`${k.jds}`} l={`JDs processed (${k.open_jds} open)`} />
        <Kpi v={k.screened} l={`Resumes screened, plus ${k.leads} profile leads`} />
        <Kpi v={k.avg_hours_to_shortlist != null ? `${k.avg_hours_to_shortlist} h` : "—"} l="Avg time from JD to first shortlist" />
        <Kpi v={`${k.hours_saved} h`} l={`Screening hours saved (at ${d.assumptions.manual_minutes_per_resume} min per resume)`} />
      </div>

      <div className="two" style={{ marginTop: 30 }}>
        <div className="card">
          <h3>Hiring funnel</h3>
          {d.funnel.map((f) => (
            <div className="funnel-row" key={f.stage}>
              <span>{f.stage}</span>
              <div className="funnel-bar"><div style={{ width: `${(100 * f.count) / maxF}%` }} /></div>
              <b style={{ textAlign: "right" }}>{f.count}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Fit of screened candidates</h3>
          <div style={{ height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={d.score_buckets} margin={{ left: -20 }}>
                <XAxis dataKey="range" stroke="#a4a3ab" fontSize={12} tickLine={false} />
                <YAxis stroke="#a4a3ab" fontSize={12} allowDecimals={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#25252c" }} contentStyle={{ background: "#1b1b20", border: "1px solid #2e2e36" }} formatter={(v) => [v, "Candidates"]} labelFormatter={(l) => `Score ${l}`} />
                <Bar dataKey="count" fill="#f5b53f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 14 }}>
            {bands.map((b) => <span key={b.raw} style={{ fontSize: 13 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: BAND_COLORS[b.raw], marginRight: 6 }} />{b.band} <b>{b.count}</b></span>)}
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {k.override_rate != null ? `Recruiters overrode the AI band on ${k.override_rate}% of shortlist or reject decisions. Above ~25% means the scoring weights need tuning.` : "Override rate appears once you shortlist or reject candidates."}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Which sources produce hires</h3>
        <table className="table">
          <thead><tr><th>Source</th><th className="r">Candidates</th><th className="r">Avg score</th><th className="r">Shortlisted</th><th className="r">Interviewed</th><th className="r">Joined</th></tr></thead>
          <tbody>{d.sources.map((s) => <tr key={s.source}><td>{ORIGIN[s.source] || s.source}</td><td className="r">{s.candidates}</td><td className="r">{s.avg_score}</td><td className="r">{s.shortlisted}</td><td className="r">{s.interviewed}</td><td className="r">{s.joined}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Clients</h3>
        <table className="table">
          <thead><tr><th>Client</th><th className="r">Mandates</th><th className="r">Submitted</th><th className="r">Joined</th><th className="r">Revenue</th><th className="r">Pipeline</th><th className="r">Profit</th></tr></thead>
          <tbody>{d.clients.map((c) => <tr key={c.client}><td>{c.client}</td><td className="r">{c.mandates}</td><td className="r">{c.submitted}</td><td className="r">{c.joined}</td><td className="r">{inr(c.revenue)}</td><td className="r">{inr(c.pipeline)}</td><td className="r">{inr(c.profit)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Mandates</h3>
        <table className="table">
          <thead><tr><th>Mandate</th><th>Client</th><th className="r">Screened</th><th className="r">Group A</th><th className="r">Shortlisted</th><th className="r">Joined</th><th className="r">Hrs to shortlist</th><th className="r">Days open</th><th className="r">Profit</th></tr></thead>
          <tbody>{d.mandates.map((m) => <tr key={m.id}><td><Link to={`/mandates/${m.id}`}>{m.code} {m.title}</Link></td><td>{m.client}</td><td className="r">{m.screened}</td><td className="r">{m.band_a}</td><td className="r">{m.shortlisted}</td><td className="r">{m.joined}</td><td className="r">{m.hours_to_shortlist ?? "—"}</td><td className="r">{m.days_open}</td><td className="r">{inr(m.profit)}</td></tr>)}</tbody>
        </table>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>Revenue uses the candidate's expected CTC (or current, or the budget ceiling) times the mandate fee. Cost uses recruiter hours × ₹{d.assumptions.hourly_cost}/hour, set in wrangler.toml.</p>
      </div>
    </div>
  );
}
