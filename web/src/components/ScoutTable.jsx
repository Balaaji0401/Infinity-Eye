import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { api, bandClass } from "../api.js";
import ScoreRing from "./ScoreRing.jsx";
import StatusControl from "./StatusControl.jsx";

const ORIGIN = { naukri: "Naukri", upload: "Uploaded", inbound: "Inbound", linkedin: "LinkedIn", github: "GitHub", pool: "Talent pool" };

function Active({ m }) {
  if (m.active_status) {
    const good = /active|looking/i.test(m.active_status) && !/inactive/i.test(m.active_status);
    return <span className="tag" style={{ color: good ? "var(--band-a)" : "var(--muted)" }}>{m.active_status}{m.last_active ? ` · ${m.last_active}` : ""}</span>;
  }
  if (m.origin === "naukri" || m.has_resume) return <span className="tag">Shared resume</span>;
  return <span className="tag" style={{ color: "var(--faint)" }}>Unknown</span>;
}

export default function ScoutTable({ rows, statuses, health, onChanged, onOpen, selected = [], onSelect }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const download = async (m) => { setBusy(m.id); try { await api.download(m.candidate_id, m.resume_filename); } catch (e) { setErr(e.message); } setBusy(null); };
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table className="table scout">
        <thead><tr>{onSelect && <th></th>}<th>#</th><th>Candidate</th><th>Company / role</th><th>Job search</th><th>Contact</th><th>Score</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.id}>
              {onSelect && <td><input type="checkbox" checked={selected.includes(m.id)} onChange={() => onSelect(m.id)} aria-label={`Select ${m.name}`} /></td>}
              <td className="faint">{i + 1}</td>
              <td>
                <button className="linkish" onClick={() => onOpen(m)}>{m.name}</button>
                <div className="faint" style={{ fontSize: 12 }}>{ORIGIN[m.origin] || m.origin}{m.location ? ` · ${m.location}` : ""}{m.total_exp_years != null ? ` · ${m.total_exp_years} yrs` : ""}</div>
              </td>
              <td><div>{m.current_company || <span className="faint">—</span>}</div><div className="muted" style={{ fontSize: 13 }}>{m.current_title || ""}</div></td>
              <td><Active m={m} /></td>
              <td style={{ fontSize: 13 }}>
                {m.phone ? <div><a href={`tel:${m.phone}`}>{m.phone}</a></div> : null}
                {m.email ? <div><a href={`mailto:${m.email}`}>{m.email}</a></div> : null}
                {!m.phone && !m.email && <span className="faint">{m.profile_url ? "Via profile" : "Not available"}</span>}
              </td>
              <td><div className="row" style={{ gap: 8, flexWrap: "nowrap" }}><ScoreRing score={m.score} band={m.band} size={44} /><span className={`band ${bandClass(m.band)}`}>{m.band === "Do not advance" ? "Not a fit" : m.band}</span></div></td>
              <td><StatusControl m={m} health={health || { statuses }} onChanged={onChanged} compact /></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {m.profile_url && <a className="icon-btn" href={m.profile_url} target="_blank" rel="noreferrer" title="Open profile"><ExternalLink size={16} /></a>}
                {m.has_resume && <button className="icon-btn" disabled={busy === m.id} onClick={() => download(m)} title="Download resume"><Download size={16} /></button>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 24, textAlign: "center" }}>No profiles yet. Import a Naukri export or upload resumes from the Sourcing tab.</td></tr>}
        </tbody>
      </table>
      {err && <div className="error" style={{ padding: 12 }}>{err}</div>}
    </div>
  );
}
