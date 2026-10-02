import { Hono } from "hono";
import { cors } from "hono/cors";
import { dashboard } from "./analytics.js";
import { REASON_CODES, REASON_STATUSES, STATUSES, STATUS_GROUPS, all, audit, enqueue, get, insert, logEvent, one, update } from "./db.js";
import { candidateHistory, createSubmissions, ensureClient, renderPack, submissionConflict, toCsv, trackerRows } from "./pipeline_ops.js";
import { RESPONSES, addTask, createInterview, draftOutreach, ensureTemplates, extractInterview, isStale, recordFeedback, recordResponse, sendOutreach, todaysActions, updateInterview, upsertOffer } from "./engagement.js";
import { applyPatch, parseCommand, reusablePatch } from "./commands.js";
import { applyRememberedRules, learnWeights, weightsFor } from "./learning.js";
import { importNaukriRows } from "./naukri.js";
import { observability } from "./observability.js";
import { importFromPageText } from "./reach.js";
import { chatTurn, loadConversation, seedFromConversation, userNotes } from "./chat.js";
import { ensureMandateEmbedding, jdText, semanticSearch } from "./semantic.js";
import { cosine, embed } from "./ai.js";
import { AIError, chatProvider, embedProvider } from "./ai.js";
import { searchProviders } from "./sourcing.js";
import { analyzeJd, buildSearchPlan, complianceFlags, normalizeSpec } from "./jd.js";
import { ALLOWED, ingestResume, nextDeepCandidate, deepExtract, rescoreMandate, runDeepSweep } from "./pipeline.js";
import { rankKey } from "./scoring.js";
import { ensureSchema, getSigningSecret } from "./schema.js";
import { runGithub, runPool, runXray } from "./sourcing.js";

const app = new Hono();
// The Reach browser extension calls the API from other origins (Resdex, LinkedIn tabs).
app.use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ------------------------------------------------------------------ auth
async function sign(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}
async function makeToken(env, user) {
  const payload = `${user}.${Date.now() + 7 * 864e5}`;
  return `${payload}.${await sign(await getSigningSecret(env), payload)}`;
}
async function checkToken(env, token) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  const [user, exp, sig] = parts;
  if (+exp < Date.now() || (await sign(await getSigningSecret(env), `${user}.${exp}`)) !== sig) return null;
  return user;
}

/** Users: APP_USERS = "admin:admin,tester:tester,guest:guest" (var or secret). Falls back to APP_USER/APP_PASSWORD. */
function users(env) {
  const out = {};
  for (const pair of String(env.APP_USERS || "").split(",")) { const i = pair.indexOf(":"); if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  if (!Object.keys(out).length) out[env.APP_USER || "admin"] = env.APP_PASSWORD || "admin";
  return out;
}
app.post("/api/login", async (c) => {
  await ensureSchema(c.env.DB);
  const { username, password } = await c.req.json();
  const u = users(c.env);
  if (!username || !password || u[username] === undefined || u[username] !== password) return c.json({ detail: "Wrong username or password." }, 401);
  const display = username === (c.env.APP_USER || "admin") ? (c.env.APP_DISPLAY_NAME || username) : username;
  return c.json({ token: await makeToken(c.env, username), display_name: display, username, using_default_password: !c.env.APP_PASSWORD && !c.env.APP_USERS });
});

// ---- Public candidate response page (token in the link; no login) ----
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
app.get("/r/:token", async (c) => {
  await ensureSchema(c.env.DB);
  const o = await one(c.env.DB, "outreach", "SELECT * FROM outreach WHERE token = ?", c.req.param("token"));
  if (!o) return c.html("<p style='font-family:sans-serif;padding:40px'>This link is no longer valid.</p>", 404);
  const md = await get(c.env.DB, "mandates", o.mandate_id), cd = await get(c.env.DB, "candidates", o.candidate_id);
  const company = c.env.COMPANY_NAME || "Neurosaur", recruiter = c.env.RECRUITER_NAME || "the recruiting team";
  const done = o.status === "responded";
  const isInterview = o.kind === "interview";
  const opts = isInterview ? [["Interested", "Yes, I'll attend"], ["Need details", "I need to reschedule / have a question"], ["Not interested", "I'm no longer interested"]]
    : [["Interested", "Yes, I'm interested"], ["Call me", "Call me to discuss"], ["Need details", "Send me more details"], ["Later", "Not now, maybe later"], ["Not interested", "Not interested"]];
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(md?.title || "Opportunity")} · ${esc(company)}</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f4;color:#17171a;margin:0;padding:24px}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 6px}.muted{color:#666}.opt{display:block;width:100%;text-align:left;padding:14px 16px;margin:8px 0;border-radius:12px;border:1px solid #ddd;background:#fafafa;font:inherit;cursor:pointer}.opt:hover{border-color:#111}
.opt.sel{border-color:#111;background:#111;color:#fff}label{display:block;font-size:13px;color:#555;margin-top:12px}input,textarea,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font:inherit;margin-top:4px}
button.go{margin-top:16px;width:100%;padding:13px;border:0;border-radius:12px;background:#f5b53f;font:inherit;font-weight:700;cursor:pointer}.foot{font-size:12px;color:#777;margin-top:18px}.ok{text-align:center;padding:20px 0}
#more{display:none}</style></head><body><div class="card">
<div class="muted" style="font-size:13px">${esc(company)}</div>
<h1>${esc(md?.title || "Opportunity")}${md?.client_name ? ` · ${esc(md.client_name)}` : ""}</h1>
<p class="muted">Hi ${esc((cd?.name || "there").split(" ")[0])}, ${esc(recruiter)} ${isInterview ? "scheduled an interview for you and would like you to confirm." : "reached out about this role. Let us know how you'd like to proceed. It takes 10 seconds."}</p>
${done ? `<div class="ok"><h2>Thank you</h2><p class="muted">We've recorded your response (“${esc(o.response)}”). ${esc(recruiter)} will be in touch.</p></div>` : `
<form id="f">${opts.map(([v, l]) => `<button type="button" class="opt" data-v="${esc(v)}">${esc(l)}</button>`).join("")}
<div id="more">
  <label>Current CTC (LPA)<input name="ctc_current_lpa" type="number" step="0.1" min="0"></label>
  <label>Expected CTC (LPA)<input name="ctc_expected_lpa" type="number" step="0.1" min="0"></label>
  <label>Notice period (days)<input name="notice_days" type="number" min="0"></label>
  <label>Preferred location<input name="preferred_location"></label>
  <label>Best phone number${cd?.phone ? " (we have one on file)" : ""}<input name="phone"></label>
</div>
<label>Anything you'd like to add? (optional)<textarea name="message" rows="2"></textarea></label>
<button class="go" type="submit" disabled>Send response</button>
<div class="foot"><a href="#" id="optout" style="color:#777">Please don't contact me again</a></div></form>
<script>
const f=document.getElementById('f');let v='';const go=f.querySelector('.go');
f.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{f.querySelectorAll('.opt').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');v=b.dataset.v;go.disabled=false;document.getElementById('more').style.display=(v==='Interested'||v==='Call me')&&${isInterview ? "false" : "true"}?'block':'none';});
async function send(resp){const d=Object.fromEntries(new FormData(f).entries());go.disabled=true;go.textContent='Sending…';
const r=await fetch('/api/public/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(o.token)},response:resp,detail:d})});
if(r.ok){location.reload();}else{go.disabled=false;go.textContent='Send response';alert('Could not send. Please try again.');}}
f.onsubmit=e=>{e.preventDefault();if(v)send(v);};document.getElementById('optout').onclick=e=>{e.preventDefault();if(confirm('We will not contact you again. Continue?'))send('Do not contact');};
</script>`}
<div class="foot">${esc(company)} · This link is personal to you. We use your reply only to coordinate this opportunity.</div></div></body></html>`);
});
app.post("/api/public/respond", async (c) => {
  const { token, response, detail } = await c.req.json();
  try { const r = await recordResponse(c.env, String(token || ""), response, detail || {}); return r ? c.json(r) : c.json({ detail: "Invalid link" }, 404); }
  catch (e) { return c.json({ detail: e.message }, 400); }
});

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/login" || c.req.path === "/api/public/respond") return next();
  const user = await checkToken(c.env, (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!user) return c.json({ detail: "Please sign in again." }, 401);
  await ensureSchema(c.env.DB);
  c.set("user", user);
  await next();
});

// Observability: one event per API request (route pattern, status, latency)
app.use("/api/*", async (c, next) => {
  const t0 = Date.now();
  await next();
  const route = c.req.routePath || c.req.path.replace(/\/\d+/g, "/:id");
  c.executionCtx.waitUntil(logEvent(c.env.DB, "request", `${c.req.method} ${route}`, c.res.status, Date.now() - t0));
});

app.onError((err, c) => {
  console.error(err);
  const friendly = err.status && err.status < 500 ? err.message : "Something went wrong on our side. Please try again; if it keeps happening, check the Observability page.";
  return c.json({ detail: friendly }, err.status || 500);
});
const notFound = (c, what) => c.json({ detail: `${what} not found` }, 404);
const who = (c) => c.get("user") || "admin";
/** Load a mandate only if it belongs to the signed-in user. */
async function ownedMandate(c, id) { const md = await get(c.env.DB, "mandates", +id); return md && (md.owner || "admin") === who(c) ? md : null; }
async function ownedMatch(c, id) { const m = await get(c.env.DB, "matches", +id); if (!m) return null; const md = await get(c.env.DB, "mandates", m.mandate_id); return md && (md.owner || "admin") === who(c) ? m : null; }

// ------------------------------------------------------------------ health + JD
app.get("/api/health", async (c) => {
  const { embed } = await import("./ai.js");
  const vec = await embed(c.env, ["ping"]);
  const provider = chatProvider(c.env);
  const llmOk = provider === "codecraft" ? !!c.env.CODECRAFT_API_KEY : !!c.env.AI;
  return c.json({ llm: llmOk, embeddings: !!vec, llm_provider: provider, embed_provider: embedProvider(c.env),
    llm_model: provider === "codecraft" ? c.env.LLM_MODEL || "deepseek-v4-flash-0731" : c.env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
    search_api: searchProviders(c.env).length > 0, search_providers: searchProviders(c.env), github: true,
    display_name: who(c) === (c.env.APP_USER || "admin") ? (c.env.APP_DISPLAY_NAME || who(c)) : who(c), username: who(c), statuses: STATUSES, status_groups: STATUS_GROUPS,
    reason_statuses: REASON_STATUSES, reason_codes: REASON_CODES, responses: RESPONSES, hosting: "cloudflare",
    email_provider: !!c.env.RESEND_API_KEY, whatsapp_provider: !!(c.env.WHATSAPP_TOKEN && c.env.WHATSAPP_PHONE_ID), public_url: c.env.PUBLIC_URL || "",
    using_default_password: !c.env.APP_PASSWORD && !c.env.APP_USERS });
});

app.post("/api/jd/analyze", async (c) => {
  const { text, conversation_id } = await c.req.json();
  if (!text || text.trim().length < 30) return c.json({ detail: "Paste the full job description (at least a few lines)." }, 400);
  let notes = "";
  if (conversation_id) { const conv = await get(c.env.DB, "conversations", +conversation_id); if (conv && (conv.owner || "admin") === who(c)) notes = userNotes({ messages: conv.messages || [] }); }
  return c.json(await analyzeJd(c.env, text, notes));
});

/** Does this JD look like a mandate we already have? Same title+client, or near-identical text/requirements. */
async function findDuplicateMandates(env, { spec, client_name = "", jd_text = "", owner = "admin" }) {
  const mds = await all(env.DB, "mandates", "SELECT id, code, title, client_name, status, created_at, jd_text, embedding FROM mandates WHERE owner = ? ORDER BY id DESC LIMIT 200", owner);
  const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out = [];
  const qv = spec ? (await embed(env, [jdText(spec)]))?.[0] : null;
  for (const m of mds) {
    const reasons = [];
    if (spec && norm(m.title) === norm(spec.title) && norm(m.client_name) === norm(client_name)) reasons.push("same title and client");
    if (jd_text && m.jd_text && norm(m.jd_text).slice(0, 600) === norm(jd_text).slice(0, 600)) reasons.push("identical JD text");
    if (qv && m.embedding) { let v = null; try { v = JSON.parse(m.embedding); } catch {} const sim = v ? cosine(qv, v) : 0; if (sim >= 0.92) reasons.push(`${Math.round(sim * 100)}% similar requirements`); }
    if (reasons.length) out.push({ id: m.id, code: m.code, title: m.title, client_name: m.client_name, status: m.status, created_at: m.created_at, reasons });
  }
  return out.slice(0, 5);
}
app.post("/api/jd/duplicates", async (c) => c.json({ duplicates: await findDuplicateMandates(c.env, { ...(await c.req.json()), owner: who(c) }) }));

/** CSV of pulled profiles, optionally one source. */
app.get("/api/mandates/:id/export", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const source = c.req.query("source") || "all";
  let rows = await all(c.env.DB, "matches", "SELECT * FROM matches WHERE mandate_id = ?", md.id);
  if (source !== "all") rows = rows.filter((m) => m.origin === source);
  const ids = rows.map((r) => r.candidate_id);
  const cands = ids.length ? await all(c.env.DB, "candidates", `SELECT * FROM candidates WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const byId = Object.fromEntries(cands.map((x) => [x.id, x]));
  rows.sort(rankKey);
  const cols = ["Rank", "Name", "Score", "Band", "Status", "Source", "Current title", "Company", "Location", "Experience (yrs)", "Current CTC (LPA)", "Expected CTC (LPA)", "Notice (days)", "Job search", "Phone", "Email", "Profile URL", "Top skills", "Gaps", "Resume on file"];
  const esc = (v) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = [cols.join(",")];
  rows.forEach((m, i) => { const x = byId[m.candidate_id] || {}; lines.push([i + 1, x.name, m.score, m.band, m.status, m.origin, x.current_title, x.current_company, x.location, x.total_exp_years, x.ctc_current_lpa, x.ctc_expected_lpa, x.notice_days, x.active_status, x.phone, x.email, x.profile_url, (x.top_skills || []).join("; "), (m.gaps || []).join("; "), x.resume_key ? "yes" : "no"].map(esc).join(",")); });
  await audit(c.env.DB, "profiles_exported", "mandate", md.id, { source, rows: rows.length, user: c.get("user") });
  return new Response("\ufeff" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${md.code}-${source}-profiles.csv"` } });
});

// ------------------------------------------------------------------ chat
app.post("/api/chat", async (c) => {
  const { conversation_id, mandate_id, message } = await c.req.json();
  if (!message || !String(message).trim()) return c.json({ detail: "Say something first." }, 400);
  return c.json(await chatTurn(c.env, { conversationId: conversation_id ? +conversation_id : null, mandateId: mandate_id ? +mandate_id : null, message: String(message).trim().slice(0, 4000), owner: who(c) }));
});
app.get("/api/conversations", async (c) => {
  const mid = c.req.query("mandate_id");
  const rows = mid ? await all(c.env.DB, "conversations", "SELECT * FROM conversations WHERE mandate_id = ? AND owner = ? ORDER BY id DESC LIMIT 5", +mid, who(c))
    : await all(c.env.DB, "conversations", "SELECT * FROM conversations WHERE owner = ? ORDER BY id DESC LIMIT 20", who(c));
  return c.json(rows);
});
app.get("/api/conversations/:id", async (c) => { const r = await get(c.env.DB, "conversations", +c.req.param("id")); return r && (r.owner || "admin") === who(c) ? c.json(r) : notFound(c, "Conversation"); });

// ------------------------------------------------------------------ mandates
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role";

async function mandateOut(env, md) {
  const mm = await all(env.DB, "matches", "SELECT id, kind, origin, band, score, deep_done FROM matches WHERE mandate_id = ?", md.id);
  const byOrigin = {};
  for (const m of mm) byOrigin[m.origin] = (byOrigin[m.origin] || 0) + 1;
  const resumes = mm.filter((m) => m.kind === "resume");
  const top = resumes.sort(rankKey).slice(0, parseInt(env.DEEP_TOP_N || "15", 10));
  const jobs = await all(env.DB, "jobs", "SELECT * FROM jobs WHERE status IN ('queued','running') AND json_extract(payload,'$.mandate_id') = ?", md.id);
  const failed = await all(env.DB, "jobs", "SELECT * FROM jobs WHERE status='error' AND json_extract(payload,'$.mandate_id') = ? ORDER BY id DESC LIMIT 3", md.id);
  const rules = await all(env.DB, "rules", "SELECT id, text, scope, created_at FROM rules WHERE mandate_id = ? OR (scope='client' AND client_name = ?) OR scope='global' ORDER BY id DESC", md.id, md.client_name || "");
  return {
    ...md, created_at: md.created_at, top_n: md.top_n || 5, rules, sources: md.sources || ["pool", "naukri", "linkedin", "github"], embedding: undefined,
    counts: { resumes: resumes.length, leads: mm.filter((m) => m.kind === "lead").length, by_origin: byOrigin,
      bands: Object.fromEntries(["A", "B", "Review", "Do not advance"].map((b) => [b, resumes.filter((m) => m.band === b).length])) },
    progress: { deep_total: top.length, deep_done: top.filter((m) => m.deep_done).length, jobs: jobs.map((j) => ({ type: j.type, status: j.status })) },
    errors: failed.map((j) => ({ type: j.type, error: j.error })),
    compliance_flags: complianceFlags(md.jd_text),
  };
}

async function runJob(env, jobId) {
  const job = await get(env.DB, "jobs", jobId);
  if (!job || job.status === "done") return;
  await update(env.DB, "jobs", job.id, { status: "running" });
  try {
    const md = await get(env.DB, "mandates", job.payload.mandate_id);
    if (!md) throw new Error("Mandate not found");
    if (job.type === "xray") await runXray(env, md);
    else if (job.type === "github") await runGithub(env, md);
    else if (job.type === "pool") await runPool(env, md);
    await update(env.DB, "jobs", job.id, { status: "done", error: "" });
  } catch (e) {
    console.error("job failed", job.type, e);
    await update(env.DB, "jobs", job.id, { status: "error", error: String(e.message || e).slice(0, 500) });
  }
}

const ALL_SOURCES = ["pool", "naukri", "linkedin", "github", "boards"];
const cleanSources = (arr) => { const a = Array.isArray(arr) ? arr.filter((x) => ALL_SOURCES.includes(x)) : null; return a && a.length ? a : ["pool", "naukri", "linkedin", "github"]; };

async function queueSourcing(c, md) {
  const src = md.sources || ["pool", "naukri", "linkedin", "github"];
  const ids = [];
  if (src.includes("pool")) ids.push((await c.env.DB.prepare("INSERT INTO jobs (type, payload) VALUES ('pool', ?) RETURNING id").bind(JSON.stringify({ mandate_id: md.id })).first()).id);
  if (src.includes("linkedin") && searchProviders(c.env).length) ids.push((await c.env.DB.prepare("INSERT INTO jobs (type, payload) VALUES ('xray', ?) RETURNING id").bind(JSON.stringify({ mandate_id: md.id })).first()).id);
  if (src.includes("github") && md.search_plan?.github_query) ids.push((await c.env.DB.prepare("INSERT INTO jobs (type, payload) VALUES ('github', ?) RETURNING id").bind(JSON.stringify({ mandate_id: md.id })).first()).id);
  c.executionCtx.waitUntil((async () => { for (const id of ids) await runJob(c.env, id); })());
}

app.get("/api/mandates", async (c) => {
  const mds = await all(c.env.DB, "mandates", "SELECT * FROM mandates WHERE owner = ? ORDER BY id DESC", who(c));
  const stats = await all(c.env.DB, "matches", "SELECT mandate_id, kind, band FROM matches");
  return c.json(mds.map((md) => {
    const mm = stats.filter((s) => s.mandate_id === md.id);
    return { id: md.id, code: md.code, title: md.title, client_name: md.client_name, status: md.status, created_at: md.created_at,
      resumes: mm.filter((m) => m.kind === "resume").length, band_a: mm.filter((m) => m.band === "A").length, leads: mm.filter((m) => m.kind === "lead").length };
  }));
});

app.post("/api/mandates", async (c) => {
  const body = await c.req.json();
  const spec = normalizeSpec(body.spec);
  if (!body.force) {
    const dups = await findDuplicateMandates(c.env, { spec, client_name: body.client_name || "", jd_text: body.jd_text || "", owner: who(c) });
    if (dups.some((d) => d.reasons.some((r) => /same title and client|identical/.test(r)))) return c.json({ detail: "This JD looks like an existing mandate.", duplicates: dups }, 409);
  }
  const n = ((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM mandates").first()).n || 0) + 1;
  const code = `M${String(n).padStart(4, "0")}`;
  const client = (body.client_name || "").trim();
  const lw = await weightsFor(c.env, client, who(c));
  if (lw.weights && !Object.keys(spec.weights || {}).length) spec.weights = lw.weights;
  const remembered = await applyRememberedRules(c.env, { spec, top_n: +body.top_n || 5, client_name: client });
  const finalSpec = normalizeSpec(remembered.spec);
  const md = await insert(c.env.DB, "mandates", { code, title: finalSpec.title, client_name: client, jd_text: body.jd_text || "",
    spec: finalSpec, search_plan: buildSearchPlan(finalSpec), fee_type: body.fee_type === "flat" ? "flat" : "percent", fee_value: +body.fee_value || 0,
    top_n: remembered.top_n, sources: cleanSources(body.sources), owner: who(c) });
  await ensureClient(c.env, who(c), client);
  await audit(c.env.DB, "mandate_created", "mandate", md.id, { code, learned_weights: lw.from, rules_applied: remembered.applied.length });
  let seeded = [];
  if (body.conversation_id) {
    const conv = await loadConversation(c.env, +body.conversation_id, md.id, who(c));
    try { seeded = await seedFromConversation(c.env, md, conv); } catch (e) { console.warn("seed failed", e); }
    if (seeded.length) { md.search_plan = buildSearchPlan(md.spec); await update(c.env.DB, "mandates", md.id, { search_plan: md.search_plan }); }
  }
  await ensureMandateEmbedding(c.env, md, true);
  await queueSourcing(c, md);
  return c.json({ ...(await mandateOut(c.env, md)), seeded_from_chat: seeded, conversation_id: body.conversation_id || null });
});

app.get("/api/mandates/:id", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  return md ? c.json(await mandateOut(c.env, md)) : notFound(c, "Mandate");
});

app.patch("/api/mandates/:id", async (c) => {
  let md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const body = await c.req.json(), patch = {};
  if (body.spec) { patch.spec = normalizeSpec(body.spec); patch.title = patch.spec.title; patch.search_plan = buildSearchPlan(patch.spec); patch.embedding = null; }
  for (const f of ["client_name", "fee_type", "fee_value", "recruiter_hours", "status", "top_n"]) if (body[f] !== undefined && body[f] !== null) patch[f] = body[f];
  if (body.sources) patch.sources = cleanSources(body.sources);
  await update(c.env.DB, "mandates", md.id, patch);
  md = { ...md, ...patch };
  if (body.spec) { await ensureMandateEmbedding(c.env, md, true); await rescoreMandate(c.env, md); await audit(c.env.DB, "spec_updated", "mandate", md.id); c.executionCtx.waitUntil(runDeepSweep(c.env, 2)); }
  return c.json(await mandateOut(c.env, md));
});

app.post("/api/mandates/:id/source/:channel", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const ch = c.req.param("channel");
  if (!["xray", "github", "pool"].includes(ch)) return c.json({ detail: "Unknown channel" }, 400);
  if (ch === "xray" && !searchProviders(c.env).length) return c.json({ detail: "Public-profile discovery isn't enabled on this deployment yet. Ask your administrator to connect a search provider." }, 400);
  const { id } = await c.env.DB.prepare("INSERT INTO jobs (type, payload) VALUES (?, ?) RETURNING id").bind(ch, JSON.stringify({ mandate_id: md.id })).first();
  c.executionCtx.waitUntil(runJob(c.env, id));
  return c.json({ queued: ch });
});

/** One resume per request. The browser sends the extracted text plus the original file. */
app.post("/api/mandates/:id/candidates", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const form = await c.req.formData();
  const file = form.get("file"), text = form.get("text") || "", source = form.get("source") || "upload";
  const filename = (file && file.name) || form.get("filename") || "resume.txt";
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (!ALLOWED.has(ext)) return c.json({ detail: `${filename}: use PDF, DOCX or TXT.` }, 400);
  const bytes = file && typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : null;
  const r = await ingestResume(c.env, md, { text: String(text), filename, bytes, source: ["naukri", "inbound", "upload"].includes(source) ? source : "upload" });
  // verify the newly ingested candidate right away if it ranks in the top N
  c.executionCtx.waitUntil((async () => { const m = await nextDeepCandidate(c.env); if (m) await deepExtract(c.env, m); })());
  return c.json({ ok: true, match_id: r.match?.id, score: r.match?.score, band: r.match?.band, skipped: r.skipped || null, duplicate: r.duplicate || null });
});

// ------------------------------------------------------------------ matches
function matchOut(m, cnd) {
  return { id: m.id, candidate_id: cnd.id, kind: m.kind, origin: m.origin, score: m.score, band: m.band, stage: m.stage, deep_done: !!m.deep_done,
    deep_error: m.deep_error, status: m.status, checklist: m.checklist || [], gaps: m.gaps || [], questions: m.questions || [], summary: m.summary, outreach: m.outreach,
    name: cnd.name || "Unnamed candidate", email: cnd.email, phone: cnd.phone, current_title: cnd.current_title, current_company: cnd.current_company,
    location: cnd.location, total_exp_years: cnd.total_exp_years, ctc_current_lpa: cnd.ctc_current_lpa, ctc_expected_lpa: cnd.ctc_expected_lpa,
    notice_days: cnd.notice_days, education: cnd.education, top_skills: cnd.top_skills || [], profile_url: cnd.profile_url, has_resume: !!cnd.resume_key,
    active_status: cnd.active_status, last_active: cnd.last_active,
    resume_filename: cnd.resume_filename, source: cnd.source, updated_at: m.updated_at, model: m.model || "", created_at: m.created_at,
    last_verified_at: cnd.last_verified_at, stale: isStale(cnd), opt_out: !!cnd.opt_out, preferred_location: cnd.preferred_location };
}

app.get("/api/mandates/:id/matches", async (c) => {
  if (!(await ownedMandate(c, c.req.param("id")))) return notFound(c, "Mandate");
  const kind = c.req.query("kind") || "resume";
  const rows = kind === "all" ? await all(c.env.DB, "matches", "SELECT * FROM matches WHERE mandate_id = ?", +c.req.param("id"))
    : await all(c.env.DB, "matches", "SELECT * FROM matches WHERE mandate_id = ? AND kind = ?", +c.req.param("id"), kind);
  const ids = rows.map((r) => r.candidate_id);
  const cands = ids.length ? await all(c.env.DB, "candidates", `SELECT * FROM candidates WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const byId = Object.fromEntries(cands.map((x) => [x.id, x]));
  return c.json(rows.sort(rankKey).map((m) => matchOut(m, byId[m.candidate_id] || {})));
});

app.patch("/api/matches/:id/status", async (c) => {
  const m = await ownedMatch(c, c.req.param("id"));
  if (!m) return notFound(c, "Candidate");
  const { status, note = "", reason = "", override = false } = await c.req.json();
  if (!STATUSES.includes(status)) return c.json({ detail: "Unknown status" }, 400);
  if (REASON_STATUSES.includes(status) && !reason && !note.trim()) return c.json({ detail: `Please give a reason for "${status}".` }, 400);
  let warning = null;
  if (status === "Submitted" && status !== m.status) {
    const md = await get(c.env.DB, "mandates", m.mandate_id);
    const conflict = await submissionConflict(c.env, who(c), m, md);
    if (conflict && (conflict.rule === "block" || conflict.same_position) && !override) return c.json({ detail: conflict.same_position ? "This candidate was already submitted for this position." : `This candidate was submitted to ${md.client_name} in the last ${conflict.days} days.`, conflict }, 409);
    if (conflict && conflict.rule === "warn") warning = `Note: this candidate was also submitted to ${md.client_name} for ${conflict.prior.map((p) => p.code).join(", ")}.`;
  }
  if (status !== m.status) {
    await insert(c.env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: status, band_at_time: m.band, note: note.trim(), reason, actor: who(c) });
    await audit(c.env.DB, "status_changed", "match", m.id, { from: m.status, to: status, user: c.get("user") });
    await update(c.env.DB, "matches", m.id, { status });
    m.status = status;
    if (["Shortlisted", "Rejected", "Joined"].includes(status)) c.executionCtx.waitUntil(learnWeights(c.env, who(c)).catch((e) => console.error("learn failed", e)));
  }
  return c.json({ ...matchOut(m, await get(c.env.DB, "candidates", m.candidate_id)), warning });
});

app.get("/api/matches/:id/history", async (c) => {
  if (!(await ownedMatch(c, c.req.param("id")))) return notFound(c, "Candidate");
  const evs = await all(c.env.DB, "status_events", "SELECT * FROM status_events WHERE match_id = ? ORDER BY id DESC", +c.req.param("id"));
  return c.json(evs.map((e) => ({ from: e.from_status, to: e.to_status, note: e.note, reason: e.reason, actor: e.actor, at: e.created_at })));
});

app.get("/api/candidates/:id/resume", async (c) => {
  const cnd = await get(c.env.DB, "candidates", +c.req.param("id"));
  if (!cnd || (cnd.owner || "admin") !== who(c)) return notFound(c, "Candidate");
  if (!cnd.resume_key) return c.json({ detail: "No resume on file for this candidate." }, 404);
  const obj = await c.env.FILES.get(cnd.resume_key);
  if (!obj) return c.json({ detail: "Resume file is missing from storage." }, 404);
  await audit(c.env.DB, "resume_downloaded", "candidate", cnd.id, { user: c.get("user") });
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${(cnd.resume_filename || "resume").replace(/[^\w.\- ]/g, "_")}"` } });
});

// ------------------------------------------------------------------ Naukri export import, prompt commands, learning, observability
app.post("/api/mandates/:id/naukri-import", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const { rows } = await c.req.json();
  if (!Array.isArray(rows) || !rows.length) return c.json({ detail: "No rows found in that file." }, 400);
  const t0 = Date.now();
  const r = await importNaukriRows(c.env, md, rows.slice(0, 500));
  c.executionCtx.waitUntil(logEvent(c.env.DB, "job", "naukri_import", r.error ? "error" : "ok", Date.now() - t0, { ...r }));
  return c.json(r);
});

/** Reach: the browser extension posts the visible text of a results page; AI structures it; profiles get scored. */
app.post("/api/mandates/:id/reach-import", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const { text, url } = await c.req.json();
  const t0 = Date.now();
  let r;
  try { r = await importFromPageText(c.env, md, String(text || "").slice(0, 80000), url || ""); }
  catch (e) { if (e instanceof AIError) return c.json({ detail: "The AI service is unavailable right now, so this page couldn't be read. Please try again in a moment." }, 503); throw e; }
  c.executionCtx.waitUntil(logEvent(c.env.DB, "job", "reach_import", r.error ? "error" : "ok", Date.now() - t0, { ...r, url: (url || "").slice(0, 120) }));
  return c.json(r);
});

/** Semantic talent search across everyone in the database. */
app.get("/api/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (q.length < 3) return c.json({ results: [], semantic: false });
  const r = await semanticSearch(c.env, q, { limit: Math.min(50, +c.req.query("limit") || 25), owner: who(c) });
  if (!r.semantic) {   // embeddings unavailable: keyword fallback
    const like = `%${q.toLowerCase()}%`;
    const rows = await all(c.env.DB, "candidates", "SELECT id, name, current_title, current_company, location, total_exp_years, top_skills, source, profile_url, resume_key, email, phone FROM candidates WHERE owner = ? AND lower(name || ' ' || coalesce(current_title,'') || ' ' || coalesce(current_company,'') || ' ' || coalesce(location,'') || ' ' || top_skills || ' ' || resume_text) LIKE ? ORDER BY id DESC LIMIT 25", who(c), like);
    return c.json({ results: rows.map((x) => ({ ...x, similarity: null })), semantic: false });
  }
  const ids = r.results.map((x) => x.id);
  const matches = ids.length ? await all(c.env.DB, "matches", `SELECT m.candidate_id, m.mandate_id, m.score, m.band, m.status, md.code, md.title AS mandate_title FROM matches m JOIN mandates md ON md.id = m.mandate_id WHERE m.candidate_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.score DESC`, ...ids) : [];
  const best = {};
  for (const m of matches) if (!best[m.candidate_id]) best[m.candidate_id] = m;
  return c.json({ ...r, results: r.results.map((x) => ({ ...x, has_resume: !!x.resume_key, best_match: best[x.id] || null })) });
});

app.post("/api/mandates/:id/command", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const { text } = await c.req.json();
  if (!text || text.trim().length < 3) return c.json({ detail: "Tell me what to change, e.g. 'show 10 profiles' or 'budget 9 LPA'." }, 400);
  const { patch, via } = await parseCommand(c.env, text.trim());
  const res = applyPatch(md, patch);
  if (!res.applied.length) return c.json({ applied: [], via, message: "I couldn't turn that into a change. Try: 'show 10 profiles', 'notice up to 60 days', 'SAP FICO is mandatory', 'prefer manufacturing'." });
  const spec = normalizeSpec(res.spec);
  await update(c.env.DB, "mandates", md.id, { spec, title: spec.title, search_plan: buildSearchPlan(spec), top_n: res.top_n });
  const updated = { ...md, spec, top_n: res.top_n, embedding: null };
  await ensureMandateEmbedding(c.env, updated, true);
  await rescoreMandate(c.env, updated);
  const scope = patch.remember ? (md.client_name ? "client" : "global") : "mandate";
  await insert(c.env.DB, "rules", { client_name: md.client_name || "", mandate_id: md.id, text: text.trim(), patch: scope === "mandate" ? patch : reusablePatch(patch), scope, owner: who(c) });
  await audit(c.env.DB, "command_applied", "mandate", md.id, { text: text.trim(), applied: res.applied, scope, via });
  c.executionCtx.waitUntil(runDeepSweep(c.env, 2));
  return c.json({ applied: res.applied, via, remembered: scope !== "mandate" ? scope : null, summary: patch.summary || null, mandate: await mandateOut(c.env, updated) });
});

app.delete("/api/rules/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM rules WHERE id = ? AND owner = ?").bind(+c.req.param("id"), who(c)).run();
  return c.json({ ok: true });
});

app.post("/api/mandates/:id/apply-learned-weights", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const lw = await weightsFor(c.env, md.client_name, who(c));
  if (!lw.weights) return c.json({ detail: "Not enough decisions yet to learn from. Shortlist and reject at least three candidates each, then try again." }, 400);
  const spec = normalizeSpec({ ...md.spec, weights: lw.weights });
  await update(c.env.DB, "mandates", md.id, { spec });
  await rescoreMandate(c.env, { ...md, spec });
  return c.json({ weights: lw.weights, from: lw.from, mandate: await mandateOut(c.env, { ...md, spec }) });
});

app.get("/api/learning", async (c) => c.json({ ...(await c.env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(`learned_weights:${who(c)}`).first().then((r) => (r ? JSON.parse(r.value) : {})).catch(() => ({}))),
  rules: await all(c.env.DB, "rules", "SELECT * FROM rules WHERE owner = ? ORDER BY id DESC LIMIT 100", who(c)) }));
app.post("/api/learning/run", async (c) => c.json(await learnWeights(c.env, who(c))));
app.get("/api/observability", async (c) => c.json(await observability(c.env, who(c))));

// ------------------------------------------------------------------ Phase B: clients, submissions, history, tracker
app.get("/api/clients", async (c) => {
  const rows = await all(c.env.DB, "clients", "SELECT * FROM clients WHERE owner = ? ORDER BY name", who(c));
  const mds = await all(c.env.DB, "mandates", "SELECT id, code, title, client_name, status FROM mandates WHERE owner = ?", who(c));
  const subs = await all(c.env.DB, "submissions", "SELECT client_name, COUNT(*) AS n FROM submissions WHERE owner = ? GROUP BY client_name", who(c));
  const rules = await all(c.env.DB, "rules", "SELECT client_name, text, scope FROM rules WHERE owner = ? AND scope = 'client'", who(c));
  const learned = await c.env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(`learned_weights:${who(c)}`).first().then((r) => (r ? JSON.parse(r.value) : {})).catch(() => ({}));
  return c.json(rows.map((cl) => ({ ...cl, mandates: mds.filter((m) => (m.client_name || "").toLowerCase() === cl.name.toLowerCase()),
    submissions: subs.find((s) => (s.client_name || "").toLowerCase() === cl.name.toLowerCase())?.n || 0,
    observed_rules: rules.filter((r) => (r.client_name || "").toLowerCase() === cl.name.toLowerCase()).map((r) => r.text),
    observed_weights: learned[cl.name]?.weights || null, observed_examples: learned[cl.name]?.examples || null })));
});
app.post("/api/clients", async (c) => { const b = await c.req.json(); const cl = await ensureClient(c.env, who(c), b.name); return cl ? c.json(cl) : c.json({ detail: "Client name is required." }, 400); });
app.patch("/api/clients/:id", async (c) => {
  const cl = await get(c.env.DB, "clients", +c.req.param("id"));
  if (!cl || cl.owner !== who(c)) return notFound(c, "Client");
  const b = await c.req.json(), patch = {};
  for (const f of ["industry", "notes", "ownership_rule", "resubmission_days", "active"]) if (b[f] !== undefined) patch[f] = b[f];
  if (Array.isArray(b.locations)) patch.locations = b.locations;
  if (Array.isArray(b.preferences)) patch.preferences = b.preferences.filter((x) => typeof x === "string" && x.trim());
  if (b.name && b.name.trim()) { patch.name = b.name.trim(); await c.env.DB.prepare("UPDATE mandates SET client_name = ? WHERE owner = ? AND client_name = ?").bind(patch.name, who(c), cl.name).run(); }
  await update(c.env.DB, "clients", cl.id, patch);
  await audit(c.env.DB, "client_updated", "client", cl.id, { fields: Object.keys(patch), user: who(c) });
  return c.json({ ...cl, ...patch });
});

/** Create immutable submissions for selected matches and return the pack. */
app.post("/api/mandates/:id/submissions", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const { match_ids = [], override = false } = await c.req.json();
  if (!match_ids.length) return c.json({ detail: "Select at least one candidate." }, 400);
  const r = await createSubmissions(c.env, who(c), md, match_ids.map(Number), who(c), !!override);
  return c.json(r);
});
app.get("/api/mandates/:id/submissions", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const subs = await all(c.env.DB, "submissions", "SELECT s.id, s.match_id, s.candidate_id, s.version, s.submitted_by, s.created_at, cd.name FROM submissions s JOIN candidates cd ON cd.id = s.candidate_id WHERE s.mandate_id = ? ORDER BY s.id DESC", md.id);
  return c.json(subs);
});
/** Printable pack: ?ids=1,2 (submission ids) or latest submission per match via ?matches=3,4 */
app.get("/api/mandates/:id/pack", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  let subs = [];
  if (c.req.query("ids")) { const ids = c.req.query("ids").split(",").map(Number).filter(Boolean); subs = ids.length ? await all(c.env.DB, "submissions", `SELECT * FROM submissions WHERE mandate_id = ? AND id IN (${ids.map(() => "?").join(",")})`, md.id, ...ids) : []; }
  else if (c.req.query("matches")) { for (const mid of c.req.query("matches").split(",").map(Number).filter(Boolean)) { const s = await one(c.env.DB, "submissions", "SELECT * FROM submissions WHERE mandate_id = ? AND match_id = ? ORDER BY version DESC LIMIT 1", md.id, mid); if (s) subs.push(s); } }
  if (!subs.length) return c.json({ detail: "No submissions found for that selection." }, 404);
  await audit(c.env.DB, "pack_viewed", "mandate", md.id, { submissions: subs.map((s) => s.id), user: who(c) });
  return c.html(renderPack(md, subs, c.env.RECRUITER_NAME || who(c)));
});

app.get("/api/candidates/:id/history", async (c) => {
  const cnd = await get(c.env.DB, "candidates", +c.req.param("id"));
  if (!cnd || (cnd.owner || "admin") !== who(c)) return notFound(c, "Candidate");
  return c.json(await candidateHistory(c.env, who(c), cnd.id));
});

/** Recruitment tracker (manual §8), CSV that opens in Excel. */
app.get("/api/mandates/:id/tracker", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const rows = await trackerRows(c.env, md, c.req.query("source") || "all");
  await audit(c.env.DB, "tracker_exported", "mandate", md.id, { rows: rows.length, user: who(c) });
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${md.code}-tracker.csv"` } });
});

// ------------------------------------------------------------------ Phase C/D: outreach, responses, interviews, feedback, offers, tasks, templates
app.get("/api/templates", async (c) => c.json(await ensureTemplates(c.env, who(c))));
app.post("/api/templates", async (c) => { const b = await c.req.json(); if (!b.kind || !b.name || !b.body) return c.json({ detail: "kind, name and body are required." }, 400);
  return c.json(await insert(c.env.DB, "templates", { owner: who(c), kind: b.kind, channel: b.channel === "whatsapp" ? "whatsapp" : "email", name: b.name, subject: b.subject || "", body: b.body })); });
app.patch("/api/templates/:id", async (c) => { const t = await get(c.env.DB, "templates", +c.req.param("id")); if (!t || t.owner !== who(c)) return notFound(c, "Template");
  const b = await c.req.json(), patch = {}; for (const k of ["name", "subject", "body", "channel", "kind"]) if (b[k] !== undefined) patch[k] = b[k]; await update(c.env.DB, "templates", t.id, patch); return c.json({ ...t, ...patch }); });
app.delete("/api/templates/:id", async (c) => { await c.env.DB.prepare("DELETE FROM templates WHERE id = ? AND owner = ? AND is_default = 0").bind(+c.req.param("id"), who(c)).run(); return c.json({ ok: true }); });

/** Draft messages for selected candidates (approval queue). */
app.post("/api/mandates/:id/outreach", async (c) => {
  const md = await ownedMandate(c, c.req.param("id"));
  if (!md) return notFound(c, "Mandate");
  const { match_ids = [], channel = "email", kind = "outreach", template_id = null } = await c.req.json();
  const drafts = [], skipped = [];
  for (const mid of match_ids.map(Number)) {
    const m = await get(c.env.DB, "matches", mid); if (!m || m.mandate_id !== md.id) continue;
    const cand = await get(c.env.DB, "candidates", m.candidate_id);
    try { drafts.push({ ...(await draftOutreach(c.env, who(c), md, m, cand, { channel, kind, template_id })), name: cand.name }); } catch (e) { skipped.push(`${cand.name}: ${e.message}`); }
  }
  return c.json({ drafts, skipped });
});
app.get("/api/mandates/:id/outreach", async (c) => {
  const md = await ownedMandate(c, c.req.param("id")); if (!md) return notFound(c, "Mandate");
  return c.json(await all(c.env.DB, "outreach", "SELECT o.*, cd.name FROM outreach o JOIN candidates cd ON cd.id = o.candidate_id WHERE o.mandate_id = ? ORDER BY o.id DESC", md.id));
});
app.patch("/api/outreach/:id", async (c) => {
  const o = await get(c.env.DB, "outreach", +c.req.param("id")); if (!o || o.owner !== who(c)) return notFound(c, "Message");
  const b = await c.req.json(), patch = {};
  if (o.status === "draft") for (const k of ["subject", "body", "to_address"]) if (b[k] !== undefined) patch[k] = b[k];
  if (b.status === "sent" && o.status === "approved") { patch.status = "sent"; patch.sent_at = new Date().toISOString().slice(0, 19).replace("T", " "); }  // recruiter sent it manually
  await update(c.env.DB, "outreach", o.id, patch);
  return c.json({ ...o, ...patch });
});
app.post("/api/outreach/:id/send", async (c) => {
  const o = await get(c.env.DB, "outreach", +c.req.param("id")); if (!o || o.owner !== who(c)) return notFound(c, "Message");
  if (!["draft", "approved", "failed"].includes(o.status)) return c.json({ detail: "This message was already sent." }, 400);
  return c.json(await sendOutreach(c.env, who(c), o, who(c)));
});
app.delete("/api/outreach/:id", async (c) => { await c.env.DB.prepare("DELETE FROM outreach WHERE id = ? AND owner = ? AND status = 'draft'").bind(+c.req.param("id"), who(c)).run(); return c.json({ ok: true }); });
/** Recruiter records a reply received by phone/email. */
app.post("/api/matches/:id/response", async (c) => {
  const m = await ownedMatch(c, c.req.param("id")); if (!m) return notFound(c, "Candidate");
  const { response, detail = {} } = await c.req.json();
  let o = await one(c.env.DB, "outreach", "SELECT * FROM outreach WHERE match_id = ? ORDER BY id DESC LIMIT 1", m.id);
  if (!o) { const md = await get(c.env.DB, "mandates", m.mandate_id), cd = await get(c.env.DB, "candidates", m.candidate_id);
    o = await insert(c.env.DB, "outreach", { owner: who(c), mandate_id: md.id, match_id: m.id, candidate_id: cd.id, channel: "phone", kind: "outreach", body: "(recorded by recruiter)", status: "sent", token: crypto.randomUUID().replace(/-/g, "") }); }
  try { return c.json(await recordResponse(c.env, o.token, response, { ...detail, recorded_by: who(c) })); } catch (e) { return c.json({ detail: e.message }, 400); }
});

// interviews
app.post("/api/interviews/extract", async (c) => { const { text } = await c.req.json(); if (!text || text.trim().length < 10) return c.json({ detail: "Paste the client's message first." }, 400); return c.json(await extractInterview(c.env, text)); });
app.get("/api/matches/:id/engagement", async (c) => {
  const m = await ownedMatch(c, c.req.param("id")); if (!m) return notFound(c, "Candidate");
  const [outreach, interviews, feedback, offer, tasks] = await Promise.all([
    all(c.env.DB, "outreach", "SELECT id, channel, kind, status, subject, response, response_detail, sent_at, responded_at, created_at, token, to_address FROM outreach WHERE match_id = ? ORDER BY id DESC", m.id),
    all(c.env.DB, "interviews", "SELECT * FROM interviews WHERE match_id = ? ORDER BY round, id", m.id),
    all(c.env.DB, "feedback", "SELECT * FROM feedback WHERE match_id = ? ORDER BY id DESC", m.id),
    one(c.env.DB, "offers", "SELECT * FROM offers WHERE match_id = ? ORDER BY id DESC LIMIT 1", m.id),
    all(c.env.DB, "tasks", "SELECT * FROM tasks WHERE match_id = ? AND done = 0 ORDER BY due_at", m.id)]);
  return c.json({ outreach, interviews, feedback, offer, tasks });
});
app.post("/api/matches/:id/interviews", async (c) => {
  const m = await ownedMatch(c, c.req.param("id")); if (!m) return notFound(c, "Candidate");
  const md = await get(c.env.DB, "mandates", m.mandate_id);
  const iv = await createInterview(c.env, who(c), md, m, await c.req.json(), who(c));
  return c.json(iv);
});
app.patch("/api/interviews/:id", async (c) => { const iv = await get(c.env.DB, "interviews", +c.req.param("id")); if (!iv || iv.owner !== who(c)) return notFound(c, "Interview"); return c.json(await updateInterview(c.env, iv, await c.req.json(), who(c))); });
/** Draft the candidate's interview confirmation message from the interview record. */
app.post("/api/interviews/:id/notify", async (c) => {
  const iv = await get(c.env.DB, "interviews", +c.req.param("id")); if (!iv || iv.owner !== who(c)) return notFound(c, "Interview");
  const m = await get(c.env.DB, "matches", iv.match_id), md = await get(c.env.DB, "mandates", iv.mandate_id), cd = await get(c.env.DB, "candidates", m.candidate_id);
  const { channel = "email" } = await c.req.json().catch(() => ({}));
  try { return c.json(await draftOutreach(c.env, who(c), md, m, cd, { channel, kind: "interview", interview: iv })); } catch (e) { return c.json({ detail: e.message }, 400); }
});
app.post("/api/matches/:id/feedback", async (c) => {
  const m = await ownedMatch(c, c.req.param("id")); if (!m) return notFound(c, "Candidate");
  const md = await get(c.env.DB, "mandates", m.mandate_id);
  try { return c.json(await recordFeedback(c.env, who(c), md, m, await c.req.json(), who(c))); } catch (e) { return c.json({ detail: e.message }, 400); }
});
app.post("/api/matches/:id/offer", async (c) => {
  const m = await ownedMatch(c, c.req.param("id")); if (!m) return notFound(c, "Candidate");
  const md = await get(c.env.DB, "mandates", m.mandate_id);
  return c.json(await upsertOffer(c.env, who(c), md, m, await c.req.json(), who(c)));
});
// tasks / today's actions
app.get("/api/today", async (c) => c.json(await todaysActions(c.env, who(c))));
app.post("/api/tasks", async (c) => { const b = await c.req.json(); if (!b.title) return c.json({ detail: "Title is required." }, 400); return c.json(await addTask(c.env, who(c), b.mandate_id || null, b.match_id || null, b.title, b.kind || "manual", b.due_at || new Date().toISOString().slice(0, 19).replace("T", " "))); });
app.patch("/api/tasks/:id", async (c) => { const t = await get(c.env.DB, "tasks", +c.req.param("id")); if (!t || t.owner !== who(c)) return notFound(c, "Task"); const b = await c.req.json();
  const patch = {}; if (b.done !== undefined) { patch.done = b.done ? 1 : 0; patch.done_at = b.done ? new Date().toISOString().slice(0, 19).replace("T", " ") : null; } if (b.due_at) patch.due_at = b.due_at; await update(c.env.DB, "tasks", t.id, patch); return c.json({ ...t, ...patch }); });
/** Mark a candidate's dynamic fields as re-verified (recruiter confirmed by phone). */
app.post("/api/candidates/:id/verify", async (c) => {
  const cnd = await get(c.env.DB, "candidates", +c.req.param("id")); if (!cnd || (cnd.owner || "admin") !== who(c)) return notFound(c, "Candidate");
  const b = await c.req.json().catch(() => ({})), patch = { last_verified_at: new Date().toISOString().slice(0, 19).replace("T", " ") };
  for (const k of ["ctc_current_lpa", "ctc_expected_lpa", "notice_days", "location", "preferred_location", "current_company", "current_title", "phone", "email"]) if (b[k] !== undefined && b[k] !== "") patch[k] = b[k];
  await update(c.env.DB, "candidates", cnd.id, patch); await audit(c.env.DB, "candidate_verified", "candidate", cnd.id, { fields: Object.keys(patch), user: who(c) });
  return c.json({ ...cnd, ...patch });
});

app.get("/api/dashboard", async (c) => c.json(await dashboard(c.env, c.req.query("mandate_id") ? +c.req.query("mandate_id") : null, who(c))));
app.get("/api/audit", async (c) => c.json(await all(c.env.DB, "audit_log", "SELECT * FROM audit_log ORDER BY id DESC LIMIT 200")));
app.all("/api/*", (c) => c.json({ detail: "Not found" }, 404));
// SPA fallback: any non-API, non-asset path gets the React app
app.get("*", async (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw)) : c.text("Not found", 404)));

export default {
  fetch: app.fetch,
  // Cron: finish AI verification for anything the request-time pass didn't reach, and retry queued sourcing jobs.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      await env.DB.prepare("UPDATE jobs SET status='queued' WHERE status='running' AND updated_at < datetime('now','-10 minutes')").run();
      const queued = await all(env.DB, "jobs", "SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 3");
      for (const j of queued) await runJob(env, j.id);
      await runDeepSweep(env, 4);
      for (const o of await all(env.DB, "mandates", "SELECT DISTINCT owner FROM mandates")) await learnWeights(env, o.owner || "admin").catch((e) => console.error("learn failed", e));
      await env.DB.prepare("DELETE FROM events WHERE created_at < datetime('now','-30 days')").run();
    })());
  },
};
