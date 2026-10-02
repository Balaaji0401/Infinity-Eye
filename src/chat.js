// Conversational layer. One conversation can start before a JD exists (setting context), attach to the mandate
// created from it, and continue about the pulled profiles. Answers are grounded in the actual data we hold.
import { AIError, chatJson } from "./ai.js";
import { applyPatch, fallbackParse, parseCommand, reusablePatch } from "./commands.js";
import { STATUSES, all, get, insert, update } from "./db.js";
import { semanticSearch } from "./semantic.js";

const MAX_TURNS = 24;
const POSITIVE_STATUSES = new Set(["Shortlisted", "Contacted", "Interested", "Qualified", "Submitted", "Client Review", "Interview Scheduled", "Interview Completed", "Selected", "Offer Released", "Offer Accepted", "Joined"]);

export async function loadConversation(env, id, mandateId = null, owner = "admin") {
  let conv = id ? await get(env.DB, "conversations", id) : null;
  if (conv && conv.owner && conv.owner !== owner) conv = null;   // never read another user's chat
  if (!conv && mandateId) conv = (await all(env.DB, "conversations", "SELECT * FROM conversations WHERE mandate_id = ? AND owner = ? ORDER BY id DESC LIMIT 1", mandateId, owner))[0] || null;
  if (!conv) conv = await insert(env.DB, "conversations", { mandate_id: mandateId, messages: [], owner });
  else if (mandateId && !conv.mandate_id) { await update(env.DB, "conversations", conv.id, { mandate_id: mandateId }); conv.mandate_id = mandateId; }
  conv.messages = Array.isArray(conv.messages) ? conv.messages : [];
  return conv;
}

/** The recruiter's own words so far (used to enrich JD analysis and seed the mandate). */
export function userNotes(conv, limit = 3000) {
  return conv.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n").slice(-limit);
}

const profileLine = (m, c, i) => `${i + 1}. ${c.name} | ${[c.current_title, c.current_company].filter(Boolean).join(" @ ") || "role unknown"} | ${c.location || "loc ?"} | exp ${c.total_exp_years ?? "?"}y | CTC ${c.ctc_current_lpa ?? "?"}→${c.ctc_expected_lpa ?? "?"}L | notice ${c.notice_days ?? "?"}d | score ${m.score}/10 ${m.band} | status ${m.status} | ${c.active_status || ""} | skills: ${(c.top_skills || []).slice(0, 6).join(", ")} | contact: ${c.phone || "-"} ${c.email || "-"}${c.profile_url ? " | profile link yes" : ""}`;

function detailBlock(m, c) {
  const checks = (m.checklist || []).filter((x) => x.key !== "mandatory_skills").map((x) => `  - ${x.criterion}: ${x.status} (${x.detail})${x.evidence ? ` — "${x.evidence.slice(0, 120)}"` : ""}`).join("\n");
  return `### ${c.name}\n${profileLine(m, c, 0).slice(3)}\n${checks}\n  gaps: ${(m.gaps || []).join("; ") || "none"}\n  summary: ${m.summary || "not verified yet"}\n  questions: ${(m.questions || []).map((q) => q.replace(/^• /, "")).join(" / ")}`;
}

async function mandateGrounding(env, mandate, message) {
  const rows = await all(env.DB, "matches", "SELECT * FROM matches WHERE mandate_id = ?", mandate.id);
  const ids = rows.map((r) => r.candidate_id);
  const cands = ids.length ? await all(env.DB, "candidates", `SELECT * FROM candidates WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const byId = Object.fromEntries(cands.map((c) => [c.id, c]));
  const order = { A: 0, B: 1, Review: 2, Lead: 3, "Do not advance": 4 };
  rows.sort((a, b) => (order[a.band] ?? 5) - (order[b.band] ?? 5) || b.score - a.score);
  const named = rows.filter((m) => { const n = (byId[m.candidate_id]?.name || "").toLowerCase(); return n && n.split(/\s+/).some((w) => w.length > 2 && message.toLowerCase().includes(w)); });
  const top = rows.slice(0, 40);
  const spec = mandate.spec;
  const specTxt = `Title: ${spec.title} (also ${(spec.alt_titles || []).join(", ") || "-"}). Experience ${spec.min_exp ?? "?"}-${spec.max_exp ?? "?"} yrs. Locations: ${(spec.locations || []).join(", ") || "any"}. CTC budget ${spec.ctc_min_lpa ?? "?"}-${spec.ctc_max_lpa ?? "?"} LPA. Max notice ${spec.notice_max_days ?? "?"} days. Mandatory: ${spec.skills.filter((s) => s.mandatory).map((s) => s.name).join(", ") || "-"}. Preferred: ${spec.skills.filter((s) => !s.mandatory).map((s) => s.name).join(", ") || "-"}. Industries: ${(spec.industries || []).join(", ") || "-"}.`;
  return `MANDATE ${mandate.code} for ${mandate.client_name || "unnamed client"}: ${specTxt}
Showing top ${mandate.top_n || 5} in Scout. ${rows.length} profiles total: ${["A", "B", "Review", "Do not advance", "Lead"].map((b) => `${b}=${rows.filter((r) => r.band === b).length}`).join(", ")}.

PROFILES (ranked):
${top.map((m, i) => profileLine(m, byId[m.candidate_id] || {}, i)).join("\n")}
${named.length ? "\nDETAIL for candidates mentioned:\n" + named.slice(0, 4).map((m) => detailBlock(m, byId[m.candidate_id] || {})).join("\n") : ""}`;
}

async function globalGrounding(env, message, owner) {
  const mandates = await all(env.DB, "mandates", "SELECT id, code, title, client_name, status, created_at FROM mandates WHERE owner = ? ORDER BY id DESC LIMIT 30", owner);
  const stats = await all(env.DB, "matches", "SELECT mandate_id, band, status, COUNT(*) AS n FROM matches GROUP BY mandate_id, band, status");
  const mtxt = mandates.map((m) => { const st = stats.filter((s) => s.mandate_id === m.id); const n = st.reduce((a, s) => a + s.n, 0); const sl = st.filter((s) => POSITIVE_STATUSES.has(s.status)).reduce((a, s) => a + s.n, 0); return `- ${m.code} ${m.title} (${m.client_name || "no client"}, ${m.status}, ${m.created_at.slice(0, 10)}): ${n} profiles, ${sl} shortlisted+`; }).join("\n") || "- none yet";
  let pool = "";
  try { const r = await semanticSearch(env, message, { limit: 8, owner }); if (r.semantic && r.results.length) pool = "\nCLOSEST PEOPLE IN TALENT POOL for this message:\n" + r.results.map((c, i) => `${i + 1}. ${c.name} | ${[c.current_title, c.current_company].filter(Boolean).join(" @ ")} | ${c.location || "?"} | exp ${c.total_exp_years ?? "?"}y | skills ${(c.top_skills || []).slice(0, 5).join(", ")} | match ${Math.round(c.similarity * 100)}%`).join("\n"); } catch {}
  return `No mandate is selected yet. The recruiter may be setting context for a JD they will paste next (client, budget, location, preferences), or asking about past work.\nMANDATES:\n${mtxt}${pool}`;
}

const SYSTEM = `You are ∞ Eye, a recruiting copilot for an Indian staffing firm. Answer from the DATA block only; if something isn't in it, say so plainly. Be concise and specific: use candidate names, numbers and evidence. Do not infer age, gender, religion, caste or marital status, ever.
When the recruiter asks to change the mandate (show more profiles, change budget/notice/skills/weights) or to move candidates (shortlist, reject, hold), put those in "actions" and confirm them in the reply. Otherwise leave actions empty.
Return ONLY JSON: {"reply": "markdown text", "actions": [{"type": "command", "text": "instruction in plain words"} | {"type": "status", "candidate": "exact name from DATA", "status": "one of ${STATUSES.join(" | ")}", "note": "short reason"}]}`;

export async function chatTurn(env, { conversationId, mandateId, message, owner = "admin" }) {
  let mandate = mandateId ? await get(env.DB, "mandates", mandateId) : null;
  if (mandate && (mandate.owner || "admin") !== owner) mandate = null;
  const conv = await loadConversation(env, conversationId, mandate?.id || null, owner);
  const grounding = mandate ? await mandateGrounding(env, mandate, message) : await globalGrounding(env, message, owner);
  const history = conv.messages.slice(-MAX_TURNS).map((m) => `${m.role === "user" ? "Recruiter" : "∞ Eye"}: ${m.content}`).join("\n");
  const prompt = `DATA:\n${grounding}\n\nCONVERSATION SO FAR:\n${history || "(start)"}\n\nRecruiter: ${message}`;
  let out, via = "ai";
  try { out = await chatJson(env, SYSTEM, prompt, 900); }
  catch (e) {
    if (!(e instanceof AIError)) throw e;
    via = "rules";
    const p = mandate ? fallbackParse(message) : {};
    console.warn("chat fell back to rules:", e.message || e);
    out = Object.keys(p).length ? { reply: "I've applied that change.", actions: [{ type: "command", text: message }] }
      : { reply: mandate ? "The assistant is temporarily unavailable. You can still give direct instructions such as \"show 10 profiles\" or \"budget 9 LPA\", and everything else on this page keeps working." : "The assistant is temporarily unavailable. Analyzing a JD and screening still work; please try the chat again in a moment.", actions: [] };
  }
  const applied = [];
  if (mandate) {
    for (const a of (out.actions || []).slice(0, 5)) {
      try {
        if (a.type === "command" && a.text) applied.push(...(await runCommand(env, mandate, a.text)));
        else if (a.type === "status" && a.candidate && STATUSES.includes(a.status)) applied.push(await setStatusByName(env, mandate, a.candidate, a.status, a.note || "via chat"));
      } catch (e) { applied.push(`Couldn't apply "${a.text || a.candidate}": ${e.message}`); }
    }
  }
  const reply = (typeof out.reply === "string" ? out.reply : JSON.stringify(out.reply ?? "")).trim() || "Done.";
  const messages = [...conv.messages, { role: "user", content: message, at: new Date().toISOString() }, { role: "assistant", content: reply, actions: applied, at: new Date().toISOString() }].slice(-60);
  await update(env.DB, "conversations", conv.id, { messages, title: conv.title || message.slice(0, 80) });
  return { conversation_id: conv.id, mandate_id: mandate?.id || null, reply, actions: applied, via };
}

async function runCommand(env, mandate, text) {
  const { normalizeSpec, buildSearchPlan } = await import("./jd.js");
  const { rescoreMandate } = await import("./pipeline.js");
  const { ensureMandateEmbedding } = await import("./semantic.js");
  const { patch } = await parseCommand(env, text);
  const res = applyPatch(mandate, patch);
  if (!res.applied.length) return [`No change from "${text}"`];
  const spec = normalizeSpec(res.spec);
  await update(env.DB, "mandates", mandate.id, { spec, title: spec.title, search_plan: buildSearchPlan(spec), top_n: res.top_n, embedding: null });
  Object.assign(mandate, { spec, top_n: res.top_n, embedding: null });
  await ensureMandateEmbedding(env, mandate, true);
  await rescoreMandate(env, mandate);
  const scope = patch.remember ? (mandate.client_name ? "client" : "global") : "mandate";
  await insert(env.DB, "rules", { client_name: mandate.client_name || "", mandate_id: mandate.id, text, patch: scope === "mandate" ? patch : reusablePatch(patch), scope, owner: mandate.owner || "admin" });
  return res.applied;
}

async function setStatusByName(env, mandate, name, status, note) {
  const rows = await all(env.DB, "matches", "SELECT m.id, m.status, m.band, c.name FROM matches m JOIN candidates c ON c.id = m.candidate_id WHERE m.mandate_id = ?", mandate.id);
  const n = name.toLowerCase();
  const m = rows.find((r) => (r.name || "").toLowerCase() === n) || rows.find((r) => (r.name || "").toLowerCase().includes(n.split(" ")[0]));
  if (!m) throw new Error(`no candidate named ${name}`);
  if (m.status === status) return `${m.name} already ${status}`;
  await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: status, band_at_time: m.band, note, actor: "chat" });
  await update(env.DB, "matches", m.id, { status });
  return `${m.name} → ${status}`;
}

/** Seed a freshly created mandate from the pre-JD conversation: run the recruiter's notes through the command engine. */
export async function seedFromConversation(env, mandate, conv) {
  const notes = userNotes(conv);
  if (!notes.trim()) return [];
  const { normalizeSpec, buildSearchPlan } = await import("./jd.js");
  const { patch } = await parseCommand(env, "Context the recruiter gave before the JD: " + notes);
  const res = applyPatch(mandate, patch);
  if (!res.applied.length) return [];
  const spec = normalizeSpec(res.spec);
  await update(env.DB, "mandates", mandate.id, { spec, search_plan: buildSearchPlan(spec), top_n: res.top_n });
  Object.assign(mandate, { spec, top_n: res.top_n });
  return res.applied;
}
