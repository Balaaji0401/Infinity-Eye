// Explainable scoring: hard gates -> weighted fit -> evidence quality -> band. Pure functions.
export const DEFAULT_WEIGHTS = { mandatory_skills: 30, experience: 20, title: 12, preferred_skills: 10, location: 10, ctc: 6, notice: 6, industry: 6, semantic: 8 };
export const BAND_RANK = { A: 0, B: 1, Review: 2, "Do not advance": 3, Lead: 4 };
export const rankKey = (a, b) => (BAND_RANK[a.band] ?? 5) - (BAND_RANK[b.band] ?? 5) || (b.score || 0) - (a.score || 0);
const fmt = (v) => (typeof v === "number" ? String(+v.toFixed(2)) : String(v));

export function scoreCandidate(spec, facts, titleSim = null) {
  const w = { ...DEFAULT_WEIGHTS, ...(spec.weights || {}) };
  const items = [], gates = [];
  const found = facts.skills_found || {}, ev = facts.evidence || {}, ver = facts.verified || {};
  const add = (key, criterion, value, status, detail, evidence = "") =>
    items.push({ key, criterion, value: Math.round(value * 100) / 100, status, detail, evidence, weight: w[key] || 0 });
  const credit = (name) => { const f = found[name]; return !f ? 0 : f.verified !== false ? 1 : 0.5; };

  const mand = (spec.skills || []).filter((s) => s.mandatory);
  if (mand.length) {
    const credits = mand.map((s) => credit(s.name));
    const frac = credits.reduce((a, b) => a + b, 0) / mand.length;
    const missing = mand.filter((s, i) => credits[i] === 0).map((s) => s.name);
    add("mandatory_skills", "Mandatory skills", frac, frac === 1 ? "meets" : frac > 0 ? "partial" : "fails",
      `${credits.filter((c) => c > 0).length}/${mand.length} found` + (missing.length ? `; missing ${missing.join(", ")}` : ""));
    for (const s of mand) {
      const f = found[s.name];
      items.push({ key: "skill", criterion: s.name, value: credit(s.name), status: f ? (f.verified !== false ? "meets" : "unverified") : "missing",
        detail: "Mandatory " + (s.type || "skill"), evidence: f?.evidence || "", weight: 0 });
    }
    if (frac === 0) gates.push("None of the mandatory skills found");
  }
  const pref = (spec.skills || []).filter((s) => !s.mandatory);
  if (pref.length) {
    const credits = pref.map((s) => credit(s.name));
    const frac = credits.reduce((a, b) => a + b, 0) / pref.length;
    const have = pref.filter((s, i) => credits[i] > 0).map((s) => s.name);
    add("preferred_skills", "Preferred skills", frac, frac >= 0.5 ? "meets" : frac ? "partial" : "missing",
      `${have.length}/${pref.length} found` + (have.length ? `: ${have.join(", ")}` : ""));
  }

  let lo = spec.min_exp, hi = spec.max_exp;
  const exp = facts.total_exp_years;
  if (lo != null || hi != null) {
    lo = lo || 0;
    const e = ev.total_exp_years || "";
    if (exp == null) add("experience", "Experience", 0.5, "unknown", "Not stated in resume");
    else if (exp < lo - 1) { add("experience", "Experience", 0, "fails", `${fmt(exp)} yrs vs ${fmt(lo)}+ required`, e); gates.push(`Experience ${fmt(exp)} yrs is well below ${fmt(lo)} yrs`); }
    else if (exp < lo) add("experience", "Experience", 0.6, "partial", `${fmt(exp)} yrs, slightly below ${fmt(lo)}`, e);
    else if (hi && exp > hi + 2) add("experience", "Experience", 0.6, "partial", `${fmt(exp)} yrs, above the ${fmt(hi)} yr range (may be overqualified)`, e);
    else add("experience", "Experience", 1, ver.total_exp_years !== false ? "meets" : "unverified", `${fmt(exp)} yrs`, e);
  }

  if (titleSim == null) titleSim = facts.title_sim;
  if (titleSim != null) add("title", "Role / title match", +titleSim, titleSim >= 0.75 ? "meets" : titleSim >= 0.4 ? "partial" : "missing", facts.current_title || "—", ev.current_title || "");

  const locs = (spec.locations || []).map((l) => l.toLowerCase());
  if (locs.length && !locs.includes("remote")) {
    const loc = facts.location;
    if (!loc) add("location", "Location", 0.5, "unknown", "Location not stated");
    else if (locs.includes(loc.toLowerCase())) add("location", "Location", 1, "meets", loc, ev.location || "");
    else if (spec.relocation_ok || facts.relocation) add("location", "Location", 0.6, "partial", `${loc}; relocation possible`, ev.relocation || ev.location || "");
    else add("location", "Location", 0.2, "missing", `${loc}; outside ${spec.locations.join(", ")}`, ev.location || "");
  }

  const cmax = spec.ctc_max_lpa;
  if (cmax) {
    const expc = facts.ctc_expected_lpa, cur = facts.ctc_current_lpa;
    const basis = expc != null ? expc : cur != null ? Math.round(cur * 12) / 10 : null;
    const label = expc != null ? "expected" : "est. from current +20%";
    const e = ev.ctc_expected_lpa || ev.ctc_current_lpa || "";
    if (basis == null) add("ctc", "CTC fit", 0.5, "unknown", "CTC not stated");
    else if (basis <= cmax) add("ctc", "CTC fit", 1, "meets", `₹${fmt(basis)}L ${label} vs ₹${fmt(cmax)}L budget`, e);
    else if (basis <= cmax * 1.2) add("ctc", "CTC fit", 0.4, "partial", `₹${fmt(basis)}L ${label}, above ₹${fmt(cmax)}L budget`, e);
    else { add("ctc", "CTC fit", 0, "fails", `₹${fmt(basis)}L ${label}, far above ₹${fmt(cmax)}L budget`, e); if (expc != null) gates.push(`Expected CTC ₹${fmt(expc)}L exceeds budget by more than 20%`); }
  }

  const nmax = spec.notice_max_days;
  if (nmax != null) {
    const n = facts.notice_days, e = ev.notice_days || "";
    if (n == null) add("notice", "Notice period", 0.5, "unknown", "Not stated");
    else if (n <= nmax) add("notice", "Notice period", 1, "meets", `${n} days`, e);
    else if (n <= nmax + 30) add("notice", "Notice period", 0.4, "partial", `${n} days vs ≤${fmt(nmax)} wanted`, e);
    else { add("notice", "Notice period", 0, "fails", `${n} days vs ≤${fmt(nmax)} wanted`, e); gates.push(`Notice period ${n} days is far beyond ${fmt(nmax)} days`); }
  }

  if ((spec.industries || []).length) {
    const inds = facts.industries_found || [];
    add("industry", "Industry", inds.length ? 1 : 0.3, inds.length ? "meets" : "missing",
      inds.length ? inds.join(", ") : `No ${spec.industries.join(", ")} background found`, ev.industries || "");
  }

  // semantic profile similarity (embedding of the whole profile vs the JD); only when embeddings were available
  if (typeof facts.semantic_sim === "number") {
    const v = facts.semantic_sim;
    add("semantic", "Profile similarity to JD", v, v >= 0.7 ? "meets" : v >= 0.4 ? "partial" : "missing", `${Math.round(v * 100)}% semantic match`, "Embedding of the full profile compared with the job description");
  }

  const weighted = items.filter((i) => i.weight > 0);
  const totalW = weighted.reduce((a, i) => a + i.weight, 0);
  const score = totalW ? Math.round((10 * weighted.reduce((a, i) => a + i.value * i.weight, 0) / totalW) * 10) / 10 : 0;
  const unknownCore = weighted.some((i) => ["unknown", "unverified"].includes(i.status) && ["experience", "ctc", "notice"].includes(i.key));
  const weakCore = weighted.some((i) => ["missing", "fails", "partial"].includes(i.status) && ["mandatory_skills", "location", "experience"].includes(i.key));
  let band;
  if (gates.length) band = "Do not advance";
  else if (score >= 7.5 && !unknownCore && !weakCore) band = "A";
  else if (score >= 6) band = "B";
  else if (score >= 4) band = "Review";
  else { band = "Do not advance"; gates.push("Low overall fit"); }
  const gaps = items.filter((i) => ["missing", "fails", "partial", "unknown", "unverified"].includes(i.status) && i.key !== "mandatory_skills")
    .map((i) => `${i.criterion}: ${i.detail}`);
  return { score, band, checklist: items, gaps, gates };
}

export function screeningQuestions(spec, result, limit = 4) {
  const qs = [];
  for (const i of result.checklist) {
    if (qs.length >= limit) break;
    const { key: k, status: st } = i;
    if (k === "skill" && ["missing", "unverified"].includes(st)) qs.push(`Walk me through a recent task where you used ${i.criterion} hands-on.`);
    else if (k === "experience" && ["unknown", "partial"].includes(st)) qs.push("How many years of directly relevant experience do you have for this role?");
    else if (k === "ctc" && ["unknown", "partial", "fails"].includes(st)) qs.push("What are your current and expected CTC, and how flexible is the expectation?");
    else if (k === "notice" && ["unknown", "partial", "fails"].includes(st)) qs.push("What is your notice period, and is early release or buyout possible?");
    else if (k === "location" && ["unknown", "missing"].includes(st)) qs.push(`Are you based in or willing to relocate to ${(spec.locations || []).join(", ")}?`);
    else if (k === "industry" && st === "missing") qs.push(`Have you worked with ${(spec.industries || []).join(", ")} companies or clients?`);
  }
  return [...new Set(qs)];
}
