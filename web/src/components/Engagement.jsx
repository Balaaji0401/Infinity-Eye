import { useEffect, useState } from "react";
import { CalendarClock, Check, Copy, Mail, MessageCircle, Phone, RefreshCw, Send } from "lucide-react";
import { api } from "../api.js";

const fmt = (s) => (s ? new Date(String(s).replace(" ", "T") + "Z").toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—");
const toLocalInput = (s) => (s ? new Date(new Date(String(s).replace(" ", "T") + "Z").getTime() + 330 * 60000).toISOString().slice(0, 16) : "");
const fromLocalInput = (v) => (v ? new Date(new Date(v + ":00Z").getTime() - 330 * 60000).toISOString().slice(0, 19).replace("T", " ") : null);

export default function Engagement({ m, health, onChanged }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [paste, setPaste] = useState("");
  const [iv, setIv] = useState(null);
  const [fb, setFb] = useState({ result: "", reasons: [], original_text: "" });
  const [offer, setOffer] = useState(null);
  const [resp, setResp] = useState({ response: "", notice_days: "", ctc_expected_lpa: "" });
  const load = () => api.get(`/matches/${m.id}/engagement`).then((x) => { setD(x); setOffer(x.offer || { status: "discussion" }); }).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await load(); const r = await api.get(`/mandates/${m.mandate_id}/matches?kind=all`).catch(() => null); const u = r?.find((x) => x.id === m.id); if (u) onChanged(u); };

  const draft = async (channel, kind = "outreach") => { setMsg(""); try { const r = await api.post(`/mandates/${m.mandate_id}/outreach`, { match_ids: [m.id], channel, kind }); setMsg(r.drafts.length ? "Draft created. Review it below, then approve." : r.skipped.join("; ")); load(); } catch (e) { setMsg(e.message); } };
  const send = async (o) => { setMsg(""); try { const r = await api.post(`/outreach/${o.id}/send`, {}); setMsg(r.status === "failed" ? `Couldn't send: ${r.error}` : r.manual ? `Approved. No ${o.channel} provider is connected, so copy the message and send it yourself, then mark it sent.` : "Sent."); refresh(); } catch (e) { setMsg(e.message); } };
  const markSent = async (o) => { await api.patch(`/outreach/${o.id}`, { status: "sent" }); refresh(); };
  const copyMsg = (o) => { navigator.clipboard.writeText((o.subject ? o.subject + "\n\n" : "") + o.body); setMsg("Message copied."); };
  const recordResp = async () => { if (!resp.response) return; try { await api.post(`/matches/${m.id}/response`, { response: resp.response, detail: { notice_days: resp.notice_days, ctc_expected_lpa: resp.ctc_expected_lpa } }); setResp({ response: "", notice_days: "", ctc_expected_lpa: "" }); setMsg("Response recorded."); refresh(); } catch (e) { setMsg(e.message); } };

  const extract = async () => { setMsg("Reading the message…"); try { const r = await api.post("/interviews/extract", { text: paste }); setIv({ round: r.round || (d?.interviews?.length || 0) + 1, mode: r.mode || "online", scheduled_at: r.scheduled_at, location_or_link: r.location_or_link || "", panel: r.panel || "", instructions: r.instructions || "", documents: r.documents || "", confidence: r.confidence || {}, ambiguities: r.ambiguities || [], source_text: paste, via: r.via }); setMsg(r.ambiguities?.length ? "Please check the highlighted fields before saving." : "Details extracted. Review and save."); } catch (e) { setMsg(e.message); } };
  const saveIv = async () => { try { await api.post(`/matches/${m.id}/interviews`, iv); setIv(null); setPaste(""); setMsg("Interview saved. You can now send the candidate a confirmation."); refresh(); } catch (e) { setMsg(e.message); } };
  const ivStatus = async (x, status) => { await api.patch(`/interviews/${x.id}`, { status }); refresh(); };
  const notify = async (x, channel) => { try { await api.post(`/interviews/${x.id}/notify`, { channel }); setMsg("Confirmation message drafted below; approve to send."); load(); } catch (e) { setMsg(e.message); } };
  const saveFb = async () => { if (!fb.result) return; try { await api.post(`/matches/${m.id}/feedback`, { ...fb, interview_id: d?.interviews?.find((x) => x.status !== "completed")?.id || null }); setFb({ result: "", reasons: [], original_text: "" }); setMsg("Feedback recorded."); refresh(); } catch (e) { setMsg(e.message); } };
  const saveOffer = async () => { try { await api.post(`/matches/${m.id}/offer`, offer); setMsg("Offer updated."); refresh(); } catch (e) { setMsg(e.message); } };

  if (!d) return <p className="faint" style={{ fontSize: 13 }}>Loading engagement…</p>;
  const low = (k) => iv?.confidence?.[k] === "low";
  const reasons = health?.reason_codes || ["Other"];
  return (
    <div className="engage">
      {msg && <div className="notice" style={{ marginBottom: 10 }}>{msg}</div>}
      {m.opt_out && <div className="notice bad" style={{ marginBottom: 10 }}>This candidate asked not to be contacted. Outreach is disabled.</div>}

      <h3>Outreach</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn small" disabled={m.opt_out || !m.email} onClick={() => draft("email")} title={m.email ? "" : "No email on file"}><Mail size={14} />Draft email</button>
        <button className="btn small" disabled={m.opt_out || !m.phone} onClick={() => draft("whatsapp")} title={m.phone ? "" : "No phone on file"}><MessageCircle size={14} />Draft WhatsApp</button>
        <span className="faint" style={{ fontSize: 12.5 }}>Drafts wait for your approval. {health?.email_provider ? "Email sends automatically." : "Email: copy and send from your mailbox."} {health?.whatsapp_provider ? "WhatsApp sends automatically." : "WhatsApp: copy and send from your phone."}</span>
      </div>
      {d.outreach.length === 0 && <p className="faint" style={{ fontSize: 13 }}>No messages yet.</p>}
      {d.outreach.map((o) => (
        <details key={o.id} className="msg" open={o.status === "draft" || o.status === "approved"}>
          <summary><span className={`tag st-${o.status}`}>{o.status}</span> {o.channel} · {o.kind}{o.subject ? ` · ${o.subject}` : ""} <span className="faint">{fmt(o.sent_at || o.created_at)}</span>
            {o.response && <span className="tag" style={{ color: "var(--band-a)" }}>Replied: {o.response}</span>}</summary>
          <pre className="msg-body">{o.body}</pre>
          {o.response_detail && Object.keys(o.response_detail).length > 0 && <div className="faint" style={{ fontSize: 13 }}>Candidate shared: {Object.entries(o.response_detail).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            {["draft", "failed"].includes(o.status) && <button className="btn primary small" onClick={() => send(o)}><Send size={14} />Approve & send</button>}
            {o.status === "approved" && <><button className="btn small" onClick={() => copyMsg(o)}><Copy size={14} />Copy message</button><button className="btn primary small" onClick={() => markSent(o)}><Check size={14} />Mark as sent</button></>}
            {o.status === "draft" && <button className="btn small ghost" onClick={async () => { await api.del(`/outreach/${o.id}`); load(); }}>Discard</button>}
            {o.status !== "draft" && <button className="btn small ghost" onClick={() => copyMsg(o)}><Copy size={14} />Copy</button>}
            {o.token && o.status !== "draft" && <span className="faint" style={{ fontSize: 12 }}>Reply link: {(health?.public_url || window.location.origin) + "/r/" + o.token.slice(0, 6)}…</span>}
          </div>
        </details>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <Phone size={14} className="muted" /><span className="muted" style={{ fontSize: 13 }}>Heard back by phone?</span>
        <select className="select" style={{ width: 170 }} value={resp.response} onChange={(e) => setResp({ ...resp, response: e.target.value })}><option value="">Record a reply…</option>{(health?.responses || []).map((r) => <option key={r}>{r}</option>)}</select>
        {resp.response === "Interested" && <><input className="input" style={{ width: 120 }} placeholder="Notice (days)" value={resp.notice_days} onChange={(e) => setResp({ ...resp, notice_days: e.target.value })} /><input className="input" style={{ width: 130 }} placeholder="Expected LPA" value={resp.ctc_expected_lpa} onChange={(e) => setResp({ ...resp, ctc_expected_lpa: e.target.value })} /></>}
        {resp.response && <button className="btn small primary" onClick={recordResp}>Save</button>}
      </div>

      <h3 style={{ marginTop: 20 }}>Interviews</h3>
      {d.interviews.map((x) => (
        <div key={x.id} className="iv-row">
          <CalendarClock size={16} className="muted" />
          <div style={{ flex: 1 }}>
            <b>Round {x.round}</b> · {x.mode} · {fmt(x.scheduled_at)}{x.location_or_link ? ` · ${x.location_or_link}` : ""}{x.panel ? ` · Panel: ${x.panel}` : ""}
            <div className="faint" style={{ fontSize: 12.5 }}>Status: {x.status.replace("_", " ")}{x.instructions ? ` · ${x.instructions}` : ""}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {["proposed", "scheduled", "rescheduled"].includes(x.status) && <><button className="btn small" onClick={() => notify(x, "email")}><Mail size={13} />Confirm by email</button><button className="btn small" onClick={() => notify(x, "whatsapp")}><MessageCircle size={13} />WhatsApp</button></>}
            {["scheduled", "confirmed", "rescheduled"].includes(x.status) && <><button className="btn small ghost" onClick={() => ivStatus(x, "completed")}>Completed</button><button className="btn small ghost" onClick={() => ivStatus(x, "no_show")}>No-show</button><button className="btn small ghost" onClick={() => ivStatus(x, "cancelled")}>Cancel</button></>}
          </div>
        </div>
      ))}
      {!iv && (
        <div className="row" style={{ alignItems: "stretch" }}>
          <textarea className="input" rows={3} style={{ flex: 1 }} placeholder="Paste the client's interview email or message here and I'll pull out the date, mode, link or venue, panel and instructions for you to check." value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div style={{ display: "grid", gap: 6 }}><button className="btn primary small" disabled={paste.trim().length < 10} onClick={extract}><RefreshCw size={14} />Read details</button>
            <button className="btn small ghost" onClick={() => setIv({ round: (d.interviews.length || 0) + 1, mode: "online", scheduled_at: null, location_or_link: "", panel: "", instructions: "", confidence: {}, ambiguities: [] })}>Enter manually</button></div>
        </div>
      )}
      {iv && (
        <div className="card" style={{ background: "var(--base)", marginTop: 8 }}>
          {iv.ambiguities?.length > 0 && <div className="notice bad" style={{ marginBottom: 10 }}><b>Please check:</b> {iv.ambiguities.join(" ")}</div>}
          <div className="spec-grid">
            <label className="field">Round<input className="input" type="number" min="1" value={iv.round} onChange={(e) => setIv({ ...iv, round: +e.target.value })} /></label>
            <label className="field">Mode<select className={`select ${low("mode") ? "invalid" : ""}`} value={iv.mode} onChange={(e) => setIv({ ...iv, mode: e.target.value })}><option value="online">Online</option><option value="in-person">In person</option><option value="phone">Phone</option></select></label>
            <label className="field wide">Date & time (IST){low("date") || low("time") ? <span className="field-error"> needs confirmation</span> : null}<input className={`input ${low("date") || low("time") ? "invalid" : ""}`} type="datetime-local" value={toLocalInput(iv.scheduled_at)} onChange={(e) => setIv({ ...iv, scheduled_at: fromLocalInput(e.target.value) })} /></label>
            <label className="field full">{iv.mode === "in-person" ? "Venue / address" : "Meeting link / phone"}<input className={`input ${low("location_or_link") ? "invalid" : ""}`} value={iv.location_or_link} onChange={(e) => setIv({ ...iv, location_or_link: e.target.value })} /></label>
            <label className="field wide">Panel<input className="input" value={iv.panel} onChange={(e) => setIv({ ...iv, panel: e.target.value })} /></label>
            <label className="field wide">Instructions / documents<input className="input" value={iv.instructions} onChange={(e) => setIv({ ...iv, instructions: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary small" onClick={saveIv}>Save interview</button><button className="btn small" onClick={() => setIv(null)}>Cancel</button><span className="faint" style={{ fontSize: 12.5 }}>Nothing is sent to the candidate until you approve the confirmation message.</span></div>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Client feedback</h3>
      {d.feedback.map((f) => <div key={f.id} className="fb-row"><b>{f.result}</b>{f.reasons?.length ? ` · ${f.reasons.join(", ")}` : ""} <span className="faint">{fmt(f.created_at)} by {f.recorded_by}</span>{f.original_text && <div className="faint" style={{ fontSize: 13, fontStyle: "italic" }}>“{f.original_text}”</div>}</div>)}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <select className="select" style={{ width: 170 }} value={fb.result} onChange={(e) => setFb({ ...fb, result: e.target.value })}><option value="">Result…</option>{["Selected", "Further Round", "Hold", "Rejected", "Offer Discussion", "Candidate Withdrew"].map((r) => <option key={r}>{r}</option>)}</select>
        {["Rejected", "Hold"].includes(fb.result) && <select className="select" style={{ width: 170 }} value={fb.reasons[0] || ""} onChange={(e) => setFb({ ...fb, reasons: e.target.value ? [e.target.value] : [] })}><option value="">Reason…</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>}
        <input className="input" style={{ flex: 1 }} placeholder="Client's own words (kept as given)" value={fb.original_text} onChange={(e) => setFb({ ...fb, original_text: e.target.value })} />
        <button className="btn small primary" disabled={!fb.result || (["Rejected", "Hold"].includes(fb.result) && !fb.reasons.length)} onClick={saveFb}>Record</button>
      </div>

      {(["Selected", "Offer Discussion", "Offer Released", "Offer Accepted", "Joining Pending", "Joined", "Offer Declined"].includes(m.status) || d.offer) && (
        <>
          <h3 style={{ marginTop: 20 }}>Offer & joining</h3>
          <div className="spec-grid">
            <label className="field">Offered CTC (LPA)<input className="input" type="number" step="0.1" value={offer?.ctc_offered_lpa ?? ""} onChange={(e) => setOffer({ ...offer, ctc_offered_lpa: e.target.value === "" ? null : +e.target.value })} /></label>
            <label className="field">Designation<input className="input" value={offer?.designation || ""} onChange={(e) => setOffer({ ...offer, designation: e.target.value })} /></label>
            <label className="field">Offer date<input className="input" type="date" value={offer?.offer_date || ""} onChange={(e) => setOffer({ ...offer, offer_date: e.target.value })} /></label>
            <label className="field">Joining date<input className="input" type="date" value={offer?.joining_date || ""} onChange={(e) => setOffer({ ...offer, joining_date: e.target.value })} /></label>
            <label className="field wide">Stage<select className="select" value={offer?.status || "discussion"} onChange={(e) => setOffer({ ...offer, status: e.target.value })}>
              {[["discussion", "Offer discussion"], ["released", "Offer released"], ["accepted", "Offer accepted"], ["declined", "Offer declined"], ["joined", "Joined"], ["no_show", "No-show on joining"], ["withdrawn", "Candidate withdrew"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field wide">Notes<input className="input" value={offer?.notes || ""} onChange={(e) => setOffer({ ...offer, notes: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn small primary" onClick={saveOffer}>Save offer</button><span className="faint" style={{ fontSize: 12.5 }}>Selected is not Joined: follow-up tasks are created for acceptance and joining day.</span></div>
        </>
      )}
      {d.tasks.length > 0 && <><h3 style={{ marginTop: 20 }}>Open tasks</h3><ul className="list">{d.tasks.map((t) => <li key={t.id}>{t.title} <span className="faint">due {fmt(t.due_at)}</span></li>)}</ul></>}
    </div>
  );
}
