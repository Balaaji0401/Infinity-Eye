// Import of Naukri Resdex search exports (Excel/CSV the recruiter downloads from Resdex).
// Rows arrive as plain objects keyed by the sheet's headers; we map headers by keyword.
import { audit, insert, one, update } from "./db.js";
import { fastFacts, parseAmountLpa, canonicalCity, CITIES, esc, titleSimilarity } from "./parsing.js";
import { scoreCandidate } from "./scoring.js";
import { candidateFields, ensureMatch, scoredFields } from "./pipeline.js";
import { outreachMessage } from "./sourcing.js";
import { ensureCandidateEmbedding, semanticSim } from "./semantic.js";

const HEADERS = {
  name: [/^(candidate\s*)?name$/i, /full\s*name/i, /^candidate$/i],
  title: [/designation/i, /current\s*(job\s*)?title/i, /^title$/i, /role/i],
  company: [/company|employer|organi[sz]ation/i],
  experience: [/experience|^exp\b|^exp\./i],
  location: [/current\s*location|^location|city/i],
  ctc_current: [/current\s*(ctc|salary|package)|^ctc$|annual\s*salary/i],
  ctc_expected: [/expected\s*(ctc|salary|package)/i],
  notice: [/notice/i],
  last_active: [/last\s*(active|modified|updated|login)|modified/i],
  active: [/active|job\s*status|looking|availability/i],
  email: [/e-?mail/i],
  phone: [/phone|mobile|contact\s*(no|number)/i],
  profile_url: [/url|link|profile\s*id|resdex\s*id/i],
  skills: [/skills?|keyword/i],
  education: [/education|qualification|degree/i],
  summary: [/summary|headline|profile\s*summary|about/i],
};

export function mapHeaders(headers) {
  const map = {};
  for (const h of headers) {
    const clean = String(h || "").trim();
    for (const [field, pats] of Object.entries(HEADERS)) {
      if (map[field]) continue;
      if (pats.some((p) => p.test(clean))) { map[field] = h; break; }
    }
  }
  return map;
}

const num = (v) => { if (v == null || v === "") return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };

export function normalizeRow(row, map) {
  const g = (f) => (map[f] != null ? row[map[f]] : undefined);
  const s = (v) => (v == null ? "" : String(v).trim());
  const out = { name: s(g("name")), title: s(g("title")), company: s(g("company")), location: null, skills: s(g("skills")),
    email: s(g("email")).toLowerCase() || null, phone: s(g("phone")).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || null,
    profile_url: s(g("profile_url")) || null, education: s(g("education")) || null, summary: s(g("summary")) };
  const loc = s(g("location"));
  for (const c of CITIES) if (new RegExp("\\b" + esc(c) + "\\b", "i").test(loc)) { out.location = canonicalCity(c); break; }
  if (!out.location && loc) out.location = loc.split(/[,/]/)[0].trim().slice(0, 60);
  const exp = s(g("experience"));
  const em = exp.match(/(\d+)\s*(?:y|yr|year)?[^\d]*(\d{1,2})?\s*(?:m|mo|month)?/i);
  out.total_exp_years = exp ? (em ? Math.round((parseInt(em[1], 10) + (em[2] ? parseInt(em[2], 10) / 12 : 0)) * 10) / 10 : num(exp)) : null;
  const ctc = (v) => { v = s(v); if (!v) return null; const m = v.match(/(\d[\d,]*(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|cr|k\b)?/i); return m ? parseAmountLpa(m[1], m[2]) : null; };
  out.ctc_current_lpa = ctc(g("ctc_current"));
  out.ctc_expected_lpa = ctc(g("ctc_expected"));
  const n = s(g("notice"));
  if (/immediate|serving|0\s*day/i.test(n)) out.notice_days = 0;
  else { const nm = n.match(/(\d+)\s*(day|month|week)?/i); out.notice_days = nm ? parseInt(nm[1], 10) * (/month/i.test(nm[2] || "") ? 30 : /week/i.test(nm[2] || "") ? 7 : 1) : null; }
  const act = s(g("active")), la = s(g("last_active"));
  out.last_active = la || null;
  out.active_status = /active|open|looking|available|yes/i.test(act) ? "Actively looking" : /passive|not/i.test(act) ? "Passive" : null;
  if (!out.active_status && la) {
    const d = Date.parse(la);
    if (!isNaN(d)) out.active_status = Date.now() - d < 30 * 864e5 ? "Recently active" : "Inactive 30+ days";
    else if (/today|day|week|hour/i.test(la)) out.active_status = "Recently active";
  }
  if (typeof out.profile_url === "string" && out.profile_url && !/^https?:/i.test(out.profile_url)) out.profile_url = null;
  return out;
}

export async function importNaukriRows(env, mandate, rows) {
  if (!rows?.length) return { imported: 0, skipped: 0 };
  const map = mapHeaders(Object.keys(rows[0]));
  if (!map.name) return { imported: 0, skipped: rows.length, error: "Couldn't find a Name column in this file." };
  return importProfiles(env, mandate, rows.map((raw) => normalizeRow(raw, map)), "naukri");
}

/** Import already-normalised profiles (from a Resdex export, a Reach page capture, or any structured source). */
export async function importProfiles(env, mandate, profiles, source = "naukri") {
  const db = env.DB, owner = mandate.owner || "admin";
  let imported = 0, skipped = 0;
  const duplicates = [];
  for (const r of profiles) {
    if (!r?.name) { skipped++; continue; }
    if (r.email) r.email = String(r.email).toLowerCase();
    if (r.phone) r.phone = String(r.phone).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || null;
    let cand = null;
    if (r.email) cand = await one(db, "candidates", "SELECT * FROM candidates WHERE email = ? AND owner = ?", r.email, owner);
    if (!cand && r.phone) cand = await one(db, "candidates", "SELECT * FROM candidates WHERE phone = ? AND owner = ?", r.phone, owner);
    if (!cand && r.profile_url) cand = await one(db, "candidates", "SELECT * FROM candidates WHERE profile_url = ? AND owner = ?", r.profile_url, owner);
    if (!cand && !r.email && !r.phone && !r.profile_url && r.company) cand = await one(db, "candidates", "SELECT * FROM candidates WHERE name = ? AND current_company = ? AND owner = ?", r.name, r.company, owner);
    const text = [r.name, r.title, r.company, r.location, r.skills, r.summary, r.education,
      r.total_exp_years != null ? `Experience: ${r.total_exp_years} years` : "",
      r.ctc_current_lpa != null ? `Current CTC: ${r.ctc_current_lpa} LPA` : "", r.ctc_expected_lpa != null ? `Expected CTC: ${r.ctc_expected_lpa} LPA` : "",
      r.notice_days != null ? `Notice period: ${r.notice_days} days` : ""].filter(Boolean).join("\n");
    const patch = { name: r.name, email: r.email || cand?.email || null, phone: r.phone || cand?.phone || null, current_title: r.title || cand?.current_title || null,
      current_company: r.company || cand?.current_company || null, location: r.location || cand?.location || null, education: r.education || cand?.education || null,
      total_exp_years: r.total_exp_years ?? cand?.total_exp_years ?? null, ctc_current_lpa: r.ctc_current_lpa ?? cand?.ctc_current_lpa ?? null,
      ctc_expected_lpa: r.ctc_expected_lpa ?? cand?.ctc_expected_lpa ?? null, notice_days: r.notice_days ?? cand?.notice_days ?? null,
      active_status: r.active_status || cand?.active_status || null, last_active: r.last_active || cand?.last_active || null,
      profile_url: r.profile_url || cand?.profile_url || null, last_verified_at: new Date().toISOString().slice(0, 19).replace("T", " ") };
    if (!cand) cand = await insert(db, "candidates", { source, owner, resume_text: text, ...patch });
    else { duplicates.push(cand.name || r.name); if (!cand.resume_text) patch.resume_text = text; await update(db, "candidates", cand.id, patch); cand = { ...cand, ...patch }; }
    const spec = mandate.spec;
    const facts = fastFacts(cand.resume_text || text, spec, "");
    for (const f of ["name", "current_title", "current_company", "location", "total_exp_years", "ctc_current_lpa", "ctc_expected_lpa", "notice_days", "education"])
      if (patch[f] != null && patch[f] !== "") { facts[f] = patch[f]; facts.evidence[f] = source === "naukri" ? "From Naukri export" : "From captured page"; facts.verified[f] = true; }
    if (facts.current_title) facts.title_sim = Math.round(titleSimilarity([spec.title, ...(spec.alt_titles || [])], facts.current_title) * 100) / 100;
    facts.structured = true;
    const extraSkills = r.skills ? String(r.skills).split(/[,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 5) : [];
    const cf = candidateFields(facts, spec, cand.top_skills || [], extraSkills);
    await update(db, "candidates", cand.id, cf);
    await ensureCandidateEmbedding(env, { ...cand, ...cf }, true);
    const sim = await semanticSim(env, mandate, cand);
    if (sim !== null) facts.semantic_sim = sim;
    const kind = cand.resume_key ? "resume" : "lead";
    const match = await ensureMatch(db, mandate.id, cand.id, source, kind);
    const fields = scoredFields({ ...match, kind, origin: source }, spec, facts, facts.title_sim);
    // Structured profile data (Naukri export or captured results page) earns a real band, unlike a search snippet.
    const band = scoreCandidate(spec, facts, facts.title_sim).band;
    await update(db, "matches", match.id, { ...fields, band, outreach: outreachMessage(env, spec, cand.name, cf.top_skills) });
    imported++;
  }
  await audit(db, "profiles_imported", "mandate", mandate.id, { imported, skipped, source, duplicates: duplicates.length });
  return { imported, skipped, duplicates };
}
