import { Check, CircleHelp, Minus, X } from "lucide-react";
import { bandClass } from "../api.js";

const ICON = { meets: [Check, "st-meets"], partial: [Minus, "st-partial"], unverified: [CircleHelp, "st-unverified"], missing: [X, "st-missing"], fails: [X, "st-fails"], unknown: [CircleHelp, "st-unknown"] };

export default function Compare({ rows }) {
  if (rows.length < 2) return <p className="muted">Select at least two candidates above to compare them side by side.</p>;
  const keys = [];
  for (const m of rows) for (const c of m.checklist || []) if (c.key !== "mandatory_skills" && !keys.some((k) => k.criterion === c.criterion)) keys.push({ key: c.key, criterion: c.criterion });
  const facts = [["Score", (m) => `${m.score}/10`], ["Band", (m) => <span className={`band ${bandClass(m.band)}`}>{m.band}</span>], ["Current role", (m) => [m.current_title, m.current_company].filter(Boolean).join(" at ") || "—"],
    ["Experience", (m) => (m.total_exp_years != null ? `${m.total_exp_years} yrs` : "—")], ["Location", (m) => m.location || "—"],
    ["CTC current → expected", (m) => [m.ctc_current_lpa, m.ctc_expected_lpa].map((v) => (v != null ? `₹${v}L` : "?")).join(" → ")],
    ["Notice", (m) => (m.notice_days != null ? (m.notice_days === 0 ? "Immediate" : `${m.notice_days} days`) : "—")], ["Education", (m) => m.education || "—"],
    ["Top skills", (m) => (m.top_skills || []).join(", ") || "—"], ["Status", (m) => m.status]];
  return (
    <div className="card" style={{ overflowX: "auto", padding: 0 }}>
      <table className="table compare">
        <thead><tr><th style={{ minWidth: 160 }}></th>{rows.map((m) => <th key={m.id}>{m.name}</th>)}</tr></thead>
        <tbody>
          {facts.map(([label, fn]) => <tr key={label}><td className="muted">{label}</td>{rows.map((m) => <td key={m.id}>{fn(m)}</td>)}</tr>)}
          <tr><td colSpan={rows.length + 1} style={{ background: "var(--base)", fontWeight: 700 }}>Requirement checks</td></tr>
          {keys.map((k) => (
            <tr key={k.criterion}><td className="muted">{k.criterion}</td>
              {rows.map((m) => { const c = (m.checklist || []).find((x) => x.criterion === k.criterion); if (!c) return <td key={m.id} className="faint">—</td>;
                const [I, cls] = ICON[c.status] || ICON.unknown; return <td key={m.id}><span className={cls} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><I size={15} />{c.status === "meets" ? (c.detail || "meets") : c.detail}</span></td>; })}
            </tr>
          ))}
          <tr><td className="muted">Gaps</td>{rows.map((m) => <td key={m.id} style={{ fontSize: 13 }}>{(m.gaps || []).slice(0, 4).map((g, i) => <div key={i}>• {g}</div>) || "—"}</td>)}</tr>
          <tr><td className="muted">AI summary</td>{rows.map((m) => <td key={m.id} style={{ fontSize: 13 }}>{m.summary || <span className="faint">Not verified yet</span>}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}
