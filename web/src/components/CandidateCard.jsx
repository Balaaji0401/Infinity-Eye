import { useEffect, useState } from "react";
import StatusControl from "./StatusControl.jsx";
import Engagement from "./Engagement.jsx";
import { Check, ChevronDown, ChevronUp, CircleHelp, Download, ExternalLink, Minus, X, Copy } from "lucide-react";
import { api, bandClass } from "../api.js";
import ScoreRing from "./ScoreRing.jsx";

const ICON = { meets: Check, partial: Minus, unverified: CircleHelp, missing: X, fails: X, unknown: CircleHelp };
const ORIGIN = { naukri: "Naukri", upload: "Uploaded", inbound: "Inbound", linkedin: "LinkedIn", github: "GitHub", pool: "Talent pool" };
const lpa = (v) => (v == null ? null : `₹${v}L`);

export default function CandidateCard({ m, statuses, health, onChanged, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState(null);
  const isLead = m.kind === "lead";
  useEffect(() => { if (open && !history) api.get(`/candidates/${m.candidate_id}/history`).then(setHistory).catch(() => setHistory({ timeline: [] })); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = async (e) => {
    e.stopPropagation();
    try { await api.download(m.candidate_id, m.resume_filename); } catch (x) { setErr(x.message); }
  };
  const facts = [
    m.total_exp_years != null && ["Exp", `${m.total_exp_years} yrs`],
    m.location && ["Location", m.location],
    m.notice_days != null && ["Notice", m.notice_days === 0 ? "Immediate" : `${m.notice_days} days`],
    (m.ctc_current_lpa != null || m.ctc_expected_lpa != null) && ["CTC", [lpa(m.ctc_current_lpa), lpa(m.ctc_expected_lpa)].filter(Boolean).join(" → ") + (m.ctc_expected_lpa != null ? " exp." : "")],
    m.education && ["Edu", m.education],
  ].filter(Boolean);
  const checks = (m.checklist || []).filter((c) => c.key !== "mandatory_skills");

  return (
    <article className="cand">
      <div className="cand-head" onClick={() => setOpen(!open)}>
        <ScoreRing score={m.score} band={m.band} />
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="cand-name">{m.name}</span>
            <span className={`band ${bandClass(m.band)}`}>{m.band === "Do not advance" ? "Not a fit" : m.band === "Lead" ? "Lead" : m.band === "Review" ? "Review" : `Group ${m.band}`}</span>
            <span className="tag">{ORIGIN[m.origin] || m.origin}</span>
            {m.active_status && <span className="tag" style={{ color: /inactive|passive/i.test(m.active_status) ? "var(--muted)" : "var(--band-a)" }}>{m.active_status}</span>}
            {m.stale && m.kind === "resume" && <span className="tag stale" title="CTC, notice and location may be out of date">Details 60+ days old</span>}
            {!isLead && !m.deep_done && <span className="pending"><span className="pulse" />AI check queued</span>}
            {m.stage === "verified" && <span className="pending" style={{ color: "var(--band-a)" }}><Check size={13} />AI verified</span>}
          </div>
          <div className="cand-sub">{[m.current_title, m.current_company].filter(Boolean).join(" at ") || "Title not found"}</div>
          <div className="facts">{facts.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</div>
          {m.top_skills?.length > 0 && <div className="skills">{m.top_skills.map((s) => <span className="chip" key={s}>{s}</span>)}</div>}
        </div>
        <div className="cand-actions" onClick={(e) => e.stopPropagation()}>
          <StatusControl m={m} health={health || { statuses }} onChanged={onChanged} />
          {m.has_resume && <button className="btn small ghost" onClick={download}><Download size={14} />Resume</button>}
          {m.profile_url && <a className="btn small ghost" href={m.profile_url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Profile</a>}
          <button className="icon-btn" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
        </div>
      </div>

      {err && <div className="error" style={{ padding: "0 18px 12px" }}>{err}</div>}

      {open && m.stale && (
        <div style={{ padding: "0 18px 10px" }}><VerifyBar m={m} onChanged={onChanged} /></div>
      )}
      {open && (
        <div className="cand-body">
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--line)", paddingTop: 14, order: 3 }}>
            <Engagement m={m} health={health} onChanged={onChanged} />
          </div>
          <div>
            <h3>Requirement check</h3>
            {checks.map((c, i) => {
              const I = ICON[c.status] || CircleHelp;
              return (
                <div className="check" key={i}>
                  <I size={16} className={`st-${c.status}`} />
                  <span style={{ fontWeight: 600 }}>{c.criterion}</span>
                  <span className={c.status === "meets" ? "" : `st-${c.status}`}>{c.status === "unverified" ? "Claimed, not found in resume text — verify" : c.detail}</span>
                  {c.evidence && <span className="ev">“{c.evidence}”</span>}
                </div>
              );
            })}
            {m.summary && <p style={{ marginTop: 14 }}>{m.summary}</p>}
            {m.deep_error && <p className="faint" style={{ fontSize: 13 }}>AI check skipped: {m.deep_error}</p>}
          </div>
          <div>
            <h3>Contact</h3>
            <div className="contact" style={{ display: "grid", gap: 4, marginBottom: 16, fontSize: 14 }}>
              {m.email ? <a href={`mailto:${m.email}`}>{m.email}</a> : <span className="faint">No email</span>}
              {m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : <span className="faint">No phone</span>}
              {isLead && <span className="faint">Found through public profile search. Reach out on the platform to get contact details and a resume.</span>}
            </div>
            {m.outreach && (
              <>
                <h3>Outreach message</h3>
                <p style={{ fontSize: 14, background: "var(--base)", padding: 12, borderRadius: 8 }}>{m.outreach}</p>
                <button className="btn small" onClick={() => { navigator.clipboard.writeText(m.outreach); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Copy size={14} />{copied ? "Copied" : "Copy message"}</button>
              </>
            )}
            {m.gaps?.length > 0 && (<><h3 style={{ marginTop: 16 }}>Gaps and flags</h3><ul className="list">{m.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>)}
            {m.questions?.length > 0 && (<><h3 style={{ marginTop: 16 }}>Ask on the screening call</h3>
              <ul className="list">{m.questions.map((q, i) => <li key={i}>{q.replace(/^•\s*/, "")}</li>)}</ul></>)}
            <h3 style={{ marginTop: 16 }}>History</h3>
            {!history && <p className="faint" style={{ fontSize: 13 }}>Loading…</p>}
            {history && history.timeline.length === 0 && <p className="faint" style={{ fontSize: 13 }}>No earlier activity for this person.</p>}
            {history && history.timeline.length > 0 && (
              <ul className="timeline">{history.timeline.slice(0, 12).map((t, i) => <li key={i}><span className="faint">{String(t.at).slice(0, 10)}</span> {t.text}</li>)}</ul>
            )}
            {history?.mandates?.length > 1 && <p className="faint" style={{ fontSize: 12.5 }}>Also in: {history.mandates.filter((x) => x.mandate_id !== m.mandate_id).map((x) => `${x.code} (${x.status})`).join(", ")}</p>}
            {m.model && <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>Scored by {m.model}{m.last_verified_at ? ` · details last verified ${String(m.last_verified_at).slice(0, 10)}` : ""}</p>}
          </div>
        </div>
      )}
    </article>
  );
}

function VerifyBar({ m, onChanged }) {
  const [v, setV] = useState({ ctc_current_lpa: m.ctc_current_lpa ?? "", ctc_expected_lpa: m.ctc_expected_lpa ?? "", notice_days: m.notice_days ?? "", location: m.location || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.post(`/candidates/${m.candidate_id}/verify`, v); onChanged({ ...m, ...v, stale: false, last_verified_at: new Date().toISOString() }); } finally { setBusy(false); } };
  return (
    <div className="notice row" style={{ gap: 8 }}>
      <span style={{ fontSize: 13.5 }}><b>Verify before submitting:</b> these details were last confirmed over 60 days ago.</span>
      <input className="input" style={{ width: 110 }} placeholder="Current LPA" value={v.ctc_current_lpa} onChange={(e) => setV({ ...v, ctc_current_lpa: e.target.value })} />
      <input className="input" style={{ width: 110 }} placeholder="Expected LPA" value={v.ctc_expected_lpa} onChange={(e) => setV({ ...v, ctc_expected_lpa: e.target.value })} />
      <input className="input" style={{ width: 110 }} placeholder="Notice days" value={v.notice_days} onChange={(e) => setV({ ...v, notice_days: e.target.value })} />
      <input className="input" style={{ width: 130 }} placeholder="Location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      <button className="btn small primary" disabled={busy} onClick={save}>Confirmed with candidate</button>
    </div>
  );
}
