// "Show 10 profiles", "budget 9 LPA", "notice up to 60 days", "SAP is mandatory", "always prefer manufacturing for this client".
// The AI turns the sentence into a small JSON patch; a regex fallback covers the common numeric commands when AI is unavailable.
import { AIError, chatJson } from "./ai.js";
import { DEFAULT_WEIGHTS } from "./scoring.js";

const SYSTEM = `You convert a recruiter's instruction about a hiring mandate into a JSON patch. Return ONLY JSON with any of these keys (omit what the instruction doesn't mention):
{"top_n": integer, "min_exp": number, "max_exp": number, "ctc_min_lpa": number, "ctc_max_lpa": number, "notice_max_days": integer,
 "relocation_ok": boolean, "add_locations": [string], "remove_locations": [string],
 "add_skills": [{"name": string, "mandatory": boolean, "type": "skill"|"tool"}], "remove_skills": [string],
 "make_mandatory": [skill names], "make_preferred": [skill names],
 "add_industries": [string], "remove_industries": [string],
 "weight_multipliers": {"mandatory_skills"|"experience"|"title"|"preferred_skills"|"location"|"ctc"|"notice"|"industry"|"semantic": number between 0.25 and 3},
 "remember": boolean (true if the recruiter says always / from now on / for this client / remember),
 "summary": "one short sentence saying what will change"}
CTC is in lakhs per annum. "profiles", "candidates" or "resumes" with a number means top_n. Prefer/emphasise means a weight multiplier around 1.5; ignore/de-emphasise around 0.5.`;

export function fallbackParse(text) {
  const t = text.toLowerCase(), patch = {};
  let m = t.match(/(\d{1,3})\s*(?:top\s*)?(?:profiles?|candidates?|resumes?|people|results)/) || t.match(/top\s*(\d{1,3})/);
  if (m) patch.top_n = parseInt(m[1], 10);
  m = t.match(/(?:budget|ctc|salary|package)[^\d]{0,15}(\d{1,2}(?:\.\d)?)\s*(?:-|to)?\s*(\d{1,2}(?:\.\d)?)?\s*(?:lpa|lakh|l\b)?/);
  if (m) { if (m[2]) { patch.ctc_min_lpa = +m[1]; patch.ctc_max_lpa = +m[2]; } else patch.ctc_max_lpa = +m[1]; }
  m = t.match(/notice[^\d]{0,20}(\d{1,3})\s*(days?|months?)?/);
  if (m) patch.notice_max_days = parseInt(m[1], 10) * (/month/.test(m[2] || "") ? 30 : 1);
  m = t.match(/(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:years?|yrs?)/);
  if (m) { patch.min_exp = +m[1]; patch.max_exp = +m[2]; }
  else { m = t.match(/(?:at least|minimum|min)\s*(\d{1,2})\s*(?:years?|yrs?)/); if (m) patch.min_exp = +m[1]; }
  m = t.match(/(?:add|include)\s+(?:skill\s+)?([a-z0-9 .#+]+?)\s+(?:as\s+)?(mandatory|preferred)/);
  if (m) patch.add_skills = [{ name: m[1].trim(), mandatory: m[2] === "mandatory", type: "skill" }];
  m = t.match(/([a-z0-9 .#+]+?)\s+is\s+(mandatory|required|must)/);
  if (m) patch.make_mandatory = [m[1].trim()];
  const CRIT = { experience: "experience", location: "location", notice: "notice", ctc: "ctc", salary: "ctc", budget: "ctc", title: "title", industry: "industry", skills: "mandatory_skills", skill: "mandatory_skills", similarity: "semantic", semantic: "semantic" };
  m = t.match(/\b(prefer|emphasi[sz]e|prioriti[sz]e|weight|focus on|ignore|de-?emphasi[sz]e|downplay)\s+(?:candidates?\s+(?:from|with|in)\s+)?([a-z][a-z .&-]{2,30}?)(?=\s+(?:for|going|from|always)\b|[.,!]|$)/);
  if (m) {
    const boost = !/ignore|de-?emphasi|downplay/.test(m[1]), words = m[2].trim();
    const crit = Object.keys(CRIT).find((k) => words.includes(k));
    if (crit) patch.weight_multipliers = { [CRIT[crit]]: boost ? 1.5 : 0.5 };
    else if (boost) { patch.add_industries = [words.replace(/\b\w/g, (c) => c.toUpperCase())]; patch.weight_multipliers = { industry: 1.5 }; }
    else patch.remove_industries = [words];
  }
  if (/\b(always|from now on|remember|for this client|going forward)\b/.test(t)) patch.remember = true;
  if (/relocat/.test(t)) patch.relocation_ok = !/no relocation|local only|don't relocate|no relocat/.test(t);
  return patch;
}

export async function parseCommand(env, text) {
  try {
    const p = await chatJson(env, SYSTEM, "Instruction: " + text.slice(0, 600), 400);
    if (!p.top_n && !p.ctc_max_lpa && !p.notice_max_days && !p.add_skills && !p.weight_multipliers) Object.assign(p, fallbackParse(text), p); // AI missed numbers -> merge
    return { patch: p, via: "ai" };
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    return { patch: fallbackParse(text), via: "rules" };
  }
}

/** Apply a patch to a mandate's spec/top_n. Returns { spec, top_n, applied: [human-readable lines] }. */
export function applyPatch(mandate, patch) {
  const spec = JSON.parse(JSON.stringify(mandate.spec)), applied = [];
  let topN = mandate.top_n || 5;
  const lower = (s) => String(s).toLowerCase();
  if (Number.isFinite(+patch.top_n) && +patch.top_n > 0) { topN = Math.min(100, Math.round(+patch.top_n)); applied.push(`Show top ${topN} profiles`); }
  for (const f of ["min_exp", "max_exp", "ctc_min_lpa", "ctc_max_lpa", "notice_max_days"]) {
    if (patch[f] != null && Number.isFinite(+patch[f])) { spec[f] = +patch[f]; applied.push(`${label(f)} → ${+patch[f]}`); }
  }
  if (typeof patch.relocation_ok === "boolean") { spec.relocation_ok = patch.relocation_ok; applied.push(patch.relocation_ok ? "Relocation allowed" : "Local candidates only"); }
  for (const l of patch.add_locations || []) if (l && !spec.locations.some((x) => lower(x) === lower(l))) { spec.locations.push(l); applied.push(`Location + ${l}`); }
  for (const l of patch.remove_locations || []) { const n = spec.locations.length; spec.locations = spec.locations.filter((x) => lower(x) !== lower(l)); if (spec.locations.length < n) applied.push(`Location − ${l}`); }
  for (const i of patch.add_industries || []) if (i && !spec.industries.some((x) => lower(x) === lower(i))) { spec.industries.push(i); applied.push(`Industry + ${i}`); }
  for (const i of patch.remove_industries || []) { const n = spec.industries.length; spec.industries = spec.industries.filter((x) => lower(x) !== lower(i)); if (spec.industries.length < n) applied.push(`Industry − ${i}`); }
  for (const s of patch.add_skills || []) {
    const name = (s?.name || s || "").toString().trim();
    if (!name) continue;
    const ex = spec.skills.find((x) => lower(x.name) === lower(name));
    if (ex) { ex.mandatory = !!s.mandatory; applied.push(`${name} → ${ex.mandatory ? "mandatory" : "preferred"}`); }
    else { spec.skills.push({ name, type: s.type === "tool" ? "tool" : "skill", mandatory: !!s.mandatory, aliases: [] }); applied.push(`Skill + ${name} (${s.mandatory ? "mandatory" : "preferred"})`); }
  }
  for (const n of patch.remove_skills || []) { const k = spec.skills.length; spec.skills = spec.skills.filter((x) => lower(x.name) !== lower(n)); if (spec.skills.length < k) applied.push(`Skill − ${n}`); }
  for (const n of patch.make_mandatory || []) { const x = spec.skills.find((s) => lower(s.name) === lower(n)); if (x && !x.mandatory) { x.mandatory = true; applied.push(`${x.name} → mandatory`); } }
  for (const n of patch.make_preferred || []) { const x = spec.skills.find((s) => lower(s.name) === lower(n)); if (x && x.mandatory) { x.mandatory = false; applied.push(`${x.name} → preferred`); } }
  if (patch.weight_multipliers && typeof patch.weight_multipliers === "object") {
    spec.weights = { ...(spec.weights || {}) };
    for (const [k, mult] of Object.entries(patch.weight_multipliers)) {
      if (!(k in DEFAULT_WEIGHTS) || !Number.isFinite(+mult)) continue;
      const m = Math.max(0.25, Math.min(3, +mult));
      spec.weights[k] = Math.round((spec.weights[k] ?? DEFAULT_WEIGHTS[k]) * m);
      applied.push(`${label(k)} weight ×${m}`);
    }
  }
  return { spec, top_n: topN, applied };
}

const LABELS = { min_exp: "Min experience", max_exp: "Max experience", ctc_min_lpa: "CTC min (LPA)", ctc_max_lpa: "CTC budget (LPA)", notice_max_days: "Max notice (days)",
  mandatory_skills: "Mandatory skills", preferred_skills: "Preferred skills", experience: "Experience", title: "Title", location: "Location", ctc: "CTC", notice: "Notice", industry: "Industry", semantic: "Profile similarity" };
const label = (k) => LABELS[k] || k;

/** Strip the mandate-specific bits so a remembered rule can be re-applied to future mandates for the same client. */
export function reusablePatch(patch) {
  const keep = ["top_n", "notice_max_days", "relocation_ok", "add_skills", "make_mandatory", "make_preferred", "add_industries", "remove_industries", "weight_multipliers"];
  const out = {};
  for (const k of keep) if (patch[k] !== undefined) out[k] = patch[k];
  return out;
}
