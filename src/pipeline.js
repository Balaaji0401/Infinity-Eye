import { chatJson, embed, cosine, AIError, chatProvider } from "./ai.js";
export const SCORING_VERSION = "scoring-v2";
export const modelStamp = (env, deep = false) => `${SCORING_VERSION}${deep ? `; ${chatProvider(env)}:${chatProvider(env) === "codecraft" ? env.LLM_MODEL || "deepseek-v4-flash-0731" : env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8-fast"}` : ""}`;
import { all, audit, get, insert, one, update } from "./db.js";
import { fastFacts, norm, titleSimilarity } from "./parsing.js";
import { rankKey, scoreCandidate, screeningQuestions } from "./scoring.js";
import { ensureCandidateEmbedding, semanticSim } from "./semantic.js";

export const ALLOWED = new Set([".pdf", ".docx", ".txt"]);
const CAND_FIELDS = ["name", "email", "phone", "current_title", "current_company", "location", "total_exp_years", "ctc_current_lpa", "ctc_expected_lpa", "notice_days", "education"];

export function topSkills(spec, facts, extra = []) {
  const found = facts.skills_found || {};
  const mand = spec.skills.filter((s) => s.mandatory && found[s.name]).map((s) => s.name);
  const pref = spec.skills.filter((s) => !s.mandatory && found[s.name]).map((s) => s.name);
  return [...new Set([...mand, ...pref, ...(extra || []).filter(Boolean)])].slice(0, 8);
}

/** Compute score/band/checklist for a match. Returns the fields to persist. */
export function scoredFields(match, spec, facts, titleSim = null) {
  const res = scoreCandidate(spec, facts, titleSim);
  const llmQs = (match.questions || []).filter((q) => q.startsWith("•"));
  return {
    facts, score: res.score, checklist: res.checklist,
    band: match.kind === "lead" && match.origin !== "naukri" && !facts.structured ? "Lead" : res.band,   // structured profile data earns a real band
    gaps: [...res.gates, ...res.gaps.filter((g) => !res.gates.includes(g))],
    questions: [...screeningQuestions(spec, res), ...llmQs],
  };
}

export function candidateFields(facts, spec, existingSkills = [], extra = []) {
  const o = {};
  for (const f of CAND_FIELDS) if (facts[f] !== undefined && facts[f] !== null && facts[f] !== "") o[f] = facts[f];
  o.top_skills = topSkills(spec, facts, [...extra, ...existingSkills]);
  return o;
}

export async function sha256(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findDuplicate(db, facts, hash, owner) {
  if (hash) { const c = await one(db, "candidates", "SELECT * FROM candidates WHERE file_hash = ? AND owner = ?", hash, owner); if (c) return c; }
  if (facts.email) { const c = await one(db, "candidates", "SELECT * FROM candidates WHERE email = ? AND owner = ?", facts.email, owner); if (c) return c; }
  if (facts.phone) { const c = await one(db, "candidates", "SELECT * FROM candidates WHERE phone = ? AND owner = ?", facts.phone, owner); if (c) return c; }
  return null;
}

export async function ensureMatch(db, mandateId, candidateId, origin, kind = "resume") {
  let m = await one(db, "matches", "SELECT * FROM matches WHERE mandate_id = ? AND candidate_id = ?", mandateId, candidateId);
  if (!m) m = await insert(db, "matches", { mandate_id: mandateId, candidate_id: candidateId, origin, kind, stage: kind === "lead" ? "lead" : "provisional", questions: [], status: "Sourced", model: SCORING_VERSION });
  return m;
}

/**
 * Ingest one resume whose text was already extracted (in the browser). Stores the file in R2.
 */
export async function ingestResume(env, mandate, { text, filename, bytes, source }) {
  const db = env.DB;
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (!ALLOWED.has(ext)) return { skipped: filename };
  const hash = bytes ? await sha256(bytes) : await sha256(new TextEncoder().encode(text || filename));
  const key = `resumes/${hash.slice(0, 24)}${ext}`;
  if (bytes && env.FILES) {
    if (!(await env.FILES.head(key))) await env.FILES.put(key, bytes, { httpMetadata: { contentType: contentType(ext) } });
  }
  const spec = mandate.spec;
  const facts = fastFacts(text || "", spec, filename);
  const owner = mandate.owner || "admin";
  let cand = await findDuplicate(db, facts, hash, owner);
  const duplicate = cand ? { candidate_id: cand.id, name: cand.name, same_file: cand.file_hash === hash, via: cand.file_hash === hash ? "same file" : cand.email && cand.email === facts.email ? "same email" : "same phone" } : null;
  const base = { resume_key: bytes ? key : null, resume_filename: filename, resume_text: text || "", file_hash: hash, last_verified_at: new Date().toISOString().slice(0, 19).replace("T", " "), ...candidateFields(facts, spec, cand?.top_skills || []) };
  if (!cand) cand = await insert(db, "candidates", { source, owner, ...base });
  else {
    if (["linkedin", "github"].includes(cand.source)) base.source = source;
    await update(db, "candidates", cand.id, base);
    cand = { ...cand, ...base };
  }
  await ensureCandidateEmbedding(env, { ...cand, resume_text: text || "" }, true);
  const sim = await semanticSim(env, mandate, cand);
  if (sim !== null) facts.semantic_sim = sim;
  const match = await ensureMatch(db, mandate.id, cand.id, source);
  let fields;
  if (!(text || "").trim()) {
    fields = { kind: "resume", stage: "provisional", deep_done: 1, deep_error: "", facts, score: 0, band: "Review",
      gaps: ["No text could be read from this file (possibly a scanned image). Open the resume and review manually."], checklist: [], questions: [] };
  } else {
    fields = { kind: "resume", stage: "provisional", deep_done: 0, deep_error: "", ...scoredFields({ ...match, kind: "resume" }, spec, facts) };
  }
  await update(db, "matches", match.id, fields);
  await audit(db, "candidate_ingested", "match", match.id, { file: filename, source, duplicate: !!duplicate });
  return { match: { ...match, ...fields }, candidate: cand, duplicate };
}

const contentType = (ext) => ({ ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain" }[ext] || "application/octet-stream");

// ------------------------------------------------------------------ deep (AI) pass
const DEEP_SYSTEM = `You extract facts from a resume for a recruiter. Return ONLY JSON.
For every fact give the value AND "quote": a short exact phrase copied verbatim from the resume that proves it.
If a fact is not in the resume use null. Never guess, never infer age, gender, religion, caste or marital status.`;

const deepPrompt = (spec, text) => `Target role: ${spec.title}
Skills to look for: ${spec.skills.map((s) => s.name).join(", ") || "none listed"}

Return JSON:
{"name": {"value": str|null, "quote": str|null},
 "current_title": {"value": str|null, "quote": str|null},
 "current_company": {"value": str|null, "quote": str|null},
 "total_experience_years": {"value": number|null, "quote": str|null},
 "location": {"value": str|null, "quote": str|null},
 "current_ctc_lpa": {"value": number|null, "quote": str|null},
 "expected_ctc_lpa": {"value": number|null, "quote": str|null},
 "notice_period_days": {"value": number|null, "quote": str|null},
 "industries": {"value": [str], "quote": str|null},
 "skills": [{"name": "<one of the skills to look for>", "quote": "<exact phrase>"}],
 "other_top_skills": [up to 5 other strong skills],
 "summary": "two factual sentences about this candidate's fit for the target role",
 "questions": [two short screening questions about unclear points]}

Resume:
"""${text.slice(0, 7000)}"""`;

export function verifyQuote(quote, text) {
  if (!quote || String(quote).trim().length < 3) return false;
  const q = norm(String(quote)), t = norm(text);
  if (q && t.includes(q)) return true;
  const toks = q.split(" ").filter((w) => w.length > 2 || /\d/.test(w));
  if (toks.length < 3) return false;
  const tset = new Set(t.split(" "));
  if (toks.some((w) => /\d/.test(w) && !tset.has(w))) return false;   // numbers must match exactly
  return toks.filter((w) => tset.has(w)).length / toks.length >= 0.9;
}

const FIELD_MAP = { name: "name", current_title: "current_title", current_company: "current_company", total_experience_years: "total_exp_years",
  location: "location", current_ctc_lpa: "ctc_current_lpa", expected_ctc_lpa: "ctc_expected_lpa", notice_period_days: "notice_days" };

export function mergeDeep(facts, deep, text, spec) {
  facts = { ...facts, evidence: { ...(facts.evidence || {}) }, verified: { ...(facts.verified || {}) }, skills_found: { ...(facts.skills_found || {}) } };
  for (const [key, field] of Object.entries(FIELD_MAP)) {
    const item = deep[key];
    if (!item || typeof item !== "object") continue;
    let val = item.value;
    const quote = item.quote;
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && !val.length)) continue;
    if (["total_exp_years", "ctc_current_lpa", "ctc_expected_lpa"].includes(field)) { val = parseFloat(val); if (isNaN(val)) continue; }
    if (field === "notice_days") { val = parseInt(val, 10); if (isNaN(val)) continue; }
    const ok = verifyQuote(quote, text);
    if (facts[field] != null && facts.verified[field] && !ok) continue;
    if (ok || facts[field] == null) { facts[field] = val; facts.evidence[field] = quote || ""; facts.verified[field] = ok; }
  }
  const inds = deep.industries;
  if (inds && typeof inds === "object" && Array.isArray(inds.value) && inds.value.length && !facts.industries_found) {
    const wanted = (spec.industries || []).map((i) => i.toLowerCase());
    const hit = inds.value.filter((i) => wanted.some((w) => w.includes(String(i).toLowerCase()) || String(i).toLowerCase().includes(w)));
    if (hit.length) { facts.industries_found = hit; facts.evidence.industries = inds.quote || ""; facts.verified.industries = verifyQuote(inds.quote, text); }
  }
  const names = Object.fromEntries(spec.skills.map((s) => [s.name.toLowerCase(), s.name]));
  for (const s of deep.skills || []) {
    if (!s || typeof s !== "object") continue;
    const canonical = names[String(s.name || "").toLowerCase()];
    if (canonical && !facts.skills_found[canonical]) facts.skills_found[canonical] = { evidence: s.quote || "", verified: verifyQuote(s.quote, text) };
  }
  return facts;
}

export async function computeTitleSim(env, spec, facts) {
  const ct = facts.current_title;
  if (!ct) return null;
  const targets = [spec.title, ...(spec.alt_titles || [])];
  const token = titleSimilarity(targets, ct);
  const vecs = await embed(env, [ct, ...targets]);
  if (vecs) {
    let sem = Math.max(...vecs.slice(1).map((v) => cosine(vecs[0], v)));
    sem = Math.max(0, Math.min(1, (sem - 0.45) / 0.45));
    return Math.round(Math.max(token, sem) * 100) / 100;
  }
  return Math.round(token * 100) / 100;
}

export async function deepExtract(env, match) {
  const db = env.DB;
  const cand = await get(db, "candidates", match.candidate_id), mandate = await get(db, "mandates", match.mandate_id);
  const text = cand.resume_text || "";
  let deep;
  try { deep = await chatJson(env, DEEP_SYSTEM, deepPrompt(mandate.spec, text), 900); }
  catch (e) { await update(db, "matches", match.id, { deep_done: 1, deep_error: String(e.message || e).slice(0, 300) }); return; }
  const facts = mergeDeep(match.facts || {}, deep, text, mandate.spec);
  const tsim = await computeTitleSim(env, mandate.spec, facts);
  const extra = (deep.other_top_skills || []).filter((s) => typeof s === "string");
  await update(db, "candidates", cand.id, candidateFields(facts, mandate.spec, cand.top_skills || [], extra));
  const llmQs = (deep.questions || []).filter((q) => typeof q === "string" && q.trim()).slice(0, 2).map((q) => "• " + q.trim());
  const fields = scoredFields({ ...match, questions: llmQs }, mandate.spec, facts, tsim);
  await update(db, "matches", match.id, { ...fields, summary: typeof deep.summary === "string" ? deep.summary.trim() : "", stage: "verified", deep_done: 1, deep_error: "", model: modelStamp(env, true),
    ...(match.status === "Sourced" ? { status: "AI Analysed" } : {}) });
  await audit(db, "deep_screened", "match", match.id, { score: fields.score, band: fields.band });
}

/** Best un-screened resume inside its mandate's top N (by band, then score). */
export async function nextDeepCandidate(env) {
  const db = env.DB, topN = parseInt(env.DEEP_TOP_N || "15", 10);
  const pending = (await all(db, "matches", "SELECT m.* FROM matches m JOIN mandates md ON md.id = m.mandate_id WHERE m.kind='resume' AND m.deep_done=0 AND md.status='open'")).sort(rankKey);
  for (const m of pending) {
    const ranked = (await all(db, "matches", "SELECT id, band, score FROM matches WHERE mandate_id = ? AND kind='resume'", m.mandate_id)).sort(rankKey);
    if (ranked.findIndex((x) => x.id === m.id) < topN) return m;
  }
  return null;
}

export async function runDeepSweep(env, max = 3) {
  let n = 0;
  for (; n < max; n++) {
    const m = await nextDeepCandidate(env);
    if (!m) break;
    await deepExtract(env, m);
  }
  return n;
}

/** Re-run fast pass + scoring after the recruiter edits the spec. */
export async function rescoreMandate(env, mandate) {
  const db = env.DB;
  for (const m of await all(db, "matches", "SELECT * FROM matches WHERE mandate_id = ?", mandate.id)) {
    const c = await get(db, "candidates", m.candidate_id);
    const facts = fastFacts(c.resume_text || "", mandate.spec, c.resume_filename || "");
    const old = m.facts || {};
    const sim = await semanticSim(env, mandate, c);
    if (sim !== null) facts.semantic_sim = sim;
    for (const f of ["current_company", "ctc_current_lpa", "ctc_expected_lpa", "notice_days", "total_exp_years", "location", "name", "current_title"]) {
      if (facts[f] == null && old[f] != null) { facts[f] = old[f]; facts.evidence[f] = old.evidence?.[f] || ""; facts.verified[f] = old.verified?.[f] || false; }
      else if (facts[f] == null && m.kind === "lead" && c[f] != null) { facts[f] = c[f]; facts.evidence[f] = m.origin === "naukri" ? "From Naukri export" : "From public profile search result"; facts.verified[f] = true; }
    }
    const fields = scoredFields(m, mandate.spec, facts, facts.title_sim);
    await update(db, "matches", m.id, m.kind === "resume" && c.resume_text ? { ...fields, deep_done: 0, stage: "provisional" } : fields);
  }
}
