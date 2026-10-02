import { useEffect, useState } from "react";
import { api } from "../api.js";

const KINDS = ["outreach", "interview", "selection", "rejection", "followup"];
const VARS = "{{first_name}} {{name}} {{role}} {{client_or_company}} {{location}} {{skills}} {{experience}} {{recruiter}} {{company}} {{response_link}} {{interview_date}} {{interview_mode}} {{interview_where}} {{interview_panel}} {{interview_instructions}}";

export default function Settings({ health }) {
  const [tpls, setTpls] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => api.get("/templates").then(setTpls).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const save = async () => { try { if (edit.id) await api.patch(`/templates/${edit.id}`, edit); else await api.post("/templates", edit); setEdit(null); setMsg("Template saved."); load(); } catch (e) { setMsg(e.message); } };
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">Templates, connected services and users. Scoring weights are per mandate (Requirements tab) and learned per client.</p>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Connected services</h3>
        <table className="table"><tbody>
          <tr><td>AI assistant</td><td>{health?.llm ? `Connected (${health.llm_provider === "codecraft" ? "CodeCraft" : "Cloudflare"})` : "Not connected"}</td></tr>
          <tr><td>Email sending</td><td>{health?.email_provider ? "Connected (Resend)" : "Not connected: messages are approved here and sent from your own mailbox. Add the RESEND_API_KEY secret to send automatically."}</td></tr>
          <tr><td>WhatsApp sending</td><td>{health?.whatsapp_provider ? "Connected (Meta Cloud API)" : "Not connected: copy approved messages into WhatsApp. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_ID secrets to send automatically."}</td></tr>
          <tr><td>Public-profile discovery</td><td>{health?.search_api ? `Connected (${health.search_providers.join(", ")})` : "Not connected (SERPER_API_KEY or EXA_API_KEY)"}</td></tr>
          <tr><td>Reply links</td><td>{health?.public_url ? health.public_url + "/r/…" : "Set PUBLIC_URL in wrangler.toml to your app's address so reply links in messages work."}</td></tr>
        </tbody></table>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row"><h3 style={{ margin: 0 }}>Message templates</h3><span className="spacer" /><button className="btn small" onClick={() => setEdit({ kind: "outreach", channel: "email", name: "", subject: "", body: "" })}>New template</button></div>
        <p className="faint" style={{ fontSize: 12.5 }}>Placeholders: {VARS}</p>
        <table className="table"><thead><tr><th>Type</th><th>Channel</th><th>Name</th><th>Subject</th><th></th></tr></thead>
          <tbody>{tpls.map((t) => <tr key={t.id}><td>{t.kind}</td><td>{t.channel}</td><td>{t.name}{t.is_default ? <span className="faint"> (default)</span> : null}</td><td className="faint">{t.subject}</td>
            <td style={{ whiteSpace: "nowrap" }}><button className="btn small ghost" onClick={() => setEdit({ ...t })}>Edit</button>{!t.is_default && <button className="btn small ghost" onClick={async () => { await api.del(`/templates/${t.id}`); load(); }}>Delete</button>}</td></tr>)}</tbody></table>
        {edit && (
          <div className="spec-grid" style={{ marginTop: 14 }}>
            <label className="field">Type<select className="select" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field">Channel<select className="select" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}><option value="email">email</option><option value="whatsapp">whatsapp</option></select></label>
            <label className="field wide">Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            {edit.channel === "email" && <label className="field full">Subject<input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></label>}
            <label className="field full">Body<textarea className="input" rows={10} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
            <div className="full row"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Users</h3>
        <p className="muted" style={{ fontSize: 14 }}>Each user has a separate workspace. Users and passwords are set in the <code>APP_USERS</code> secret as <code>user:password,user:password</code>; redeploy is not needed after changing a secret.</p>
        <p className="faint" style={{ fontSize: 13, margin: 0 }}>Signed in as <b>{health?.username}</b>.</p>
      </div>
    </div>
  );
}
