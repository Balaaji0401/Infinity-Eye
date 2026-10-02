import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck, Sparkles, Target } from "lucide-react";
import { api, setToken } from "../api.js";

const PROOF = [
  { k: "From JD to ranked shortlist", v: "in minutes, not days" },
  { k: "Every score explained", v: "requirement by requirement, with the evidence" },
  { k: "Recruiter stays in control", v: "AI recommends, people decide" },
];
const QUOTES = [
  { q: "Paste the JD, talk to it like a colleague, and the shortlist builds itself. The part I trust most is that it shows me why.", who: "Senior Recruiter, manufacturing hiring" },
  { q: "We stopped reading 60 resumes to find 6. Now we read the 6 and spend the morning on calls.", who: "Talent Acquisition Lead" },
  { q: "Duplicates, old submissions, who we already spoke to: it remembers so we don't have to.", who: "Recruitment Consultant" },
];

export default function Login({ onDone }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});
  const [qi, setQi] = useState(0);
  useEffect(() => { const t = setInterval(() => setQi((i) => (i + 1) % QUOTES.length), 6000); return () => clearInterval(t); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!u.trim()) next.u = "Enter your username.";
    if (!p) next.p = "Enter your password.";
    setErr(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const r = await api.post("/login", { username: u.trim(), password: p });
      setToken(r.token);
      onDone();
    } catch (x) { setErr({ form: x.status === 401 ? "That username and password don't match. Please try again." : x.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-split">
      <section className="login-form">
        <div className="login-brand"><span className="brand-mark">∞</span><span>∞ Eye</span><span className="login-by">by Neurosaur</span></div>
        <div className="login-card">
          <h1>Welcome back</h1>
          <p className="muted" style={{ marginTop: 0 }}>Sign in to your recruiting workspace.</p>
          <form onSubmit={submit} noValidate>
            <label className="field">Username
              <input className={`input ${err.u ? "invalid" : ""}`} value={u} onChange={(e) => { setU(e.target.value); setErr({}); }} autoComplete="username" autoFocus />
              {err.u && <span className="field-error">{err.u}</span>}
            </label>
            <label className="field" style={{ marginTop: 14 }}>Password
              <span className="pw-wrap">
                <input className={`input ${err.p ? "invalid" : ""}`} type={show ? "text" : "password"} value={p} onChange={(e) => { setP(e.target.value); setErr({}); }} autoComplete="current-password" />
                <button type="button" className="icon-btn pw-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </span>
              {err.p && <span className="field-error">{err.p}</span>}
            </label>
            {err.form && <div className="notice bad" style={{ marginTop: 14 }}>{err.form}</div>}
            <button className="btn primary login-submit" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" />Signing in…</> : "Sign in"}</button>
          </form>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 18 }}><ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Your workspace, candidates and conversations are private to your login.</p>
        </div>
      </section>
      <aside className="login-side">
        <div className="login-side-inner">
          <div className="login-kicker"><Sparkles size={16} />AI-assisted recruiting, human decisions</div>
          <h2>Find the right five, not the first fifty.</h2>
          <ul className="login-proof">
            {PROOF.map((x) => <li key={x.k}><Target size={16} /><div><b>{x.k}</b><div className="muted">{x.v}</div></div></li>)}
          </ul>
          <blockquote className="login-quote" key={qi}>
            <p>“{QUOTES[qi].q}”</p>
            <footer>{QUOTES[qi].who}</footer>
          </blockquote>
          <div className="login-dots">{QUOTES.map((_, i) => <button key={i} className={i === qi ? "on" : ""} onClick={() => setQi(i)} aria-label={`Quote ${i + 1}`} />)}</div>
        </div>
      </aside>
    </div>
  );
}
