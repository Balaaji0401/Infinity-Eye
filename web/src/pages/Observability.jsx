import { useEffect, useState } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";

const Kpi = ({ v, l }) => <div className="kpi"><div className="v">{v ?? "—"}</div><div className="l">{l}</div></div>;
const ms = (v) => (v == null ? "—" : `${v} ms`);
const TT = { cursor: { fill: "#25252c" }, contentStyle: { background: "#1b1b20", border: "1px solid #2e2e36" } };

export default function Observability() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => { api.get("/observability").then(setD).catch((e) => setErr(e.message)); }, [tick]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  if (err) return <div className="page error">{err}</div>;
  if (!d) return <div className="page muted">Loading…</div>;
  const k = d.kpis, L = d.learning || {};
  const learnedAll = L.learned?._all;
  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 20 }}><h1 style={{ margin: 0 }}>Observability</h1><span className="spacer" /><span className="muted" style={{ fontSize: 13 }}>Refreshes every 30 s · model {d.model}</span></div>

      <h2>Health</h2>
      <div className="kpis">
        <Kpi v={k.requests_today} l={`API requests today (free tier: ${k.requests_budget.toLocaleString()}/day)`} />
        <Kpi v={`${k.error_rate_14d}%`} l="Server error rate, 14 days" />
        <Kpi v={ms(k.p50_ms)} l="Median API latency" />
        <Kpi v={ms(k.p95_ms)} l="p95 API latency" />
      </div>

      <h2 style={{ marginTop: 30 }}>AI usage</h2>
      <div className="kpis">
        <Kpi v={k.ai_calls_today} l={`AI calls today${k.ai_errors_today ? `, ${k.ai_errors_today} failed` : ""}`} />
        <div className="kpi"><div className="v">{k.neurons_today.toLocaleString()}</div><div className="l">Est. neurons used today of {k.neuron_budget.toLocaleString()} free</div><div className="gauge" style={{ marginTop: 8 }}><div style={{ width: `${k.neuron_pct}%`, background: k.neuron_pct > 85 ? "var(--danger)" : "var(--saffron)" }} /></div></div>
        <div className="kpi"><div className="v">{k.codecraft_tokens_month.toLocaleString()}</div><div className="l">CodeCraft tokens this month of {k.codecraft_budget.toLocaleString()} free (14-day window)</div><div className="gauge" style={{ marginTop: 8 }}><div style={{ width: `${k.codecraft_pct}%`, background: k.codecraft_pct > 85 ? "var(--danger)" : "var(--saffron)" }} /></div></div>
        <Kpi v={k.deep_done} l="Resumes AI-verified (all time)" />
        <Kpi v={`${k.deep_pending} / ${k.deep_failed}`} l="Verification pending / failed" />
      </div>

      <div className="two" style={{ marginTop: 30 }}>
        <div className="card"><h3>Requests and errors, 14 days</h3>
          <div style={{ height: 180 }}><ResponsiveContainer><BarChart data={d.series} margin={{ left: -20 }}>
            <XAxis dataKey="day" stroke="#a4a3ab" fontSize={11} tickLine={false} /><YAxis stroke="#a4a3ab" fontSize={11} allowDecimals={false} tickLine={false} /><Tooltip {...TT} />
            <Bar dataKey="requests" fill="#7fb8ff" radius={[3, 3, 0, 0]} /><Bar dataKey="errors" fill="#ff7a70" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="card"><h3>AI calls and estimated neurons, 14 days</h3>
          <div style={{ height: 180 }}><ResponsiveContainer><LineChart data={d.series} margin={{ left: -20 }}>
            <XAxis dataKey="day" stroke="#a4a3ab" fontSize={11} tickLine={false} /><YAxis stroke="#a4a3ab" fontSize={11} allowDecimals={false} tickLine={false} /><Tooltip {...TT} />
            <Line type="monotone" dataKey="neurons" stroke="#f5b53f" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="ai_calls" stroke="#5fd6a2" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div></div>
      </div>

      <div className="two" style={{ marginTop: 16 }}>
        <div className="card"><h3>Slowest and busiest routes</h3>
          <table className="table"><thead><tr><th>Route</th><th className="r">Calls</th><th className="r">5xx</th><th className="r">p50</th><th className="r">p95</th></tr></thead>
            <tbody>{d.routes.map((r) => <tr key={r.route}><td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{r.route}</td><td className="r">{r.count}</td><td className="r">{r.errors}</td><td className="r">{ms(r.p50)}</td><td className="r">{ms(r.p95)}</td></tr>)}</tbody></table></div>
        <div className="card"><h3>Models</h3>
          <table className="table"><thead><tr><th>Model</th><th className="r">Calls</th><th className="r">Errors</th><th className="r">Neurons</th><th className="r">p95</th></tr></thead>
            <tbody>{d.models.map((m) => <tr key={m.model}><td style={{ fontSize: 12.5 }}>{m.model}</td><td className="r">{m.calls}</td><td className="r">{m.errors}</td><td className="r">{m.neurons.toLocaleString()}</td><td className="r">{ms(m.p95)}</td></tr>)}
              {d.models.length === 0 && <tr><td colSpan={5} className="muted">No AI calls in the last 14 days.</td></tr>}</tbody></table>
          <h3 style={{ marginTop: 18 }}>Data</h3>
          <div className="row" style={{ gap: 16, fontSize: 14 }}>{Object.entries(d.counts).map(([t, n]) => <span key={t}><b>{n}</b> <span className="muted">{t.replace("_", " ")}</span></span>)}</div>
        </div>
      </div>

      <div className="two" style={{ marginTop: 16 }}>
        <div className="card"><h3>Learning engine</h3>
          {learnedAll?.weights ? (<>
            <p className="muted" style={{ fontSize: 14 }}>Weights learned from {learnedAll.examples.positive} shortlists and {learnedAll.examples.negative} rejections. Positive signal means shortlisted candidates scored higher on that criterion than rejected ones.</p>
            <table className="table"><thead><tr><th>Criterion</th><th className="r">Learned weight</th><th className="r">Signal</th></tr></thead>
              <tbody>{Object.entries(learnedAll.weights).map(([kk, w]) => <tr key={kk}><td>{kk.replace("_", " ")}</td><td className="r">{w}</td><td className="r" style={{ color: (learnedAll.signal?.[kk] || 0) > 0 ? "var(--band-a)" : "var(--muted)" }}>{learnedAll.signal?.[kk] ?? "—"}</td></tr>)}</tbody></table>
          </>) : <p className="muted" style={{ fontSize: 14 }}>Not enough decisions yet. Once you've shortlisted and rejected at least three candidates each, the engine derives adjusted weights here and applies them to new mandates.{learnedAll?.examples ? ` So far: ${learnedAll.examples.positive} shortlists, ${learnedAll.examples.negative} rejections.` : ""}</p>}
          <button className="btn small" style={{ marginTop: 8 }} onClick={async () => { await api.post("/learning/run"); setTick((x) => x + 1); }}>Re-learn now</button>
        </div>
        <div className="card"><h3>Remembered prompt rules</h3>
          {L.rules?.length ? L.rules.map((r) => <div key={r.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}><span style={{ flex: 1 }}>{r.text}</span><span className="tag">{r.scope}{r.client ? ` · ${r.client}` : ""}</span></div>)
            : <p className="muted" style={{ fontSize: 14 }}>No rules yet. Type an instruction in a mandate's command box with "always" or "for this client" and it appears here.</p>}
          <h3 style={{ marginTop: 18 }}>Fit distribution</h3>
          <div className="row" style={{ gap: 14, fontSize: 14 }}>{Object.entries(d.bands).map(([b, n]) => <span key={b}><b>{n}</b> <span className="muted">{b}</span></span>)}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}><h3>Recent errors</h3>
        {d.recent_errors.length === 0 ? <p className="muted" style={{ margin: 0 }}>None in the last 14 days.</p> :
          <table className="table"><thead><tr><th>When (UTC)</th><th>Kind</th><th>Name</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>{d.recent_errors.map((e, i) => <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{e.at}</td><td>{e.kind}</td><td>{e.name}</td><td>{e.status}</td><td className="muted" style={{ fontSize: 13 }}>{e.error}</td></tr>)}</tbody></table>}
        <h3 style={{ marginTop: 18 }}>Background jobs</h3>
        <div className="row" style={{ gap: 14, fontSize: 14 }}>{d.jobs.map((j, i) => <span key={i}><b>{j.n}</b> <span className="muted">{j.type} {j.status}</span></span>)}{d.jobs.length === 0 && <span className="muted">None yet.</span>}</div>
      </div>
    </div>
  );
}
