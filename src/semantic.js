// Semantic layer: one embedding per candidate profile and per mandate (JD). Used for talent-pool matching,
// lead scoring, the global "find people like…" search, and a semantic component inside the score.
import { cosine, embed, simToScore } from "./ai.js";
import { all, update } from "./db.js";

export function profileText(c, resumeText = "") {
  const head = (resumeText || c.resume_text || "").replace(/\s+/g, " ").slice(0, 1500);
  return [c.current_title, c.current_company, c.location, (c.top_skills || []).join(", "), c.education, head].filter(Boolean).join(". ");
}
export function jdText(spec) {
  return [spec.title, ...(spec.alt_titles || []), spec.summary, "Skills: " + (spec.skills || []).map((s) => s.name).join(", "),
    spec.industries?.length ? "Industry: " + spec.industries.join(", ") : "", spec.locations?.length ? "Location: " + spec.locations.join(", ") : ""].filter(Boolean).join(". ");
}

const parse = (v) => { if (!v) return null; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return null; } };

export async function ensureMandateEmbedding(env, mandate, force = false) {
  let vec = force ? null : parse(mandate.embedding);
  if (!vec) {
    const out = await embed(env, [jdText(mandate.spec)]);
    vec = out?.[0] || null;
    if (vec) await update(env.DB, "mandates", mandate.id, { embedding: JSON.stringify(vec) });
  }
  return vec;
}

export async function ensureCandidateEmbedding(env, cand, force = false) {
  let vec = force ? null : parse(cand.embedding);
  if (!vec) {
    const out = await embed(env, [profileText(cand)]);
    vec = out?.[0] || null;
    if (vec) await update(env.DB, "candidates", cand.id, { embedding: JSON.stringify(vec) });
  }
  return vec;
}

/** Similarity between a candidate and a mandate, or null when embeddings are unavailable. */
export async function semanticSim(env, mandate, cand) {
  const [a, b] = await Promise.all([ensureMandateEmbedding(env, mandate), ensureCandidateEmbedding(env, cand)]);
  return a && b ? Math.round(simToScore(cosine(a, b)) * 100) / 100 : null;
}

/** Rank all candidates by similarity to a free-text query (or a mandate). */
export async function semanticSearch(env, query, { limit = 25, exclude = new Set(), owner = null } = {}) {
  const q = (await embed(env, [query]))?.[0];
  if (!q) return { results: [], semantic: false };
  const cands = owner
    ? await all(env.DB, "candidates", "SELECT id, name, current_title, current_company, location, total_exp_years, top_skills, source, profile_url, resume_key, email, phone, embedding FROM candidates WHERE embedding IS NOT NULL AND owner = ? ORDER BY id DESC LIMIT 3000", owner)
    : await all(env.DB, "candidates", "SELECT id, name, current_title, current_company, location, total_exp_years, top_skills, source, profile_url, resume_key, email, phone, embedding FROM candidates WHERE embedding IS NOT NULL ORDER BY id DESC LIMIT 3000");
  const scored = [];
  for (const c of cands) {
    if (exclude.has(c.id)) continue;
    const v = parse(c.embedding);
    if (v) scored.push({ ...c, embedding: undefined, similarity: Math.round(cosine(q, v) * 1000) / 1000 });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return { results: scored.slice(0, limit), semantic: true };
}
