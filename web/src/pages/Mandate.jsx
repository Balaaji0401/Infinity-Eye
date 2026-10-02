import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Copy, Download, ExternalLink, FileSpreadsheet, FolderOpen, Link2, RefreshCw, Send, Upload, X } from "lucide-react";
import { api, getToken, inr, mandateColor } from "../api.js";
import { uploadResumes } from "../extract.js";
import { parseNaukriExport } from "../naukriImport.js";
import CandidateCard from "../components/CandidateCard.jsx";
import Compare from "../components/Compare.jsx";
import ScoutTable from "../components/ScoutTable.jsx";
import SpecEditor from "../components/SpecEditor.jsx";
import Chat from "../components/Chat.jsx";

const BANDS = [["all", "All"], ["A", "Group A"], ["B", "Group B"], ["Review", "Review"], ["Do not advance", "Not a fit"], ["Lead", "Leads"]];
const DEFAULT_W = { mandatory_skills: 30, experience: 20, title: 12, preferred_skills: 10, location: 10, ctc: 6, notice: 6, industry: 6 };

function CopyLine({ label, text }) {
  const [ok, setOk] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="query">{text}</div>
        <button className="btn small" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}><Copy size={14} />{ok ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

const SOURCE_DEFS = [
  ["naukri", "Naukri Resdex"], ["linkedin", "LinkedIn & public profiles"], ["github", "GitHub (tech roles)"], ["pool", "Talent pool"], ["boards", "Job boards & inbound"],
];

function CopyLinkButton({ label = "Copy link" }) {
  const [ok, setOk] = useState(false);
  return <button className="btn small ghost" onClick={() => { navigator.clipboard.writeText(window.location.href); setOk(true); setTimeout(() => setOk(false), 1200); }}><Link2 size={14} />{ok ? "Link copied" : label}</button>;
}

function ExportButton({ md, source, label }) {
  const [busy, setBusy] = useState(false);
  const n = source === "all" ? md.counts.resumes + md.counts.leads : md.counts.by_origin?.[source] || 0;
  return <button className="btn small" disabled={busy || !n} title={n ? "" : "No profiles from this source yet"}
    onClick={async () => { setBusy(true); try { await api.downloadPath(`/mandates/${md.id}/export?source=${source}`, `${md.code}-${source}.csv`); } finally { setBusy(false); } }}>
    <Download size={14} />{label} ({n})</button>;
}

function SearchStrings({ plan }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>{(plan.summary || []).map((s) => <span key={s} className="chip">{s}</span>)}</div>
      <button className="btn small ghost" onClick={() => setShow(!show)}>{show ? "Hide search strings" : "Show search strings to paste"}</button>
      {show && <div style={{ marginTop: 10 }}>{(plan.resdex || []).map((q) => <CopyLine key={q.name} label={q.name} text={q.query} />)}</div>}
    </div>
  );
}

function Sourcing({ md, health, reload }) {
  const isAdmin = health?.username === "admin";
  const fileRef = useRef(), folderRef = useRef(), xlsRef = useRef();
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const [source, setSource] = useState("naukri");
  const sources = md.sources || [];
  const plan = md.search_plan || {}, links = plan.links || {}, by = md.counts.by_origin || {};
  const toggleSource = async (k) => {
    const next = sources.includes(k) ? sources.filter((x) => x !== k) : [...sources, k];
    try { await api.patch(`/mandates/${md.id}`, { sources: next }); reload(); } catch (e) { setMsg(e.message); }
  };
  const report = (r, what) => {
    const parts = [`${r.uploaded ?? r.imported} ${what} ${(r.uploaded ?? r.imported) === 1 ? "" : ""}screened.`];
    if (r.duplicates?.length) parts.push(`Already on file, merged: ${r.duplicates.slice(0, 8).join(", ")}${r.duplicates.length > 8 ? ` and ${r.duplicates.length - 8} more` : ""}.`);
    if (r.skipped?.length) parts.push(`Skipped ${r.skipped.join(", ")} (use PDF, DOCX or TXT).`);
    else if (typeof r.skipped === "number" && r.skipped) parts.push(`${r.skipped} rows skipped.`);
    if (r.failed?.length) parts.push(`Failed: ${r.failed.join("; ")}`);
    return parts.join(" ");
  };
  const upload = async (files) => {
    if (!files?.length) return;
    setMsg("Reading resumes…");
    try {
      const r = await uploadResumes(api, md.id, files, source, (done, total) => { setMsg(`Screening ${done} of ${total} resumes…`); if (done % 5 === 0) reload(); });
      setMsg(report(r, "resumes")); reload();
    } catch (e) { setMsg(e.message); }
  };
  const importXls = async (file) => {
    if (!file) return;
    setMsg("Reading Naukri export…");
    try {
      const rows = await parseNaukriExport(file);
      const r = await api.post(`/mandates/${md.id}/naukri-import`, { rows });
      setMsg(r.error ? r.error : report(r, "Naukri profiles") + ` Open Scout to see the top ${md.top_n}.`); reload();
    } catch (e) { setMsg(e.message); }
  };
  const rerun = async (ch) => { try { await api.post(`/mandates/${md.id}/source/${ch}`); setMsg("Search started."); reload(); } catch (e) { setMsg(e.message); } };
  const Open = ({ href, children }) => href ? <a className="btn small ghost" href={href} target="_blank" rel="noreferrer"><ExternalLink size={14} />{children}</a> : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>Sourcing for {md.code}</h3><span className="spacer" /><CopyLinkButton label="Copy link to this sourcing page" /></div>
        <p className="muted" style={{ fontSize: 14 }}>Tick the channels the agent should use for this mandate. Untick to hide a channel and stop its automatic searches.</p>
        <div className="row" style={{ gap: 8 }}>
          {SOURCE_DEFS.map(([k, l]) => <label key={k} className={`chip ${sources.includes(k) ? "on" : ""}`} style={{ cursor: "pointer" }}>
            <input type="checkbox" hidden checked={sources.includes(k)} onChange={() => toggleSource(k)} />{l}{by[k] ? ` · ${by[k]}` : ""}</label>)}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>Download pulled profiles:</span>
          <ExportButton md={md} source="all" label="All" />
          {SOURCE_DEFS.filter(([k]) => sources.includes(k)).map(([k, l]) => <ExportButton key={k} md={md} source={k} label={l.split(" ")[0]} />)}
        </div>
      </div>

      {sources.includes("naukri") && (
        <div className="card">
          <h3>Naukri Resdex</h3>
          <ol className="list" style={{ paddingLeft: 20, marginBottom: 14 }}>
            <li>Open Resdex with your own login and run the search described below (the exact strings to paste are one click away).</li>
            <li>Either send the results page with the <b>∞ Eye Reach</b> extension, or use Resdex's <b>Export to Excel</b> and import the file here.</li>
          </ol>
          <SearchStrings plan={plan} />
          <div className="row">
            <Open href={links.naukri_resdex}>Open Resdex</Open>
            <button className="btn primary small" onClick={() => xlsRef.current.click()}><FileSpreadsheet size={14} />Import Resdex export (Excel / CSV)</button>
            <input ref={xlsRef} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => importXls(e.target.files[0])} />
            <ExportButton md={md} source="naukri" label="Download Naukri profiles" />
          </div>
        </div>
      )}

      {sources.includes("linkedin") && (
        <div className="card">
          <h3>LinkedIn and public profiles</h3>
          <p className="muted" style={{ fontSize: 14, marginTop: -4 }}>Automatic discovery uses search engines only. For LinkedIn itself, open the search link in your own account and send the results page with the Reach extension.</p>
          {plan.linkedin_boolean && <details style={{ marginBottom: 10 }}><summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Show search string for LinkedIn Recruiter</summary><div style={{ marginTop: 8 }}><CopyLine label="LinkedIn search" text={plan.linkedin_boolean} /></div></details>}
          <div className="row" style={{ marginBottom: 10 }}>
            <Open href={links.linkedin_people}>Open LinkedIn people search</Open>
            {(links.google_xray || []).slice(0, 2).map((u, i) => <Open key={u} href={u}>Google X-ray {i + 1}</Open>)}
            <button className="btn small" disabled={!health?.search_api} onClick={() => rerun("xray")}><RefreshCw size={14} />Run discovery again</button>
            <ExportButton md={md} source="linkedin" label="Download LinkedIn leads" />
          </div>
          {!health?.search_api && isAdmin && <p className="faint" style={{ fontSize: 13, margin: 0 }}>Automatic discovery is off. Admin: add a search provider key (SERPER_API_KEY or EXA_API_KEY) to enable it.</p>}
          {!health?.search_api && !isAdmin && <p className="faint" style={{ fontSize: 13, margin: 0 }}>Automatic discovery isn't enabled on this workspace yet.</p>}
        </div>
      )}

      {sources.includes("github") && (
        <div className="card">
          <h3>GitHub</h3>
          {plan.github_query ? <div className="row"><Open href={links.github}>Open on GitHub</Open><button className="btn small" onClick={() => rerun("github")}><RefreshCw size={14} />Search GitHub</button><ExportButton md={md} source="github" label="Download GitHub leads" /></div>
            : <p className="muted" style={{ margin: 0, fontSize: 14 }}>No programming language in the requirements, so there's nothing to search on GitHub for this role.</p>}
        </div>
      )}

      {sources.includes("pool") && (
        <div className="card">
          <h3>Talent pool</h3>
          <p className="muted" style={{ fontSize: 14, marginTop: -4 }}>Everyone ever imported into any mandate, matched to this JD by meaning and then scored.</p>
          <div className="row"><button className="btn small" onClick={() => rerun("pool")}><RefreshCw size={14} />Re-check talent pool</button><ExportButton md={md} source="pool" label="Download pool matches" /></div>
        </div>
      )}

      {sources.includes("boards") && (
        <div className="card">
          <h3>Job boards and inbound</h3>
          <p className="muted" style={{ fontSize: 14, marginTop: -4 }}>Post the role, then import applicants' resumes here (source "Job post / inbound") or send a board's results page with Reach.</p>
          <div className="row"><Open href={links.indeed_resumes}>Indeed resume search</Open><Open href={links.linkedin_jobs_post}>Post job on LinkedIn</Open><ExportButton md={md} source="inbound" label="Download inbound" /></div>
        </div>
      )}

      <div className="two">
        <div className="card">
          <h3>Upload resumes</h3>
          <div className={`dropzone ${over ? "over" : ""}`} onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
            <Upload size={22} /><div style={{ marginTop: 6 }}>Drop PDF, DOCX or TXT resumes here, or click to choose</div>
          </div>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt" onChange={(e) => upload(e.target.files)} />
          <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => upload(e.target.files)} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => folderRef.current.click()}><FolderOpen size={14} />Upload a whole folder</button>
            <select className="select" style={{ width: 200 }} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="naukri">From Naukri</option><option value="inbound">Job post / inbound</option><option value="upload">Other</option>
            </select>
          </div>
        </div>
        {isAdmin && <div className="card">
          <h3>Reach: send any results page straight here</h3>
          <p className="muted" style={{ fontSize: 14, marginTop: -4 }}>Install the ∞ Eye Reach extension (folder <code>extras/reach-extension</code>). On a Resdex or LinkedIn results page in your own browser, click it and choose this mandate. Token for the extension:</p>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <div className="query">{getToken()}</div>
            <button className="btn small" onClick={() => { navigator.clipboard.writeText(getToken()); setMsg("Token copied. Paste it in the extension's Settings along with this site's URL."); }}><Copy size={14} />Copy</button>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>Mandate id for the folder bridge: <b>{md.id}</b>.</p>
        </div>}
      </div>
      {msg && <div className="notice">{msg}</div>}
    </div>
  );
}

function ResumeAnalysis({ md, rows, statuses, health, onChanged, reload }) {
  const fileRef = useRef(), folderRef = useRef();
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState([]);
  const [open, setOpen] = useState(null);
  const withResume = rows.filter((m) => m.has_resume || m.kind === "resume");
  const upload = async (files) => {
    if (!files?.length) return;
    setMsg("Reading resumes…");
    try {
      const r = await uploadResumes(api, md.id, files, "naukri", (d, t) => setMsg(`Analysing ${d} of ${t}…`));
      setMsg(`${r.uploaded} resume${r.uploaded === 1 ? "" : "s"} analysed.` + (r.duplicates.length ? ` Already on file and merged: ${r.duplicates.join(", ")}.` : "") + (r.failed.length ? ` Failed: ${r.failed.join("; ")}` : ""));
      reload();
    } catch (e) { setMsg(e.message); }
  };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const compareRows = selected.map((id) => rows.find((m) => m.id === id)).filter(Boolean);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card row">
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>Add resumes for deeper analysis</h3>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>Download a resume from Naukri for anyone you're serious about, then add it here. If the person is already in the list, the resume is attached to them.</p>
        </div>
        <button className="btn" onClick={() => fileRef.current.click()}><Upload size={16} />Add resumes</button>
        <button className="btn ghost" onClick={() => folderRef.current.click()}><FolderOpen size={16} />Folder</button>
        <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt" onChange={(e) => upload(e.target.files)} />
        <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={(e) => upload(e.target.files)} />
      </div>
      {msg && <div className="notice">{msg}</div>}

      <div>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Compare candidates</h3>
          <span className="muted" style={{ fontSize: 13 }}>Tick up to four.</span>
          {selected.length > 0 && <button className="btn small ghost" onClick={() => setSelected([])}><X size={14} />Clear</button>}
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          {withResume.map((m) => (
            <label key={m.id} className={`chip ${selected.includes(m.id) ? "on" : ""}`} style={{ cursor: "pointer" }}>
              <input type="checkbox" hidden checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />{m.name} <span style={{ opacity: .7 }}>{m.score}</span>
            </label>
          ))}
          {withResume.length === 0 && <span className="muted">No resumes on file yet.</span>}
        </div>
        <Compare rows={compareRows} />
      </div>

      <div>
        <h3>Resume detail</h3>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          {withResume.map((m) => <button key={m.id} className={`chip ${open === m.id ? "on" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setOpen(open === m.id ? null : m.id)}>{m.name}</button>)}
        </div>
        {open && withResume.filter((m) => m.id === open).map((m) => <CandidateCard key={m.id} m={m} statuses={statuses} health={health} onChanged={onChanged} defaultOpen />)}
      </div>
    </div>
  );
}

function Requirements({ md, onSaved }) {
  const [spec, setSpec] = useState(md.spec);
  const [f, setF] = useState({ client_name: md.client_name, fee_type: md.fee_type, fee_value: md.fee_value, recruiter_hours: md.recruiter_hours, status: md.status, top_n: md.top_n });
  const [msg, setMsg] = useState("");
  const save = async () => {
    try {
      const r = await api.patch(`/mandates/${md.id}`, { spec, ...f, fee_value: Number(f.fee_value), recruiter_hours: Number(f.recruiter_hours), top_n: Number(f.top_n) || 5 });
      onSaved(r); setMsg("Saved. Candidates re-scored against the new requirements.");
    } catch (e) { setMsg(e.message); }
  };
  const learned = async () => { try { const r = await api.post(`/mandates/${md.id}/apply-learned-weights`); setSpec(r.mandate.spec); onSaved(r.mandate); setMsg(`Applied weights learned from your decisions (${r.from}).`); } catch (e) { setMsg(e.message); } };
  const delRule = async (id) => { await api.del(`/rules/${id}`); onSaved({ ...md, rules: md.rules.filter((r) => r.id !== id) }); };
  return (
    <div>
      {md.compliance_flags?.length > 0 && <div className="notice bad" style={{ marginBottom: 14 }}>JD mentions criteria that are ignored in screening: {md.compliance_flags.map((x) => x.label).join(", ")}.</div>}
      <SpecEditor spec={spec} onChange={setSpec} />
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Client, fee and effort</h3>
        <div className="spec-grid">
          <label className="field wide">Client<input className="input" value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></label>
          <label className="field">Fee type<select className="select" value={f.fee_type} onChange={(e) => setF({ ...f, fee_type: e.target.value })}><option value="percent">% of annual CTC</option><option value="flat">Flat fee (₹)</option></select></label>
          <label className="field">{f.fee_type === "percent" ? "Fee %" : "Fee (₹)"}<input className="input" type="number" value={f.fee_value} onChange={(e) => setF({ ...f, fee_value: e.target.value })} /></label>
          <label className="field">Recruiter hours spent<input className="input" type="number" min="0" step="0.5" value={f.recruiter_hours} onChange={(e) => setF({ ...f, recruiter_hours: e.target.value })} /></label>
          <label className="field">Profiles to show in Scout<input className="input" type="number" min="1" max="100" value={f.top_n} onChange={(e) => setF({ ...f, top_n: e.target.value })} /></label>
          <label className="field">Mandate status<select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></label>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Scoring weights</h3>
        <div className="row" style={{ gap: 6 }}>
          {Object.entries(DEFAULT_W).map(([k, d]) =>
            <span key={k} className="chip">{k.replace("_", " ")} <b>{spec.weights?.[k] ?? d}</b>{spec.weights?.[k] != null && spec.weights[k] !== d ? <span className="faint">(default {d})</span> : null}</span>)}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn small" onClick={learned}>Apply weights learned from my decisions</button>
          <button className="btn small ghost" onClick={() => setSpec({ ...spec, weights: {} })}>Reset to defaults</button>
          <span className="faint" style={{ fontSize: 12.5 }}>Learning uses your shortlist and reject decisions and needs at least three of each.</span>
        </div>
      </div>
      {md.rules?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Rules from your prompts</h3>
          {md.rules.map((r) => <div key={r.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ flex: 1 }}>{r.text}</span><span className="tag">{r.scope === "mandate" ? "this mandate" : r.scope === "client" ? "this client" : "all mandates"}</span>
            <button className="icon-btn" title="Forget this rule" onClick={() => delRule(r.id)}><X size={15} /></button></div>)}
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={save}>Save and re-score</button>{msg && <span className="muted">{msg}</span>}</div>
      {md.jd_text && <details style={{ marginTop: 22 }}><summary className="muted" style={{ cursor: "pointer" }}>Original job description</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{md.jd_text}</pre></details>}
    </div>
  );
}

export default function MandatePage({ health, refreshMandates }) {
  const { id, tab: tabParam } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [conversationId, setConversationId] = useState(params.get("conversation") ? +params.get("conversation") : null);
  const [dock, setDock] = useState(true);
  const [md, setMd] = useState(null);
  const [rows, setRows] = useState([]);
  const TABS = ["scout", "candidates", "analysis", "engagement", "submissions", "sourcing", "requirements"];
  const tab = TABS.includes(tabParam) ? tabParam : "scout";
  const setTab = (t) => nav(`/mandates/${id}/${t}${window.location.search}`);
  const [band, setBand] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState([]);
  const [subMsg, setSubMsg] = useState("");
  const [subs, setSubs] = useState([]);
  const toggleSel = (mid) => setSelected((s) => (s.includes(mid) ? s.filter((x) => x !== mid) : [...s, mid]));
  const openPack = async (query) => {
    const res = await fetch(`/api/mandates/${id}/pack?${query}`, { headers: { Authorization: `Bearer ${localStorage.getItem("nr_token")}` } });
    if (!res.ok) { setSubMsg((await res.json()).detail || "Couldn't open the pack."); return; }
    const blob = await res.blob(); const url = URL.createObjectURL(blob); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const submitSelected = async (override = false) => {
    if (!selected.length) return;
    setSubMsg("Preparing submission…");
    try {
      const r = await api.post(`/mandates/${id}/submissions`, { match_ids: selected, override });
      if (r.blocked?.length && !override) {
        const names = r.blocked.map((b) => rows.find((x) => x.id === b.match_id)?.name || b.match_id);
        setSubMsg(`${r.submissions.length} submitted. Not submitted (already sent to this client recently): ${names.join(", ")}. Click "Submit anyway" to override; the override is recorded.`);
      } else setSubMsg(`${r.submissions.length} candidate${r.submissions.length === 1 ? "" : "s"} submitted to ${md.client_name || "the client"}. Opening the pack…`);
      if (r.submissions.length) await openPack(`ids=${r.submissions.map((s) => s.id).join(",")}`);
      setSelected([]); load(); loadSubs();
    } catch (e) { setSubMsg(e.message); }
  };
  const loadSubs = () => api.get(`/mandates/${id}/submissions`).then(setSubs).catch(() => {});
  const [outreach, setOutreach] = useState([]);
  const loadOutreach = () => api.get(`/mandates/${id}/outreach`).then(setOutreach).catch(() => {});
  useEffect(() => { loadSubs(); loadOutreach(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftFor = async (channel) => {
    if (!selected.length) return;
    try { const r = await api.post(`/mandates/${id}/outreach`, { match_ids: selected, channel }); setSubMsg(`${r.drafts.length} ${channel} draft${r.drafts.length === 1 ? "" : "s"} created${r.skipped.length ? `; skipped: ${r.skipped.join("; ")}` : ""}. Review them under Engagement.`); setSelected([]); loadOutreach(); setTab("engagement"); }
    catch (e) { setSubMsg(e.message); }
  };
  const sendOne = async (o) => { try { const r = await api.post(`/outreach/${o.id}/send`, {}); setSubMsg(r.status === "failed" ? `Couldn't send to ${o.name}: ${r.error}` : r.manual ? `Approved for ${o.name}. Copy the message, send it from your ${o.channel === "email" ? "mailbox" : "phone"}, then mark it sent.` : `Sent to ${o.name}.`); loadOutreach(); load(); } catch (e) { setSubMsg(e.message); } };
  const sendAll = async () => { for (const o of outreach.filter((x) => x.status === "draft")) await api.post(`/outreach/${o.id}/send`, {}).catch(() => {}); loadOutreach(); load(); setSubMsg("Approved all drafts."); };

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([api.get(`/mandates/${id}`), api.get(`/mandates/${id}/matches?kind=all`)]);
      setMd(m); setRows(r); setErr("");
    } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => { setMd(null); setBand("all"); setOpenId(null); setConversationId(params.get("conversation") ? +params.get("conversation") : null); load(); }, [id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = md && (md.progress.jobs.length > 0 || md.progress.deep_done < md.progress.deep_total);
  useEffect(() => { if (!busy) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [busy, load]);

  if (err) return <div className="page error">{err}</div>;
  if (!md) return <div className="page muted">Loading…</div>;
  const statuses = health?.statuses || ["New"];
  const replace = (u) => setRows((list) => list.map((x) => (x.id === u.id ? u : x)));
  const scout = rows.filter((m) => m.band !== "Do not advance").slice(0, md.top_n || 5);
  const shown = band === "all" ? rows : rows.filter((r) => r.band === band);
  const p = md.progress;

  return (
    <div>
      <header className="hero" style={{ background: `linear-gradient(180deg, ${mandateColor(md.id, 42)} 0%, ${mandateColor(md.id, 20)} 70%, var(--base) 100%)` }}>
        <div className="kicker">Mandate {md.code}{md.status === "closed" ? ", closed" : ""}</div>
        <h1>{md.title}</h1>
        <div className="meta">{md.client_name || "No client"}. {rows.length} profiles, {md.counts.bands.A} in Group A, showing top {md.top_n}.
          {" "}Fee {md.fee_type === "percent" ? `${md.fee_value}% of CTC` : inr(md.fee_value)}.</div>
        <div className="row" style={{ marginTop: 10 }}>
          <CopyLinkButton label={`Copy link to this ${tab} page`} />
          <button className="btn small ghost" onClick={() => api.downloadPath(`/mandates/${md.id}/tracker`, `${md.code}-tracker.csv`)}><Download size={14} />Download tracker</button>
        </div>
        {busy && (
          <div style={{ marginTop: 16, maxWidth: 520 }}>
            <div className="meta" style={{ fontSize: 13, marginBottom: 6 }}>
              {p.jobs.length > 0 ? `Working: ${[...new Set(p.jobs.map((j) => ({ xray: "searching public profiles", github: "searching GitHub", pool: "checking talent pool" }[j.type] || j.type)))].join(", ")}. ` : ""}
              AI verification {p.deep_done} of {p.deep_total}.
            </div>
            <div className="progress"><div style={{ width: `${p.deep_total ? (100 * p.deep_done) / p.deep_total : 0}%` }} /></div>
          </div>
        )}
        {md.errors?.length > 0 && <div className="notice bad" style={{ marginTop: 12, maxWidth: 700 }}>{md.errors[0].type} search failed: {md.errors[0].error}</div>}
      </header>
      <nav className="tabs">
        {[["scout", `Scout top ${md.top_n}`], ["candidates", `All profiles ${rows.length}`], ["analysis", "Resume analysis"], ["engagement", `Engagement${outreach.filter((o) => o.status === "draft").length ? ` · ${outreach.filter((o) => o.status === "draft").length} to approve` : ""}`], ["submissions", `Submissions ${subs.length}`], ["sourcing", "Sourcing"], ["requirements", "Requirements"]].map(([k, l]) =>
          <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <div className="page" style={{ paddingTop: 20 }}>
        {tab === "scout" && (
          <>
            {selected.length > 0 && (
              <div className="selbar">
                <b>{selected.length} selected</b>
                <button className="btn small" onClick={() => draftFor("email")}>Draft email</button>
                <button className="btn small" onClick={() => draftFor("whatsapp")}>Draft WhatsApp</button>
                <button className="btn primary small" onClick={() => submitSelected(false)}><Send size={14} />Submit to {md.client_name || "client"}</button>
                {subMsg.includes("override") && <button className="btn small" onClick={() => submitSelected(true)}>Submit anyway</button>}
                <button className="btn small ghost" onClick={() => setSelected([])}>Clear</button>
                <span className="muted" style={{ fontSize: 13 }}>Creates a client-ready pack with verified facts only; the submission is recorded permanently.</span>
              </div>
            )}
            {subMsg && <div className="notice" style={{ marginBottom: 12 }}>{subMsg}</div>}
            <ScoutTable rows={scout} statuses={statuses} health={health} onChanged={replace} onOpen={(m) => setOpenId(openId === m.id ? null : m.id)} selected={selected} onSelect={toggleSel} />
            {openId && rows.filter((m) => m.id === openId).map((m) => <div key={m.id} style={{ marginTop: 14 }}><CandidateCard m={m} statuses={statuses} health={health} onChanged={replace} defaultOpen /></div>)}
            {rows.length === 0 && <div className="card" style={{ marginTop: 14 }}><h3>Get your first profiles</h3><p className="muted">Open <b>Sourcing</b>, run the Resdex search in Naukri, export the results and import the file. Or upload resumes directly.</p><button className="btn primary" onClick={() => setTab("sourcing")}>Go to sourcing</button></div>}
          </>
        )}
        {tab === "candidates" && (
          <>
            <div className="row" style={{ marginBottom: 14, gap: 6 }}>
              {BANDS.map(([k, l]) => <button key={k} className={`chip ${band === k ? "on" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setBand(k)}>
                {l}{k !== "all" ? ` ${rows.filter((r) => r.band === k).length}` : ""}</button>)}
            </div>
            {shown.map((m) => <CandidateCard key={m.id} m={m} statuses={statuses} health={health} onChanged={replace} />)}
            {shown.length === 0 && <div className="card muted">Nothing here yet.</div>}
          </>
        )}
        {tab === "engagement" && (
          <div className="card">
            <div className="row"><h3 style={{ margin: 0 }}>Outreach queue</h3><span className="spacer" />
              {outreach.some((o) => o.status === "draft") && <button className="btn primary small" onClick={sendAll}><Send size={14} />Approve all drafts</button>}</div>
            <p className="muted" style={{ fontSize: 14 }}>Select candidates on Scout and draft email or WhatsApp messages. Nothing goes out until you approve it. Replies arrive through the personal link in each message and update the candidate's status automatically.</p>
            {subMsg && <div className="notice" style={{ marginBottom: 10 }}>{subMsg}</div>}
            {outreach.length === 0 ? <p className="faint">No messages yet.</p> : (
              <table className="table"><thead><tr><th>Candidate</th><th>Channel</th><th>Type</th><th>Status</th><th>Reply</th><th>When</th><th></th></tr></thead>
                <tbody>{outreach.map((o) => <tr key={o.id}><td>{o.name}</td><td>{o.channel}</td><td>{o.kind}</td><td><span className={`tag st-${o.status}`}>{o.status}</span>{o.error ? <div className="faint" style={{ fontSize: 12 }}>{o.error}</div> : null}</td>
                  <td>{o.response || <span className="faint">—</span>}</td><td className="faint">{String(o.sent_at || o.created_at).slice(0, 16)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{["draft", "failed"].includes(o.status) && <button className="btn small primary" onClick={() => sendOne(o)}>Approve & send</button>}
                    {o.status === "approved" && <><button className="btn small" onClick={() => navigator.clipboard.writeText((o.subject ? o.subject + "\n\n" : "") + o.body)}>Copy</button> <button className="btn small" onClick={async () => { await api.patch(`/outreach/${o.id}`, { status: "sent" }); loadOutreach(); load(); }}>Mark sent</button></>}
                    <button className="btn small ghost" onClick={() => setOpenId(o.match_id) || setTab("scout")}>Open</button></td></tr>)}</tbody></table>
            )}
          </div>
        )}
        {tab === "submissions" && (
          <div className="card">
            <div className="row"><h3 style={{ margin: 0 }}>Submissions to {md.client_name || "client"}</h3><span className="spacer" />
              {subs.length > 0 && <button className="btn small" onClick={() => openPack(`ids=${subs.map((s) => s.id).join(",")}`)}><ExternalLink size={14} />Open full pack</button>}</div>
            <p className="muted" style={{ fontSize: 14 }}>Each submission is a permanent record of what was sent, with the facts as verified at that time. Select candidates on Scout and click "Submit to client" to add one.</p>
            {subs.length === 0 ? <p className="faint">No submissions yet.</p> : (
              <table className="table"><thead><tr><th>Candidate</th><th>Version</th><th>Submitted by</th><th>When (UTC)</th><th></th></tr></thead>
                <tbody>{subs.map((s) => <tr key={s.id}><td>{s.name}</td><td>v{s.version}</td><td>{s.submitted_by}</td><td>{String(s.created_at).slice(0, 16)}</td><td><button className="btn small ghost" onClick={() => openPack(`ids=${s.id}`)}><ExternalLink size={14} />Pack</button></td></tr>)}</tbody></table>
            )}
          </div>
        )}
        {tab === "analysis" && <ResumeAnalysis md={md} rows={rows} statuses={statuses} health={health} onChanged={replace} reload={load} />}
        {tab === "sourcing" && <Sourcing md={md} health={health} reload={load} />}
        {tab === "requirements" && <Requirements md={md} onSaved={(r) => { setMd(r); load(); refreshMandates(); }} />}
      </div>
      <div className={`chat-dock ${dock ? "" : "closed"}`}>
        <button className="chat-dock-toggle" onClick={() => setDock(!dock)}>{dock ? "Hide chat" : "Chat about these profiles"}</button>
        {dock && <Chat key={`${id}-${conversationId}`} mandateId={md.id} conversationId={conversationId} onConversation={setConversationId} compact
          onActions={() => { load(); refreshMandates(); }} />}
      </div>
    </div>
  );
}
