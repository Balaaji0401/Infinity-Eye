// Reach: turn a captured results page (Resdex, LinkedIn search, any job board) into structured profiles.
// The browser extension sends the page's visible text; the AI extracts candidates; importProfiles scores them.
import { chatJson } from "./ai.js";
import { importProfiles } from "./naukri.js";

const SYSTEM = `You extract candidate profiles from the visible text of a recruiter's search-results page. Return ONLY JSON:
{"profiles": [{"name": str, "title": str|null, "company": str|null, "location": str|null, "total_exp_years": number|null,
  "ctc_current_lpa": number|null, "ctc_expected_lpa": number|null, "notice_days": number|null, "active_status": str|null, "last_active": str|null,
  "email": str|null, "phone": str|null, "profile_url": str|null, "skills": "comma separated"|null, "education": str|null, "summary": str|null}]}
Rules: one entry per distinct person; CTC in lakhs per annum ("5.5 Lacs" -> 5.5, "Rs 6,00,000" -> 6); notice in days ("1 month" -> 30, "immediate" -> 0);
experience in years ("4 yrs 3 months" -> 4.3); active_status from words like Active / last active / actively looking; never invent values; skip navigation, ads and filters.`;

export function sourceFromUrl(url = "") {
  if (/naukri\.com/i.test(url)) return "naukri";
  if (/linkedin\.com/i.test(url)) return "linkedin";
  if (/github\.com/i.test(url)) return "github";
  return "upload";
}

export async function importFromPageText(env, mandate, text, url = "") {
  const clean = (text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < 40) return { imported: 0, skipped: 0, error: "The captured page had almost no text." };
  const chunks = [];
  for (let i = 0; i < clean.length && chunks.length < 6; i += 12000) chunks.push(clean.slice(i, i + 12000));
  let profiles = [];
  for (const chunk of chunks) {
    const out = await chatJson(env, SYSTEM, `Page URL: ${url || "unknown"}\n\nPage text:\n"""${chunk}"""`, 2500);
    if (Array.isArray(out?.profiles)) profiles.push(...out.profiles.filter((p) => p && typeof p.name === "string" && p.name.trim().length > 1));
  }
  const seen = new Set();
  profiles = profiles.filter((p) => { const k = (p.email || p.profile_url || `${p.name}|${p.company || ""}`).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const res = await importProfiles(env, mandate, profiles, sourceFromUrl(url));
  return { ...res, extracted: profiles.length, chunks: chunks.length };
}
