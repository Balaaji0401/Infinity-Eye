import { chatJson, AIError } from "./ai.js";
import { CITIES, canonicalCity, esc } from "./parsing.js";

const PROGRAMMING = new Set(["python", "java", "javascript", "typescript", "c#", "go", "golang", "rust", "kotlin", "swift", "php", "ruby", "scala", "c++", ".net", "react", "node", "node.js", "angular", "sql"]);
const COMPLIANCE = [
  [/\b(age|aged)\b[^.\n]{0,25}\d{2}/i, "Age requirement"],
  [/\b(below|under|above|not more than)\s*\d{2}\s*(years|yrs)\s*(of\s*)?age/i, "Age requirement"],
  [/\b(male|female)\s*(candidates?|only|preferred)/i, "Gender requirement"],
  [/\bgender\b/i, "Gender mentioned"],
  [/\b(married|unmarried|marital|single status)\b/i, "Marital status"],
  [/\b(religion|caste|hindu|muslim|christian|jain|sikh)\b/i, "Religion or caste"],
  [/\b(fair complexion|good looking|height|weight)\b/i, "Physical appearance"],
  [/\b(physically fit|no disability|handicap)\b/i, "Disability-related"],
  [/\b(native of|belonging to)\b/i, "Origin or community"],
];

export function complianceFlags(text) {
  const flags = [], seen = new Set();
  for (const [re, label] of COMPLIANCE) {
    if (seen.has(label)) continue;
    const m = re.exec(text || "");
    if (m) { seen.add(label); flags.push({ label, text: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim() }); }
  }
  return flags;
}

const JD_SYSTEM = `You extract structured hiring requirements from a job description for an Indian recruitment agency.
Return ONLY a JSON object with exactly these keys:
{"title": string, "alt_titles": [up to 4 other market titles for the same role],
 "seniority": string, "min_exp": number|null, "max_exp": number|null,
 "locations": [cities], "relocation_ok": boolean,
 "skills": [{"name": string, "type": "skill"|"tool", "mandatory": boolean, "aliases": [short synonyms]}],
 "industries": [preferred industries], "education": [degrees],
 "ctc_min_lpa": number|null, "ctc_max_lpa": number|null, "notice_max_days": number|null,
 "summary": "one sentence describing the role"}
Rules: use only facts in the JD; mark a skill mandatory only if the JD says required/must/mandatory or it is core to the role;
tools are software such as Tally, SAP, Excel, Jira; CTC in lakhs per annum; never include age, gender, religion, caste or marital status.`;

function heuristicSpec(text) {
  const first = (text.split("\n").map((l) => l.trim()).find(Boolean) || "New role").slice(0, 80);
  const spec = { title: first, alt_titles: [], seniority: "", min_exp: null, max_exp: null, locations: [], relocation_ok: false, skills: [],
    industries: [], education: [], ctc_min_lpa: null, ctc_max_lpa: null, notice_max_days: null, summary: "" };
  let m = /(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:years|yrs)/i.exec(text);
  if (m) { spec.min_exp = +m[1]; spec.max_exp = +m[2]; }
  m = /(\d{1,2}(?:\.\d)?)\s*(?:-|to|–)\s*(\d{1,2}(?:\.\d)?)\s*(?:lpa|lakhs?|l\b)/i.exec(text);
  if (m) { spec.ctc_min_lpa = +m[1]; spec.ctc_max_lpa = +m[2]; }
  for (const c of CITIES) if (new RegExp("\\b" + esc(c) + "\\b", "i").test(text)) spec.locations.push(canonicalCity(c));
  spec.locations = [...new Set(spec.locations)].slice(0, 3);
  if (/immediate/i.test(text)) spec.notice_max_days = 30;
  return spec;
}

const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : []);

export function normalizeSpec(spec = {}) {
  const out = {
    title: (spec.title || "").trim() || "Untitled role",
    alt_titles: strs(spec.alt_titles).slice(0, 5),
    seniority: spec.seniority || "",
    min_exp: num(spec.min_exp), max_exp: num(spec.max_exp),
    locations: strs(spec.locations).map(canonicalCity),
    relocation_ok: !!spec.relocation_ok,
    industries: strs(spec.industries), education: strs(spec.education),
    ctc_min_lpa: num(spec.ctc_min_lpa), ctc_max_lpa: num(spec.ctc_max_lpa), notice_max_days: num(spec.notice_max_days),
    summary: spec.summary || "", skills: [], weights: spec.weights || {},
  };
  const seen = new Set();
  for (let s of spec.skills || []) {
    if (typeof s === "string") s = { name: s };
    const name = (s?.name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.skills.push({ name, type: s.type === "tool" ? "tool" : "skill", mandatory: !!s.mandatory,
      aliases: strs(s.aliases).filter((a) => a.toLowerCase() !== name.toLowerCase()).slice(0, 4) });
  }
  return out;
}

export async function analyzeJd(env, text, notes = "") {
  let warning = null, spec;
  try {
    const user = (notes.trim() ? "Recruiter's notes from the conversation before this JD (use them to fill or override fields such as client budget, location, preferred industries, notice; they take precedence over the JD when they conflict):\n" + notes.slice(0, 3000) + "\n\n" : "") + "Job description:\n" + text.slice(0, 8000);
    spec = normalizeSpec(await chatJson(env, JD_SYSTEM, user, 1000));
  } catch (e) {
    spec = normalizeSpec(heuristicSpec(text));
    console.warn("JD analysis fell back to basic read:", e.message || e);
    warning = "The AI service couldn't be reached, so the requirements below come from a basic read of the JD. Please review and complete them before sourcing.";
  }
  return { spec, compliance_flags: complianceFlags(text), warning, missing: missingInformation(spec), ambiguities: ambiguities(text) };
}

/** Missing Information Checklist: what the JD didn't say, so the recruiter confirms instead of the system assuming. */
export function missingInformation(spec) {
  const out = [];
  if (!spec.skills?.some((s) => s.mandatory)) out.push({ field: "skills", label: "Mandatory skills", hint: "Which skills are must-haves? Mark them with the star." });
  if (spec.min_exp == null && spec.max_exp == null) out.push({ field: "experience", label: "Experience range", hint: "Years of experience the client expects." });
  if (!spec.locations?.length) out.push({ field: "location", label: "Work location", hint: "City or site, and whether relocation is acceptable." });
  if (spec.ctc_max_lpa == null) out.push({ field: "ctc", label: "CTC budget", hint: "Maximum annual CTC in lakhs; needed to flag over-budget candidates." });
  if (spec.notice_max_days == null) out.push({ field: "notice", label: "Joining timeline", hint: "Maximum notice period the client will accept." });
  if (!spec.education?.length) out.push({ field: "education", label: "Qualification", hint: "Minimum qualification, if any." });
  return out;
}

/** Conflicting statements in the JD, e.g. "5+ years" and "3-5 years". */
export function ambiguities(text) {
  const out = [], t = text || "";
  const ranges = [...t.matchAll(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/gi)].map((m) => [+m[1], +m[2]]);
  const pluses = [...t.matchAll(/(\d{1,2})\s*\+\s*(?:years?|yrs?)/gi)].map((m) => +m[1]);
  const mins = new Set([...ranges.map((r) => r[0]), ...pluses]);
  if (mins.size > 1) out.push({ label: "Experience stated more than one way", detail: `The JD mentions ${[...mins].sort((a, b) => a - b).map((m) => `${m}+ years`).join(" and ")}. Confirm the real minimum.` });
  const ctcs = [...t.matchAll(/(\d{1,2}(?:\.\d)?)\s*(?:-|to|–)\s*(\d{1,2}(?:\.\d)?)\s*(?:lpa|lakhs?)/gi)].map((m) => m[0]);
  if (new Set(ctcs.map((c) => c.toLowerCase().replace(/\s+/g, ""))).size > 1) out.push({ label: "More than one CTC range", detail: `Found ${ctcs.join(" and ")}. Confirm the budget.` });
  return out;
}

const q = (t) => (/\s/.test(t.trim()) ? `"${t.trim()}"` : t.trim());
const or = (ts) => { ts = ts.filter(Boolean); return !ts.length ? "" : ts.length === 1 ? q(ts[0]) : "(" + ts.map(q).join(" OR ") + ")"; };
const and = (ts) => ts.filter(Boolean).map(q).join(" AND ");
const join = (...parts) => parts.filter(Boolean).map((p) => (p.includes(" AND ") && parts.filter(Boolean).length > 1 ? `(${p})` : p)).join(" AND ");

export function buildSearchPlan(spec) {
  const titles = [...new Set([spec.title, ...(spec.alt_titles || [])])].slice(0, 5);
  const mand = spec.skills.filter((s) => s.mandatory).map((s) => s.name);
  const pref = spec.skills.filter((s) => !s.mandatory).map((s) => s.name);
  const locs = spec.locations || [];
  const filters = {};
  if (spec.min_exp != null || spec.max_exp != null) filters.Experience = `${Math.floor(spec.min_exp || 0)}–${spec.max_exp != null ? Math.floor(spec.max_exp) : "+"} yrs`;
  if (locs.length) filters.Location = locs.join(", ");
  if (spec.ctc_min_lpa != null || spec.ctc_max_lpa != null) filters["CTC (LPA)"] = `${spec.ctc_min_lpa ?? ""}–${spec.ctc_max_lpa ?? ""}`;
  if (spec.notice_max_days != null) filters.Notice = `≤ ${Math.floor(spec.notice_max_days)} days`;
  const raw = [
    { name: "Exact title", query: join(q(spec.title), and(mand)) },
    { name: "Title variants", query: join(or(titles), and(mand)) },
    { name: "Skill-first", query: join(and(mand) || or(pref), mand.length ? or(pref) : "") },
    { name: "Relaxed (any key skill)", query: join(or(titles), or([...mand, ...pref.slice(0, 2)])) },
  ];
  const seen = new Set(), resdex = [];
  for (const r of raw) if (r.query && !seen.has(r.query)) { seen.add(r.query); resdex.push(r); }
  const key = (mand.length ? mand : pref).slice(0, 2), locQ = or(locs.slice(0, 2));
  const xray = [...new Set([
    `site:linkedin.com/in ${or(titles)} ${key.map(q).join(" ")} ${locQ}`.trim(),
    `site:linkedin.com/in ${or(titles)} ${locQ}`.trim(),
    `site:linkedin.com/in ${q(spec.title)} ${[...mand, ...pref].slice(0, 3).map(q).join(" ")}`.trim(),
  ])];
  const langs = spec.skills.map((s) => s.name.toLowerCase()).filter((n) => PROGRAMMING.has(n));
  let github = null;
  if (langs.length) {
    const lang = langs[0].replace("c#", "csharp").replace(".net", "csharp").replace("node.js", "javascript").replace("node", "javascript").replace("react", "javascript").replace("golang", "go");
    github = `language:${lang}` + (locs.length && locs[0] !== "Remote" ? ` location:"${locs[0]}"` : "");
  }
  const linkedinBoolean = join(or(titles), and(mand));
  const enc = encodeURIComponent;
  const links = {
    linkedin_people: `https://www.linkedin.com/search/results/people/?keywords=${enc(linkedinBoolean)}${locs.length ? "" : ""}`,
    linkedin_jobs_post: "https://www.linkedin.com/talent/post-a-job",
    google_xray: xray.map((q) => `https://www.google.com/search?q=${enc(q)}`),
    naukri_resdex: "https://resdex.naukri.com/",
    indeed_resumes: `https://resumes.indeed.com/search?q=${enc(spec.title)}${locs.length ? `&l=${enc(locs[0])}` : ""}`,
    github: github ? `https://github.com/search?type=users&q=${enc(github)}` : null,
  };
  const summary = [
    `Titles: ${titles.join(" or ")}`,
    mand.length ? `Must have: ${mand.join(", ")}` : "",
    pref.length ? `Nice to have: ${pref.join(", ")}` : "",
    ...Object.entries(filters).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);
  return { resdex, filters, linkedin_boolean: linkedinBoolean, xray_queries: xray, github_query: github, links, summary };
}
