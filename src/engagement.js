// Phase C + D: candidate outreach with approval, response capture, interview events, feedback, offers, tasks.
import { AIError, chatJson } from "./ai.js";
import { all, audit, get, insert, one, stageIndex, update } from "./db.js";

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const plusDays = (d, days) => new Date(new Date(d.replace(" ", "T") + "Z").getTime() + days * 864e5).toISOString().slice(0, 19).replace("T", " ");

// ------------------------------------------------------------------ templates
export const DEFAULT_TEMPLATES = [
  { kind: "outreach", channel: "email", name: "First contact (email)", subject: "{{role}} opportunity with {{client_or_company}} in {{location}}",
    body: `Hi {{first_name}},

I'm {{recruiter}} and I'm hiring a {{role}} for {{client_or_company}} in {{location}}. Your background in {{skills}} looks like a strong fit.

A few details:
• Role: {{role}}
• Location: {{location}}
• Experience: {{experience}}

Could you tell me if you're open to a conversation? Reply using the link below, it takes 10 seconds:
{{response_link}}

Thanks,
{{recruiter}}
{{company}}

If you'd prefer not to hear from us, use the "Please don't contact me" option on the link.` },
  { kind: "outreach", channel: "whatsapp", name: "First contact (WhatsApp)", subject: "",
    body: `Hi {{first_name}}, this is {{recruiter}} from {{company}}. I'm hiring a {{role}} in {{location}} and your experience in {{skills}} looks relevant. Are you open to a quick chat? Reply here: {{response_link}}` },
  { kind: "interview", channel: "email", name: "Interview confirmation", subject: "Interview: {{role}} with {{client_or_company}} on {{interview_date}}",
    body: `Hi {{first_name}},

Your interview for the {{role}} role with {{client_or_company}} is scheduled:

• Date and time: {{interview_date}}
• Mode: {{interview_mode}}
• {{interview_where_label}}: {{interview_where}}
• Panel: {{interview_panel}}
{{interview_instructions}}

Please reply to confirm you can attend: {{response_link}}

Best regards,
{{recruiter}}
{{company}}` },
  { kind: "selection", channel: "email", name: "Selection", subject: "Good news on your {{role}} application",
    body: `Hi {{first_name}},

Congratulations, {{client_or_company}} would like to move forward with you for the {{role}} role. I'll call you shortly to discuss the offer details and next steps.

Best regards,
{{recruiter}}
{{company}}` },
  { kind: "rejection", channel: "email", name: "Not selected", subject: "Update on your {{role}} application",
    body: `Hi {{first_name}},

Thank you for your time in the process for the {{role}} role with {{client_or_company}}. They have decided to proceed with other candidates at this stage.

I'd like to keep your profile for suitable roles in future, and I'll reach out when something fits. Thank you again for your interest.

Best regards,
{{recruiter}}
{{company}}` },
  { kind: "followup", channel: "whatsapp", name: "Follow-up (WhatsApp)", subject: "", body: `Hi {{first_name}}, just following up on the {{role}} role in {{location}}. Happy to share more details if useful: {{response_link}} — {{recruiter}}` },
];

export async function ensureTemplates(env, owner) {
  const have = await all(env.DB, "templates", "SELECT kind, channel FROM templates WHERE owner = ?", owner);
  for (const t of DEFAULT_TEMPLATES) if (!have.some((h) => h.kind === t.kind && h.channel === t.channel)) await insert(env.DB, "templates", { owner, ...t, is_default: 1 });
  return all(env.DB, "templates", "SELECT * FROM templates WHERE owner = ? ORDER BY kind, channel, id", owner);
}

export function renderTemplate(tpl, vars) {
  const fill = (s) => (s || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? "")).replace(/\n{3,}/g, "\n\n");
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}

export function templateVars(env, mandate, cand, extra = {}) {
  const spec = mandate.spec || {};
  return {
    first_name: (cand.name || "there").split(/\s+/)[0], name: cand.name || "", role: mandate.title, client_or_company: mandate.client_name || "our client",
    location: (spec.locations || [])[0] || cand.location || "", skills: (cand.top_skills || []).slice(0, 3).join(", ") || "your field",
    experience: spec.min_exp != null ? `${spec.min_exp}${spec.max_exp != null ? `–${spec.max_exp}` : "+"} years` : "as per the role",
    recruiter: env.RECRUITER_NAME || "the recruiting team", company: env.COMPANY_NAME || "Neurosaur", ...extra,
  };
}

// ------------------------------------------------------------------ outreach
const randomToken = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };

/** Create a draft for approval. kind: outreach | interview | selection | rejection | followup. */
export async function draftOutreach(env, owner, mandate, match, cand, { channel = "email", kind = "outreach", template_id = null, extra = {}, interview = null } = {}) {
  if (cand.opt_out) throw new Error(`${cand.name} asked not to be contacted.`);
  const tpls = await ensureTemplates(env, owner);
  const tpl = template_id ? tpls.find((t) => t.id === +template_id) : tpls.find((t) => t.kind === kind && t.channel === channel) || tpls.find((t) => t.kind === kind);
  if (!tpl) throw new Error("No template for this message.");
  const token = randomToken();
  const base = env.PUBLIC_URL || "";
  const vars = templateVars(env, mandate, cand, { response_link: `${base}/r/${token}`, ...interviewVars(interview), ...extra });
  const { subject, body } = renderTemplate(tpl, vars);
  const to = channel === "email" ? cand.email || "" : cand.phone || "";
  return insert(env.DB, "outreach", { owner, mandate_id: mandate.id, match_id: match.id, candidate_id: cand.id, channel, kind, template_id: tpl.id, to_address: to, subject, body, token, status: "draft" });
}

function interviewVars(iv) {
  if (!iv) return {};
  const dt = iv.scheduled_at ? new Date(iv.scheduled_at.replace(" ", "T") + "Z") : null;
  return {
    interview_date: dt ? dt.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" : "to be confirmed",
    interview_mode: iv.mode === "in-person" ? "In person" : iv.mode === "phone" ? "Phone" : "Online",
    interview_where_label: iv.mode === "in-person" ? "Venue" : "Link / number", interview_where: iv.location_or_link || "to be shared",
    interview_panel: iv.panel || "to be shared", interview_instructions: iv.instructions ? `• Instructions: ${iv.instructions}` : "",
  };
}

/** Approve and send (or hand off for manual sending when no provider is configured). */
export async function sendOutreach(env, owner, o, user) {
  if (!o.to_address) return finish(env, o, "failed", "", `No ${o.channel === "email" ? "email address" : "phone number"} on file`);
  const cand = await get(env.DB, "candidates", o.candidate_id);
  if (cand?.opt_out) return finish(env, o, "failed", "", "Candidate opted out");
  let providerId = "", status = "sent", error = "";
  try {
    if (o.channel === "email") {
      if (!env.RESEND_API_KEY) { status = "approved"; error = "manual"; }      // no provider: recruiter sends from their own mail, we track it
      else {
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env.MAIL_FROM || "recruiting@neurosaur.in", to: [o.to_address], subject: o.subject, text: o.body, reply_to: env.MAIL_REPLY_TO || undefined }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message || `Email provider returned ${r.status}`);
        providerId = d.id || "";
      }
    } else {
      if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) { status = "approved"; error = "manual"; }
      else {
        const to = o.to_address.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1");
        const r = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: o.body } }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message || `WhatsApp returned ${r.status}`);
        providerId = d.messages?.[0]?.id || "";
      }
    }
  } catch (e) { status = "failed"; error = String(e.message || e).slice(0, 300); }
  const rec = await finish(env, o, status, providerId, error, user);
  if (status === "sent" || error === "manual") {
    const m = await get(env.DB, "matches", o.match_id);
    if (m && o.kind === "outreach" && stageIndex(m.status) < stageIndex("Contacted")) {
      await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: "Contacted", band_at_time: m.band, note: `${o.channel} outreach`, actor: user });
      await update(env.DB, "matches", m.id, { status: "Contacted" });
      await addTask(env, owner, m.mandate_id, m.id, `Follow up with ${cand?.name || "candidate"} (no reply yet)`, "followup", plusDays(now(), 2));
    }
  }
  return rec;
}
async function finish(env, o, status, providerId, error, user = "") {
  const patch = { status, provider_id: providerId, error: error === "manual" ? "" : error, approved_by: user || o.approved_by, sent_at: status === "sent" || error === "manual" ? now() : null };
  await update(env.DB, "outreach", o.id, patch);
  await audit(env.DB, status === "failed" ? "outreach_failed" : "outreach_sent", "outreach", o.id, { channel: o.channel, kind: o.kind, manual: error === "manual", error: patch.error });
  return { ...o, ...patch, manual: error === "manual" };
}

export const RESPONSES = ["Interested", "Not interested", "Call me", "Need details", "Later", "Do not contact"];

/** Candidate clicked the link (public, token-authenticated). */
export async function recordResponse(env, token, response, detail = {}) {
  const o = await one(env.DB, "outreach", "SELECT * FROM outreach WHERE token = ?", token);
  if (!o) return null;
  if (!RESPONSES.includes(response)) throw new Error("Unknown response");
  const clean = {};
  for (const k of ["ctc_current_lpa", "ctc_expected_lpa", "notice_days", "preferred_location", "phone", "email", "message", "available_at"]) if (detail[k] !== undefined && detail[k] !== "") clean[k] = String(detail[k]).slice(0, 200);
  await update(env.DB, "outreach", o.id, { status: "responded", response, response_detail: clean, responded_at: now() });
  const m = await get(env.DB, "matches", o.match_id), cand = await get(env.DB, "candidates", o.candidate_id);
  const map = { Interested: "Interested", "Not interested": "Not Interested" };
  if (response === "Do not contact") { await update(env.DB, "candidates", cand.id, { opt_out: 1 }); }
  // candidate-supplied facts update the record (recruiter-verified later)
  const cpatch = {};
  for (const k of ["ctc_current_lpa", "ctc_expected_lpa", "notice_days"]) if (clean[k] && !isNaN(+clean[k])) cpatch[k] = +clean[k];
  if (clean.preferred_location) cpatch.preferred_location = clean.preferred_location;
  if (clean.phone && !cand.phone) cpatch.phone = clean.phone.replace(/\D/g, "");
  if (clean.email && !cand.email) cpatch.email = clean.email.toLowerCase();
  if (Object.keys(cpatch).length) await update(env.DB, "candidates", cand.id, { ...cpatch, last_verified_at: now() });
  if (o.kind === "interview" && response === "Interested") {
    const iv = await one(env.DB, "interviews", "SELECT * FROM interviews WHERE match_id = ? AND status IN ('scheduled','rescheduled','proposed') ORDER BY id DESC LIMIT 1", m.id);
    if (iv) await update(env.DB, "interviews", iv.id, { status: "confirmed" });
  } else if (map[response] && m && stageIndex(m.status) <= stageIndex("Contacted")) {
    await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: map[response], band_at_time: m.band, note: "Candidate replied via link", actor: "candidate" });
    await update(env.DB, "matches", m.id, { status: map[response] });
  }
  if (["Call me", "Need details", "Interested"].includes(response)) await addTask(env, o.owner, o.mandate_id, o.match_id, `${cand.name}: ${response}${clean.message ? ` — "${clean.message.slice(0, 60)}"` : ""}`, "respond", now());
  if (response === "Later") await addTask(env, o.owner, o.mandate_id, o.match_id, `Re-contact ${cand.name} (asked to be contacted later)`, "followup", plusDays(now(), 14));
  await env.DB.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE match_id = ? AND kind = 'followup' AND done = 0").bind(o.match_id).run();
  await audit(env.DB, "candidate_responded", "outreach", o.id, { response });
  return { ok: true, response };
}

// ------------------------------------------------------------------ interviews
const IV_SYSTEM = `You extract an interview schedule from a client's email or message. Return ONLY JSON:
{"candidate_name": str|null, "round": int|null, "mode": "online"|"in-person"|"phone"|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM" 24h|null, "timezone": str|null,
 "duration_min": int|null, "location_or_link": str|null, "panel": str|null, "instructions": str|null, "documents": str|null,
 "confidence": {"date": "high"|"low", "time": "high"|"low", "mode": "high"|"low", "location_or_link": "high"|"low"},
 "ambiguities": [short strings describing anything unclear or conflicting]}
Today's date is {{today}}. Resolve relative dates ("next Tuesday") from it. Never invent a link or address. If two dates are mentioned, mark date confidence low and list the conflict.`;

export async function extractInterview(env, text) {
  try {
    const out = await chatJson(env, IV_SYSTEM.replace("{{today}}", new Date().toISOString().slice(0, 10)), "Message:\n\"\"\"" + text.slice(0, 6000) + "\"\"\"", 600);
    const when = out.date ? `${out.date} ${out.time || "09:00"}:00` : null;
    return { ...out, scheduled_at: when ? toUtc(when, out.timezone) : null, via: "ai" };
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    const d = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/), t = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const link = text.match(/https?:\/\/\S+/)?.[0] || null;
    let date = null;
    if (d) { let y = +d[3]; if (y < 100) y += 2000; date = `${y}-${String(d[2]).padStart(2, "0")}-${String(d[1]).padStart(2, "0")}`; }
    let time = null;
    if (t) { let h = +t[1] % 12; if (t[3].toLowerCase() === "pm") h += 12; time = `${String(h).padStart(2, "0")}:${t[2] || "00"}`; }
    return { date, time, mode: link ? "online" : /office|venue|address|floor|plant/i.test(text) ? "in-person" : null, location_or_link: link, panel: null, instructions: null,
      confidence: { date: date ? "low" : "low", time: time ? "low" : "low", mode: "low", location_or_link: link ? "high" : "low" },
      ambiguities: ["The assistant was unavailable; details were read with basic rules. Please verify every field."], scheduled_at: date ? toUtc(`${date} ${time || "09:00"}:00`, "Asia/Kolkata") : null, via: "rules" };
  }
}
/** Interpret a local time (default IST) as UTC for storage. */
function toUtc(local, tz) {
  const offset = !tz || /ist|india|kolkata|\+05:?30/i.test(tz) ? 330 : 0;
  const d = new Date(local.replace(" ", "T") + "Z");
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 19).replace("T", " ");
}

export async function createInterview(env, owner, mandate, match, data, user) {
  const iv = await insert(env.DB, "interviews", { owner, mandate_id: mandate.id, match_id: match.id, round: +data.round || 1, mode: data.mode || "online", scheduled_at: data.scheduled_at || null,
    duration_min: data.duration_min || null, location_or_link: data.location_or_link || "", panel: data.panel || "", instructions: data.instructions || "", documents: data.documents || "",
    status: data.scheduled_at ? "scheduled" : "proposed", source_text: data.source_text || "", confidence: data.confidence || {}, created_by: user });
  if (stageIndex(match.status) < stageIndex("Interview Scheduled") && iv.scheduled_at) {
    await insert(env.DB, "status_events", { match_id: match.id, from_status: match.status, to_status: "Interview Scheduled", band_at_time: match.band, note: `Round ${iv.round}`, actor: user });
    await update(env.DB, "matches", match.id, { status: "Interview Scheduled" });
  }
  if (iv.scheduled_at) {
    const cand = await get(env.DB, "candidates", match.candidate_id);
    await addTask(env, owner, mandate.id, match.id, `Confirm ${cand?.name || "candidate"} is attending round ${iv.round}`, "interview", plusDays(iv.scheduled_at, -1));
    await addTask(env, owner, mandate.id, match.id, `Collect feedback for ${cand?.name || "candidate"} (round ${iv.round})`, "feedback", plusDays(iv.scheduled_at, 1));
  }
  await audit(env.DB, "interview_created", "interview", iv.id, { user, via: data.via || "manual" });
  return iv;
}

export async function updateInterview(env, iv, patch, user) {
  const allowed = {};
  for (const k of ["round", "mode", "scheduled_at", "duration_min", "location_or_link", "panel", "instructions", "documents", "status"]) if (patch[k] !== undefined) allowed[k] = patch[k];
  if (patch.scheduled_at && patch.scheduled_at !== iv.scheduled_at && iv.status !== "proposed") allowed.status = "rescheduled";
  await update(env.DB, "interviews", iv.id, allowed);
  const m = await get(env.DB, "matches", iv.match_id);
  if (allowed.status === "completed" && m && stageIndex(m.status) < stageIndex("Interview Completed")) {
    await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: "Interview Completed", band_at_time: m.band, note: `Round ${iv.round}`, actor: user });
    await update(env.DB, "matches", m.id, { status: "Interview Completed" });
  }
  if (allowed.status === "no_show" && m) {
    await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: "No-show", band_at_time: m.band, note: `Round ${iv.round}`, actor: user });
    await update(env.DB, "matches", m.id, { status: "No-show" });
  }
  await audit(env.DB, "interview_updated", "interview", iv.id, { fields: Object.keys(allowed), user });
  return { ...iv, ...allowed };
}

// ------------------------------------------------------------------ feedback & offers
const RESULT_STATUS = { Selected: "Selected", Rejected: "Rejected", Hold: "Hold", "Further Round": "Further Round", "Offer Discussion": "Offer Discussion", "Candidate Withdrew": "Candidate Withdrew" };

export async function recordFeedback(env, owner, mandate, match, { interview_id = null, result, reasons = [], original_text = "" }, user) {
  if (!RESULT_STATUS[result]) throw new Error("Unknown result");
  const fb = await insert(env.DB, "feedback", { owner, mandate_id: mandate.id, match_id: match.id, interview_id, result, reasons, original_text, recorded_by: user });
  if (interview_id) await update(env.DB, "interviews", interview_id, { status: "completed" });
  if (match.status !== RESULT_STATUS[result]) {
    await insert(env.DB, "status_events", { match_id: match.id, from_status: match.status, to_status: RESULT_STATUS[result], band_at_time: match.band, note: original_text.slice(0, 200), reason: reasons[0] || "", actor: user });
    await update(env.DB, "matches", match.id, { status: RESULT_STATUS[result] });
  }
  if (result === "Further Round") await addTask(env, owner, mandate.id, match.id, "Schedule next interview round", "interview", now());
  if (result === "Selected") await addTask(env, owner, mandate.id, match.id, "Start offer discussion", "offer", now());
  await env.DB.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE match_id = ? AND kind = 'feedback' AND done = 0").bind(match.id).run();
  await audit(env.DB, "feedback_recorded", "feedback", fb.id, { result, reasons, user });
  return fb;
}

const OFFER_STATUS = { discussion: "Offer Discussion", released: "Offer Released", accepted: "Offer Accepted", declined: "Offer Declined", joined: "Joined", no_show: "No-show", withdrawn: "Candidate Withdrew" };

export async function upsertOffer(env, owner, mandate, match, data, user) {
  let offer = await one(env.DB, "offers", "SELECT * FROM offers WHERE match_id = ? ORDER BY id DESC LIMIT 1", match.id);
  const patch = {};
  for (const k of ["ctc_offered_lpa", "designation", "offer_date", "joining_date", "status", "notes"]) if (data[k] !== undefined) patch[k] = data[k];
  if (!offer) offer = await insert(env.DB, "offers", { owner, mandate_id: mandate.id, match_id: match.id, created_by: user, status: "discussion", ...patch });
  else { await update(env.DB, "offers", offer.id, patch); offer = { ...offer, ...patch }; }
  const target = OFFER_STATUS[offer.status];
  if (target && match.status !== target) {
    await insert(env.DB, "status_events", { match_id: match.id, from_status: match.status, to_status: target, band_at_time: match.band, note: offer.ctc_offered_lpa ? `Offer ₹${offer.ctc_offered_lpa}L` : "", reason: data.reason || "", actor: user });
    await update(env.DB, "matches", match.id, { status: target });
  }
  await env.DB.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE match_id = ? AND kind = 'offer' AND done = 0").bind(match.id).run();
  const cand = await get(env.DB, "candidates", match.candidate_id);
  if (offer.status === "released") await addTask(env, owner, mandate.id, match.id, `Get offer acceptance from ${cand?.name}`, "offer", plusDays(now(), 3));
  if (offer.status === "accepted" && offer.joining_date) {
    await addTask(env, owner, mandate.id, match.id, `Check in with ${cand?.name} before joining`, "joining", plusDays(offer.joining_date + " 09:00:00", -7));
    await addTask(env, owner, mandate.id, match.id, `Confirm ${cand?.name} joined`, "joining", offer.joining_date + " 09:00:00");
  }
  await audit(env.DB, "offer_updated", "offer", offer.id, { status: offer.status, user });
  return offer;
}

// ------------------------------------------------------------------ tasks
export async function addTask(env, owner, mandateId, matchId, title, kind, dueAt) {
  const dup = await one(env.DB, "tasks", "SELECT id FROM tasks WHERE owner = ? AND match_id IS ? AND title = ? AND done = 0", owner, matchId ?? null, title);
  if (dup) return dup;
  return insert(env.DB, "tasks", { owner, mandate_id: mandateId, match_id: matchId, title, kind, due_at: dueAt });
}

export async function todaysActions(env, owner) {
  const tasks = await all(env.DB, "tasks", `SELECT t.*, md.code, md.title AS mandate_title, cd.name AS candidate FROM tasks t LEFT JOIN mandates md ON md.id = t.mandate_id LEFT JOIN matches m ON m.id = t.match_id LEFT JOIN candidates cd ON cd.id = m.candidate_id
    WHERE t.owner = ? AND t.done = 0 AND t.due_at <= datetime('now', '+1 day') ORDER BY t.due_at`, owner);
  const upcoming = await all(env.DB, "tasks", `SELECT t.*, md.code, cd.name AS candidate FROM tasks t LEFT JOIN mandates md ON md.id = t.mandate_id LEFT JOIN matches m ON m.id = t.match_id LEFT JOIN candidates cd ON cd.id = m.candidate_id
    WHERE t.owner = ? AND t.done = 0 AND t.due_at > datetime('now', '+1 day') ORDER BY t.due_at LIMIT 10`, owner);
  const awaiting = await all(env.DB, "matches", `SELECT m.id, m.score, m.band, m.status, m.mandate_id, md.code, md.title AS mandate_title, cd.name FROM matches m JOIN mandates md ON md.id = m.mandate_id JOIN candidates cd ON cd.id = m.candidate_id
    WHERE md.owner = ? AND md.status = 'open' AND m.band IN ('A','B') AND m.status IN ('Sourced','AI Analysed') ORDER BY m.score DESC LIMIT 20`, owner);
  const interviews = await all(env.DB, "interviews", `SELECT iv.*, cd.name, md.code FROM interviews iv JOIN matches m ON m.id = iv.match_id JOIN candidates cd ON cd.id = m.candidate_id JOIN mandates md ON md.id = iv.mandate_id
    WHERE iv.owner = ? AND iv.status IN ('scheduled','confirmed','rescheduled') AND iv.scheduled_at BETWEEN datetime('now','-1 day') AND datetime('now','+7 days') ORDER BY iv.scheduled_at`, owner);
  const stale = await all(env.DB, "candidates", `SELECT c.id, c.name, c.last_verified_at FROM candidates c JOIN matches m ON m.candidate_id = c.id JOIN mandates md ON md.id = m.mandate_id
    WHERE c.owner = ? AND md.status = 'open' AND m.status IN ('Shortlisted','Contacted','Interested','Qualified') AND (c.last_verified_at IS NULL OR c.last_verified_at < datetime('now','-60 days')) GROUP BY c.id LIMIT 20`, owner);
  return { due: tasks, upcoming, awaiting_review: awaiting, interviews, stale };
}

export const isStale = (c, days = 60) => !c.last_verified_at || Date.now() - new Date(c.last_verified_at.replace(" ", "T") + "Z").getTime() > days * 864e5;
