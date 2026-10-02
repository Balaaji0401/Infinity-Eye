import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import ChipInput from "../components/ChipInput.jsx";

export default function Clients() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => api.get("/clients").then(setList).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { await api.patch(`/clients/${edit.id}`, edit); setMsg(`${edit.name} saved.`); setEdit(null); load(); } catch (e) { setMsg(e.message); }
  };
  if (!list) return <div className="page muted">Loading…</div>;
  return (
    <div className="page">
      <h1>Clients</h1>
      <p className="muted">One record per client: what they've told you they want (approved preferences), what the data shows (observed), and the rules for resubmitting candidates.</p>
      {msg && <div className="notice" style={{ marginBottom: 12 }}>{msg}</div>}
      {list.length === 0 && <div className="card muted">Clients appear here automatically when you create a mandate with a client name.</div>}
      <div style={{ display: "grid", gap: 14 }}>
        {list.map((c) => (
          <div className="card" key={c.id}>
            <div className="row">
              <h3 style={{ margin: 0 }}>{c.name}</h3>
              <span className="tag">{c.mandates.length} mandate{c.mandates.length === 1 ? "" : "s"}</span>
              <span className="tag">{c.submissions} submission{c.submissions === 1 ? "" : "s"}</span>
              <span className="tag">{c.ownership_rule === "block" ? "Resubmission blocked" : c.ownership_rule === "allow" ? "Resubmission allowed" : "Resubmission warns"} · {c.resubmission_days} days</span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setEdit(edit?.id === c.id ? null : { ...c })}>{edit?.id === c.id ? "Close" : "Edit"}</button>
            </div>
            <div className="two" style={{ marginTop: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Approved preferences (from the client)</div>
                {c.preferences?.length ? <ul className="list" style={{ marginTop: 6 }}>{c.preferences.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="faint" style={{ fontSize: 13 }}>None recorded. Add what the client has explicitly asked for.</p>}
                {c.notes && <p style={{ fontSize: 14 }}>{c.notes}</p>}
              </div>
              <div>
                <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Observed from your decisions</div>
                {c.observed_rules?.length ? <ul className="list" style={{ marginTop: 6 }}>{c.observed_rules.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
                {c.observed_weights ? <p className="faint" style={{ fontSize: 13 }}>Learned weights from {c.observed_examples?.positive} shortlists and {c.observed_examples?.negative} rejections are applied to new mandates for this client.</p>
                  : <p className="faint" style={{ fontSize: 13 }}>Not enough shortlist/reject decisions yet to learn this client's pattern.</p>}
              </div>
            </div>
            {c.mandates.length > 0 && <div className="row" style={{ marginTop: 10, gap: 6 }}>{c.mandates.map((m) => <Link key={m.id} to={`/mandates/${m.id}/scout`} className="chip" style={{ textDecoration: "none" }}>{m.code} {m.title}{m.status === "closed" ? " (closed)" : ""}</Link>)}</div>}
            {edit?.id === c.id && (
              <div className="spec-grid" style={{ marginTop: 16 }}>
                <label className="field wide">Client name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label className="field wide">Industry<input className="input" value={edit.industry || ""} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} /></label>
                <label className="field wide">Locations<ChipInput values={edit.locations || []} onChange={(v) => setEdit({ ...edit, locations: v })} placeholder="e.g. Chennai" /></label>
                <label className="field">Resubmission rule<select className="select" value={edit.ownership_rule} onChange={(e) => setEdit({ ...edit, ownership_rule: e.target.value })}>
                  <option value="warn">Warn and allow override</option><option value="block">Block (override recorded)</option><option value="allow">Allow silently</option></select></label>
                <label className="field">Within (days)<input className="input" type="number" min="0" value={edit.resubmission_days} onChange={(e) => setEdit({ ...edit, resubmission_days: +e.target.value })} /></label>
                <label className="field full">Approved preferences (one per chip)<ChipInput values={edit.preferences || []} onChange={(v) => setEdit({ ...edit, preferences: v })} placeholder="e.g. Only candidates from auto-components, no job hoppers" /></label>
                <label className="field full">Notes<textarea className="input" rows={3} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
                <div className="full row"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
