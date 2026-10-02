// Legitimate sourcing channels: search-engine discovery (Serper), GitHub public API, own talent pool.
import { all, audit, insert, one, update } from "./db.js";
import { CITIES, canonicalCity, esc, fastFacts } from "./parsing.js";
import { candidateFields, ensureMatch, scoredFields } from "./pipeline.js";
import { scoreCandidate } from "./scoring.js";
import { cosine, embed, simToScore } from "./ai.js";
import { ensureCandidateEmbedding, ensureMandateEmbedding, semanticSim } from "./semantic.js";

export class SourcingError extends Error {}

export async function serperSearch(env, query, num = 10) {
  if (!env.SERPER_API_KEY) throw new SourcingError("SERPER_API_KEY secret is not set");
  const r = await fetch("https://google.serper.dev/search", { method: "POST",
    headers: { "X-API-KEY": env.SERPER_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q: query, num, gl: "in" }) });
  if (!r.ok) throw new SourcingError(`Search API returned ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json()).organic || [];
}

/** Exa neural search (free key at exa.ai). Returns items shaped like Serper organic results. */
export async function exaSearch(env, query, num = 10) {
  if (!env.EXA_API_KEY) throw new SourcingError("EXA_API_KEY secret is not set");
  const r = await fetch("https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, type: "neural", numResults: num, includeDomains: ["linkedin.com", "in.linkedin.com"], contents: { text: { maxCharacters: 600 } } }) });
  if (!r.ok) throw new SourcingError(`Exa returned ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return ((await r.json()).results || []).map((x) => ({ title: x.title || "", link: x.url, snippet: (x.text || x.highlights?.join(" ") || "").replace(/\s+/g, " ").slice(0, 400) }));
}

export const searchProviders = (env) => (env.SEARCH_PROVIDER ? env.SEARCH_PROVIDER.split(",").map((s) => s.trim()) : [env.SERPER_API_KEY && "serper", env.EXA_API_KEY && "exa"].filter(Boolean));

export function parseLinkedinResult(item) {
  const link = item.link || "";
  if (!link.includes("linkedin.com/in/")) return null;
  const title = (item.title || "").replace(/\s*[|\-–]\s*LinkedIn\s*$/, "").trim();
  const parts = title.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const snippet = item.snippet || "";
  const m = /Location:\s*([^·\n]+)/.exec(snippet);
  const blob = (m ? m[1] : "") + " " + snippet + " " + title;
  let loc = null;
  for (const c of CITIES) if (new RegExp("\\b" + esc(c) + "\\b", "i").test(blob)) { loc = canonicalCity(c); break; }
  return { name: parts[0].slice(0, 120), headline: (parts[1] || "").slice(0, 160), company: (parts[2] || "").slice(0, 160), location: loc, url: link.split("?")[0], snippet };
}

export function outreachMessage(env, spec, name, skills) {
  const first = (name || "there").split(/\s+/)[0];
  const loc = spec.locations?.[0], ind = spec.industries?.[0];
  const skillTxt = skills?.length ? skills.slice(0, 2).join(", ") : "your background";
  return `Hi ${first}, I'm hiring for a ${spec.title} role${ind ? ` with a ${ind} company` : ""}${loc ? ` in ${loc}` : ""}. Your experience with ${skillTxt} looks like a strong fit. Would you be open to a quick chat this week? — ${env.RECRUITER_NAME || "Neurosaur"}`;
}

async function upsertLead(env, mandate, source, { name, title, company, location, url, text }) {
  const db = env.DB, owner = mandate.owner || "admin";
  let cand = url ? await one(db, "candidates", "SELECT * FROM candidates WHERE profile_url = ? AND owner = ?", url, owner) : null;
  const patch = { name: cand?.name || name, current_title: cand?.current_title || title, current_company: cand?.current_company || company,
    location: cand?.location || location, resume_text: cand?.resume_text || text };
  if (!cand) cand = await insert(db, "candidates", { source, owner, profile_url: url, ...patch });
  else { await update(db, "candidates", cand.id, patch); cand = { ...cand, ...patch }; }
  const spec = mandate.spec;
  const facts = fastFacts(text, spec, "");
  for (const [f, v] of [["name", name], ["current_title", title], ["current_company", company], ["location", location]])
    if (v) { facts[f] = v; facts.evidence[f] = "From public profile search result"; facts.verified[f] = true; }
  const kind = cand.resume_key ? "resume" : "lead";
  const match = await ensureMatch(db, mandate.id, cand.id, source, kind);
  if (kind === "lead") {
    await ensureCandidateEmbedding(env, cand, true);
    const sim = await semanticSim(env, mandate, cand);
    if (sim !== null) facts.semantic_sim = sim;
    const fields = scoredFields({ ...match, kind }, spec, facts, facts.title_sim);
    const cf = candidateFields(facts, spec, cand.top_skills || []);
    await update(db, "candidates", cand.id, cf);
    await update(db, "matches", match.id, { ...fields, outreach: outreachMessage(env, spec, cand.name, cf.top_skills) });
  }
  return match;
}

export async function runXray(env, mandate) {
  const plan = mandate.search_plan || {}, seen = new Set();
  let added = 0;
  const providers = searchProviders(env);
  if (!providers.length) throw new SourcingError("Set SERPER_API_KEY or EXA_API_KEY to search public profiles");
  const queries = (plan.xray_queries || []).slice(0, 3);
  const jobs = [];
  for (const q of queries) {
    if (providers.includes("serper")) jobs.push(serperSearch(env, q, 10));
    if (providers.includes("exa")) jobs.push(exaSearch(env, `${mandate.spec.title} ${(mandate.spec.locations || []).join(" ")} ${q.replace(/site:\S+/, "")}`, 10).catch((e) => { console.warn("exa", e.message); return []; }));
  }
  for (const items of await Promise.all(jobs)) {
    for (const item of items) {
      const lead = parseLinkedinResult(item);
      if (!lead || seen.has(lead.url)) continue;
      seen.add(lead.url);
      await upsertLead(env, mandate, "linkedin", { ...lead, title: lead.headline, text: [lead.headline, lead.company, lead.snippet].join("\n") });
      added++;
    }
  }
  await audit(env.DB, "xray_search", "mandate", mandate.id, { results: added });
  return added;
}

export async function runGithub(env, mandate) {
  const q = (mandate.search_plan || {}).github_query;
  if (!q) return 0;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "infinity-eye" };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=10`, { headers });
  if (!r.ok) throw new SourcingError(`GitHub API returned ${r.status}`);
  let added = 0;
  for (const u of ((await r.json()).items || []).slice(0, 10)) {
    const d = await fetch(u.url, { headers });
    if (!d.ok) continue;
    const p = await d.json();
    let loc = null;
    for (const c of CITIES) if (p.location && new RegExp("\\b" + esc(c) + "\\b", "i").test(p.location)) { loc = canonicalCity(c); break; }
    const m = await upsertLead(env, mandate, "github", { name: p.name || p.login, title: (p.bio || "").slice(0, 160), company: (p.company || "").replace(/^@/, ""),
      location: loc, url: p.html_url, text: [p.bio, p.company, p.location, p.blog].filter(Boolean).join("\n") });
    if (p.email) await update(env.DB, "candidates", m.candidate_id, { email: p.email });
    added++;
  }
  await audit(env.DB, "github_search", "mandate", mandate.id, { results: added });
  return added;
}

/** Score every existing candidate against this mandate; keep the good ones. */
export async function runPool(env, mandate) {
  const db = env.DB, minScore = parseFloat(env.POOL_MIN_SCORE || "5");
  const existing = new Set((await all(db, "matches", "SELECT candidate_id FROM matches WHERE mandate_id = ?", mandate.id)).map((m) => m.candidate_id));
  let cands = await all(db, "candidates", "SELECT * FROM candidates WHERE resume_text <> '' AND owner = ? ORDER BY id DESC LIMIT 2000", mandate.owner || "admin");
  // semantic first: rank the whole pool by similarity to the JD, then run the deterministic scorer on the closest 300
  const jd = await ensureMandateEmbedding(env, mandate);
  const sims = new Map();
  if (jd) {
    for (const c of cands) { let v = null; try { v = c.embedding ? JSON.parse(c.embedding) : null; } catch {} if (v) sims.set(c.id, Math.round(simToScore(cosine(jd, v)) * 100) / 100); }
    cands.sort((a, b) => (sims.get(b.id) ?? -1) - (sims.get(a.id) ?? -1));
  }
  cands = cands.slice(0, 300);
  let added = 0;
  for (const c of cands) {
    if (existing.has(c.id)) continue;
    const facts = fastFacts(c.resume_text, mandate.spec, c.resume_filename || "");
    if (sims.has(c.id)) facts.semantic_sim = sims.get(c.id);
    if (c.source === "naukri" && !c.resume_key) facts.structured = true;
    for (const f of ["ctc_current_lpa", "ctc_expected_lpa", "notice_days", "total_exp_years", "location", "current_title", "current_company", "name"])
      if (facts[f] == null && c[f] != null) { facts[f] = c[f]; facts.evidence[f] = "From earlier screening"; facts.verified[f] = false; }
    if (scoreCandidate(mandate.spec, facts).score < minScore) continue;
    const kind = c.resume_key ? "resume" : "lead";
    const m = await ensureMatch(db, mandate.id, c.id, "pool", kind);
    const fields = scoredFields({ ...m, kind }, mandate.spec, facts, facts.title_sim);
    await update(db, "matches", m.id, kind === "lead" ? { ...fields, outreach: outreachMessage(env, mandate.spec, c.name, c.top_skills || []) } : fields);
    added++;
  }
  await audit(db, "pool_search", "mandate", mandate.id, { results: added });
  return added;
}
