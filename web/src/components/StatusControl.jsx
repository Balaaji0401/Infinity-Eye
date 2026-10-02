import { useState } from "react";
import { api } from "../api.js";

/** Grouped status dropdown with reason capture and submission-conflict handling. */
export default function StatusControl({ m, health, onChanged, compact = false }) {
  const groups = health?.status_groups || [["All", health?.statuses || [m.status]]];
  const reasonStatuses = health?.reason_statuses || [];
  const reasonCodes = health?.reason_codes || ["Other"];
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (override = false) => {
    setBusy(true); setErr("");
    try {
      const r = await api.patch(`/matches/${m.id}/status`, { status: pending, note, reason, override });
      setPending(null); setReason(""); setNote(""); setConflict(null); onChanged(r);
    } catch (e) {
      if (e.status === 409 && e.data?.conflict) setConflict({ message: e.message, ...e.data.conflict });
      else setErr(e.message);
    } finally { setBusy(false); }
  };
  const needsReason = pending && reasonStatuses.includes(pending);
  const onPick = (v) => { if (v === m.status) return setPending(null); setPending(v); setConflict(null); if (!reasonStatuses.includes(v) && v !== "Submitted") { /* quick path */ } };

  return (
    <div className={`status-ctl ${compact ? "compact" : ""}`} onClick={(e) => e.stopPropagation()}>
      <select className="status-select" value={pending || m.status} aria-label="Candidate status" onChange={(e) => onPick(e.target.value)}>
        {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map((s) => <option key={s}>{s}</option>)}</optgroup>)}
      </select>
      {pending && (
        <div className="status-popover">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Move to {pending}</div>
          {needsReason && <select className="select" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="">Reason…</option>{reasonCodes.map((r) => <option key={r}>{r}</option>)}</select>}
          <input className="input" placeholder={needsReason ? "Details (optional)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          {conflict && (
            <div className="notice bad" style={{ marginTop: 8, fontSize: 13 }}>
              {conflict.message}{conflict.prior?.length ? ` Earlier: ${conflict.prior.map((p) => `${p.code} (${String(p.at).slice(0, 10)})`).join(", ")}.` : ""}
              {conflict.rule !== "block" || true ? <div style={{ marginTop: 6 }}><button className="btn small" onClick={() => save(true)} disabled={busy}>Submit anyway (recorded as override)</button></div> : null}
            </div>
          )}
          {err && <div className="error" style={{ fontSize: 13, marginTop: 6 }}>{err}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary small" onClick={() => save(false)} disabled={busy || (needsReason && !reason && !note.trim())}>Save</button>
            <button className="btn small" onClick={() => { setPending(null); setConflict(null); setErr(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
