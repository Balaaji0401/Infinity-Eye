import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUp, Paperclip } from "lucide-react";
import { api, mandateColor } from "../api.js";
import { extractText } from "../extract.js";
import SpecEditor, { EMPTY_SPEC } from "../components/SpecEditor.jsx";
import Chat from "../components/Chat.jsx";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function Home({ health, mandates, refreshMandates }) {
  const nav = useNavigate();
  const fileRef = useRef();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [spec, setSpec] = useState(null);
  const [client, setClient] = useState("");
  const [feeType, setFeeType] = useState("percent");
  const [feeValue, setFeeValue] = useState(8.33);
  const [mode, setMode] = useState("chat");
  const [sources, setSources] = useState(["pool", "naukri", "linkedin", "github"]);
  const [dups, setDups] = useState([]);
  const [force, setForce] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  const loadFile = async (f) => {
    if (!f) return;
    setErr(""); setBusy("Reading file…");
    try {
      const t = await extractText(f);
      if (!t.trim()) throw new Error("No text found in that file. Paste the JD instead.");
      setText(t);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };

  const analyze = async () => {
    setErr(""); setBusy("Reading the JD…");
    try {
      const r = await api.post("/jd/analyze", { text, conversation_id: conversationId });
      setAnalysis(r); setSpec(r.spec); setForce(false);
      api.post("/jd/duplicates", { spec: r.spec, client_name: client, jd_text: text }).then((d) => setDups(d.duplicates || [])).catch(() => {});
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };

  const start = async () => {
    if (!spec.title.trim()) return setErr("Give the role a job title.");
    setErr(""); setBusy("Creating mandate and starting sourcing…");
    try {
      const md = await api.post("/mandates", { client_name: client, jd_text: text, spec, fee_type: feeType, fee_value: Number(feeValue) || 0, conversation_id: conversationId, sources, force });
      await refreshMandates();
      nav(`/mandates/${md.id}/scout${conversationId ? `?conversation=${conversationId}` : ""}`);
    } catch (e) {
      if (e.status === 409 && e.data?.duplicates) { setDups(e.data.duplicates); setForce(true); setErr("This JD matches an existing mandate. Open it, or click Start sourcing again to create a duplicate anyway."); }
      else setErr(e.message);
      setBusy("");
    }
  };

  return (
    <div className="page">
      <div className="hello">{greeting()}{health?.display_name ? `, ${health.display_name}` : ""}</div>
      <div className="muted">Chat to set the scene, then paste the JD. The agent pulls out the requirements, finds and ranks candidates, and keeps the conversation going about them.</div>
      {health?.using_default_password && health?.username === "admin" && (
        <div className="notice bad" style={{ marginTop: 18 }}>
          This deployment is using the initial admin password. Before adding real candidate data, set the
          <code style={{ marginLeft: 5 }}>APP_PASSWORD</code> secret in Cloudflare under Settings → Variables and Secrets.
        </div>
      )}

      {!spec && (
        <>
          <div className="mode-row">
            <button className={`tab ${mode === "chat" ? "on" : ""}`} onClick={() => setMode("chat")}>Chat</button>
            <button className={`tab ${mode === "analyze" ? "on" : ""}`} onClick={() => setMode("analyze")}>Analyze JD</button>
            {conversationId && mode === "analyze" && <span className="faint" style={{ fontSize: 12.5 }}>Your chat context will be used when analysing the JD.</span>}
          </div>
          {mode === "chat" && <div className="composer chat-home"><Chat conversationId={conversationId} onConversation={setConversationId} /></div>}
          {mode === "analyze" && <div className="composer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Job description"
              placeholder="Paste the job description here…" />
            <div className="bar">
              <button className="drop-hint" onClick={() => fileRef.current.click()}><Paperclip size={14} style={{ verticalAlign: -2 }} /> Attach JD (PDF, DOCX, TXT)</button>
              <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt" onChange={(e) => loadFile(e.target.files[0])} />
              <button className="btn ghost small" onClick={() => { setSpec({ ...EMPTY_SPEC }); setAnalysis({ compliance_flags: [] }); }}>Fill the template instead</button>
              <span className="spacer" />
              <button className="btn primary" disabled={!text.trim() || !!busy} onClick={analyze} aria-label="Analyze job description"><ArrowUp size={18} />Analyze JD</button>
            </div>
          </div>}
          {busy && <p className="muted" style={{ marginTop: 12 }}><span className="pulse" style={{ display: "inline-block", marginRight: 8 }} />{busy}</p>}
          {err && <p className="error">{err}</p>}

          {mandates.length > 0 && (
            <section style={{ marginTop: 40 }}>
              <h2>Recent mandates</h2>
              <div className="shelf">
                {mandates.slice(0, 10).map((m) => (
                  <Link key={m.id} to={`/mandates/${m.id}`} className="shelf-item">
                    <div className="art" style={{ background: `linear-gradient(135deg, ${mandateColor(m.id, 70)}, ${mandateColor(m.id, 45)})` }}>{m.title}</div>
                    <div style={{ fontWeight: 700 }}>{m.client_name || "No client"}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{m.resumes} screened, {m.leads} leads</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {spec && (
        <section style={{ marginTop: 26 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Check the requirements</h2>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => { setSpec(null); setAnalysis(null); }}>Back to JD</button>
          </div>
          {analysis?.warning && <div className="notice" style={{ marginBottom: 14 }}>{analysis.warning}</div>}
          {(analysis?.missing?.length > 0 || analysis?.ambiguities?.length > 0) && (
            <div className="two" style={{ marginBottom: 14 }}>
              {analysis.missing?.length > 0 && (
                <div className="card">
                  <h3 style={{ marginBottom: 6 }}>Missing information</h3>
                  <p className="muted" style={{ margin: "0 0 8px", fontSize: 13.5 }}>The JD doesn't state these. Confirm them with the client or fill them in below; nothing is assumed.</p>
                  <ul className="list">{analysis.missing.map((m) => <li key={m.field}><b>{m.label}.</b> <span className="muted">{m.hint}</span></li>)}</ul>
                </div>
              )}
              {analysis.ambiguities?.length > 0 && (
                <div className="card">
                  <h3 style={{ marginBottom: 6 }}>Needs a decision</h3>
                  <ul className="list">{analysis.ambiguities.map((a, i) => <li key={i}><b>{a.label}.</b> <span className="muted">{a.detail}</span></li>)}</ul>
                </div>
              )}
            </div>
          )}
          {analysis?.compliance_flags?.length > 0 && (
            <div className="notice bad" style={{ marginBottom: 14 }}>
              <b>This JD mentions criteria you can't screen on:</b> {analysis.compliance_flags.map((f) => f.label).join(", ")}.
              The agent ignores them. Ask the client to remove them from the JD.
            </div>
          )}
          {dups.length > 0 && (
            <div className="notice bad" style={{ marginBottom: 14 }}>
              <b>Possible duplicate.</b> This looks like {dups.map((d) => <span key={d.id}> <Link to={`/mandates/${d.id}/scout`} style={{ color: "inherit" }}>{d.code} {d.title} ({d.client_name || "no client"}, {d.status})</Link> — {d.reasons.join(", ")};</span>)}
              {" "}Open the existing mandate to add profiles there, or continue to create a new one.
            </div>
          )}
          <SpecEditor spec={spec} onChange={setSpec} />
          <div className="card" style={{ marginTop: 18 }}>
            <h3>Where to source</h3>
            <div className="row" style={{ gap: 8 }}>
              {[["pool", "Talent pool"], ["naukri", "Naukri Resdex"], ["linkedin", "LinkedIn & public profiles"], ["github", "GitHub (tech roles)"], ["boards", "Job boards & inbound"]].map(([k, l]) =>
                <label key={k} className={`chip ${sources.includes(k) ? "on" : ""}`} style={{ cursor: "pointer" }}>
                  <input type="checkbox" hidden checked={sources.includes(k)} onChange={() => setSources((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} />{l}</label>)}
            </div>
            <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>The agent runs only the channels you tick. You can change this later on the mandate's Sourcing page.</p>
          </div>
          <div className="card" style={{ marginTop: 18 }}>
            <h3>Client and fee</h3>
            <div className="spec-grid">
              <label className="field wide">Client name<input className="input" value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => spec && api.post("/jd/duplicates", { spec, client_name: client, jd_text: text }).then((d) => setDups(d.duplicates || [])).catch(() => {})} placeholder="e.g. HellermannTyton India" /></label>
              <label className="field">Fee type<select className="select" value={feeType} onChange={(e) => setFeeType(e.target.value)}>
                <option value="percent">% of annual CTC</option><option value="flat">Flat fee (₹)</option></select></label>
              <label className="field">{feeType === "percent" ? "Fee %" : "Fee amount (₹)"}<input className="input" type="number" min="0" step="0.01" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} /></label>
            </div>
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" disabled={!!busy} onClick={start}>Start sourcing</button>
            <span className="muted" style={{ fontSize: 13 }}>Searches your talent pool{health?.search_api ? ", LinkedIn and other public profiles" : ""}, and prepares Naukri searches.</span>
          </div>
          {busy && <p className="muted">{busy}</p>}
          {err && <p className="error">{err}</p>}
        </section>
      )}
    </div>
  );
}
