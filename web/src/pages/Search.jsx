import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api, bandClass } from "../api.js";

const ORIGIN = { naukri: "Naukri", upload: "Uploaded", inbound: "Inbound", linkedin: "LinkedIn", github: "GitHub", pool: "Talent pool" };

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [text, setText] = useState(q);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { setText(q); if (q) { setD(null); api.get(`/search?q=${encodeURIComponent(q)}`).then(setD).catch((e) => setErr(e.message)); } }, [q]);
  return (
    <div className="page">
      <h1>Talent search</h1>
      <p className="muted">Describe who you're looking for in plain words. Results are matched on meaning, not just exact words, across everyone in your talent pool.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setParams({ q: text.trim() }); }} style={{ marginBottom: 20 }}>
        <input className="input" style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. plant accountant with GST filing and Tally, Chennai, 3-5 years" />
        <button className="btn primary">Search</button>
      </form>
      {err && <p className="error">{err}</p>}
      {q && !d && !err && <p className="muted">Searching…</p>}
      {d && (
        <>
          <p className="faint" style={{ fontSize: 13 }}>{d.semantic ? `${d.results.length} closest profiles.` : `Showing keyword matches.`}</p>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Candidate</th><th>Role / company</th><th>Skills</th><th>Best mandate fit</th><th className="r">Match</th><th></th></tr></thead>
              <tbody>{d.results.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b><div className="faint" style={{ fontSize: 12 }}>{ORIGIN[c.source] || c.source}{c.location ? ` · ${c.location}` : ""}{c.total_exp_years != null ? ` · ${c.total_exp_years} yrs` : ""}</div></td>
                  <td>{[c.current_title, c.current_company].filter(Boolean).join(" at ") || <span className="faint">—</span>}</td>
                  <td style={{ fontSize: 13 }}>{(c.top_skills || []).slice(0, 5).join(", ")}</td>
                  <td>{c.best_match ? <Link to={`/mandates/${c.best_match.mandate_id}`}>{c.best_match.code} <span className={`band ${bandClass(c.best_match.band)}`}>{c.best_match.score}</span> <span className="faint">{c.best_match.status}</span></Link> : <span className="faint">Not matched yet</span>}</td>
                  <td className="r">{c.similarity != null ? `${Math.round(c.similarity * 100)}%` : "—"}</td>
                  <td>{c.profile_url && <a className="icon-btn" href={c.profile_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</td>
                </tr>))}
                {d.results.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20, textAlign: "center" }}>No one matches yet. Import profiles or resumes into a mandate first.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
