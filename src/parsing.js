// Fast, deterministic fact pass over resume text. No AI. Every fact carries the resume line it came from.

export const CITIES = ["Chennai", "Bengaluru", "Bangalore", "Hyderabad", "Mumbai", "Navi Mumbai", "Pune", "Delhi",
  "New Delhi", "Gurugram", "Gurgaon", "Noida", "Kolkata", "Ahmedabad", "Coimbatore", "Madurai", "Tiruchirappalli",
  "Trichy", "Salem", "Hosur", "Sriperumbudur", "Oragadam", "Kanchipuram", "Tiruppur", "Vellore", "Mysuru", "Mysore",
  "Kochi", "Cochin", "Thiruvananthapuram", "Vizag", "Visakhapatnam", "Vijayawada", "Nagpur", "Nashik", "Aurangabad",
  "Indore", "Bhopal", "Jaipur", "Lucknow", "Chandigarh", "Vadodara", "Surat", "Rajkot", "Goa", "Pondicherry",
  "Puducherry", "Mangalore", "Mangaluru", "Belgaum", "Hubli", "Remote"];
const ALIASES = { bangalore: "Bengaluru", gurgaon: "Gurugram", mysore: "Mysuru", cochin: "Kochi", trichy: "Tiruchirappalli",
  mangalore: "Mangaluru", vizag: "Visakhapatnam", "new delhi": "Delhi", pondicherry: "Puducherry" };
const DEGREES = ["CA Inter", "CA", "CMA", "ICWA", "ACCA", "CS", "MBA", "PGDM", "M.Com", "B.Com", "BBA", "BBM", "M.Tech",
  "B.Tech", "M.E", "B.E", "MCA", "BCA", "M.Sc", "B.Sc", "Diploma", "ITI", "B.A", "M.A", "PhD"];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const STOP = new Set(["and", "of", "the", "for", "in", "a", "senior", "sr", "junior", "jr", "lead", "–", "-", "|", "at"]);

export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const norm = (s) => (s || "").toLowerCase().replace(/[^\w#+.%/]+/g, " ").replace(/\s+/g, " ").trim();
export const canonicalCity = (n) => (n ? ALIASES[n.toLowerCase()] || n : null);
const skillRe = (skill) => new RegExp("(?<![\\w])" + esc(skill.trim().toLowerCase()) + "(?![\\w])", "i");
const cityRe = (c) => new RegExp("\\b" + esc(c) + "\\b", "i");

export function lineOf(text, start, width = 180) {
  const ls = text.lastIndexOf("\n", start) + 1;
  let le = text.indexOf("\n", start);
  if (le === -1) le = text.length;
  let line = text.slice(ls, le).trim();
  if (line.length > width) {
    const rel = start - ls;
    line = text.slice(ls + Math.max(0, rel - width / 2), ls + rel + width / 2).trim();
  }
  return line;
}

export function parseAmountLpa(num, unit) {
  const v = parseFloat(num.replace(/,/g, ""));
  if (isNaN(v)) return null;
  unit = (unit || "").toLowerCase();
  if (unit.startsWith("cr")) return round2(v * 100);
  if (unit.startsWith("l")) return round2(v);
  if (unit === "k") return v < 1000 ? round2((v * 1000 * 12) / 100000) : null;
  if (v >= 10000) return round2(v / 100000);
  if (v <= 100) return round2(v);
  return null;
}
const round2 = (v) => Math.round(v * 100) / 100;

const DATE = "(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*['’]?(\\d{2,4})|(\\d{1,2})[/-](\\d{4}))";
const RANGE = new RegExp(DATE + "\\s*(?:-|–|—|to|till)\\s*(?:" + DATE + "|(present|current|till date|date|now))", "gi");

function toYm(mon, year, mnum, year2) {
  if (mon) { let y = parseInt(year, 10); if (y < 100) y += 2000; return [y, MONTHS[mon.slice(0, 3).toLowerCase()] || 1]; }
  if (mnum) return [parseInt(year2, 10), Math.max(1, Math.min(12, parseInt(mnum, 10)))];
  return null;
}

export function experienceFromRanges(text, today = new Date()) {
  const ty = today.getFullYear(), tm = today.getMonth() + 1, spans = [];
  for (const m of text.matchAll(RANGE)) {
    const a = toYm(m[1], m[2], m[3], m[4]);
    const b = m[9] ? [ty, tm] : toYm(m[5], m[6], m[7], m[8]);
    if (!a || !b) continue;
    const s = a[0] * 12 + a[1], e = b[0] * 12 + b[1];
    if (1970 * 12 < s && s <= e && e <= ty * 12 + tm) spans.push([s, e]);
  }
  if (!spans.length) return null;
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [spans[0].slice()];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]);
  }
  const months = merged.reduce((acc, [s, e]) => acc + (e - s), 0);
  return months > 0 ? Math.round((months / 12) * 10) / 10 : null;
}

export function statedExperience(text) {
  const re = /(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*(?:months?|mos?))?/gi;
  let best = null;
  for (const m of text.matchAll(re)) {
    const ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).toLowerCase();
    if (ctx.includes("experience") || ctx.includes("exp")) {
      const val = parseFloat(m[1]) + (m[2] ? parseInt(m[2], 10) / 12 : 0);
      if (val <= 45 && (!best || val > best[0])) best = [Math.round(val * 10) / 10, lineOf(text, m.index)];
    }
  }
  return best;
}

export function titleSimilarity(targets, candidateTitle) {
  const ct = new Set(norm(candidateTitle).split(" ").filter((w) => w && !STOP.has(w)));
  if (!ct.size) return 0;
  let best = 0;
  for (const t of targets) {
    const tw = [...new Set(norm(t).split(" ").filter((w) => w && !STOP.has(w)))];
    if (tw.length) best = Math.max(best, tw.filter((w) => ct.has(w)).length / tw.length);
  }
  return best;
}

export function fastFacts(text, spec, filename = "") {
  text = text || "";
  const facts = { skills_found: {}, evidence: {}, verified: {} };
  const put = (f, v, ev) => { if (v === null || v === undefined || v === "") return; facts[f] = v; facts.evidence[f] = ev; facts.verified[f] = true; };

  let m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (m) put("email", m[0].replace(/\.+$/, ""), lineOf(text, m.index));
  m = text.match(/(?:\+?91[\s-]?)?(?<!\d)([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})(?!\d)/);
  if (m) put("phone", m[1].replace(/\D/g, ""), lineOf(text, m.index));

  let name = null;
  m = text.match(/^\s*name\s*[:\-]\s*([A-Za-z .]{3,60})$/im);
  if (m) name = m[1].trim();
  else {
    for (const line of text.split("\n").slice(0, 8)) {
      const l = line.trim();
      if (!l || /resume|curriculum|vitae|profile|@|\d/i.test(l)) continue;
      const words = l.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z.]+$/.test(w))) {
        name = l === l.toUpperCase() ? l.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : l;
        break;
      }
    }
  }
  if (!name && filename) name = filename.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
  if (name) put("name", name, name);

  const stated = statedExperience(text), computed = experienceFromRanges(text);
  if (stated) put("total_exp_years", stated[0], stated[1]);
  else if (computed !== null) put("total_exp_years", computed, "Calculated from employment dates in resume");

  for (const sk of spec.skills || []) {
    for (const n of [sk.name, ...(sk.aliases || [])]) {
      if (!n || !n.trim()) continue;
      const mm = skillRe(n).exec(text);
      if (mm) { facts.skills_found[sk.name] = { evidence: lineOf(text, mm.index), verified: true }; break; }
    }
  }

  let loc = null;
  const lm = /(?:current\s+location|location|based\s+(?:in|at)|address|city)\s*[:\-]?\s*([^\n]{2,80})/i.exec(text);
  if (lm) {
    const seg = lm[1].split(/willing|open to|relocat|prefer/i)[0];
    const hits = CITIES.map((c) => { const h = cityRe(c).exec(seg); return h ? [h.index, c] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
    if (hits.length) loc = [canonicalCity(hits[0][1]), lineOf(text, lm.index)];
  }
  if (!loc) {
    const head = text.split("\n").slice(0, 15).join("\n");
    for (const c of CITIES) { const h = cityRe(c).exec(head); if (h) { loc = [canonicalCity(c), lineOf(head, h.index)]; break; } }
  }
  if (loc) put("location", loc[0], loc[1]);
  m = /(willing|open|ready)\s+to\s+relocate/i.exec(text);
  if (m) put("relocation", true, lineOf(text, m.index));

  const money = "(?:rs\\.?|inr|₹)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(lpa|lakhs?|lacs?|l\\b|cr|k\\b)?";
  for (const [field, label] of [["ctc_current_lpa", "current\\s*(?:ctc|salary|package)"], ["ctc_expected_lpa", "expected\\s*(?:ctc|salary|package)"]]) {
    const mm = new RegExp(label + "\\s*[:\\-]?\\s*" + money, "i").exec(text);
    if (mm) { const v = parseAmountLpa(mm[1], mm[2]); if (v) put(field, v, lineOf(text, mm.index)); }
  }
  if (facts.ctc_current_lpa === undefined) {
    for (const mm of text.matchAll(new RegExp("\\bctc\\s*[:\\-]?\\s*" + money, "gi"))) {
      if (/expect/i.test(text.slice(Math.max(0, mm.index - 15), mm.index))) continue;
      const v = parseAmountLpa(mm[1], mm[2]);
      if (v) put("ctc_current_lpa", v, lineOf(text, mm.index));
      break;
    }
  }

  m = /notice\s*(?:period)?\s*[:\-]?\s*(\d{1,3})\s*(days?|months?|weeks?)/i.exec(text);
  if (m) {
    const n = parseInt(m[1], 10), u = m[2].toLowerCase();
    put("notice_days", u.startsWith("month") ? n * 30 : u.startsWith("week") ? n * 7 : n, lineOf(text, m.index));
  } else {
    m = /immediate(ly)?\s*(joiner|available|joining)|notice\s*(?:period)?\s*[:\-]?\s*immediate/i.exec(text);
    if (m) put("notice_days", 0, lineOf(text, m.index));
  }

  const inds = [];
  for (const ind of spec.industries || []) {
    const mm = skillRe(ind).exec(text);
    if (mm) { inds.push(ind); if (!facts.evidence.industries) facts.evidence.industries = lineOf(text, mm.index); }
  }
  if (inds.length) { facts.industries_found = inds; facts.verified.industries = true; }

  for (const deg of DEGREES) {
    const mm = new RegExp("(?<![\\w.])" + esc(deg).replace(/\\\./g, "\\.?") + "(?![\\w])").exec(text);
    if (mm) { put("education", deg, lineOf(text, mm.index)); break; }
  }

  const titles = [spec.title || "", ...(spec.alt_titles || [])];
  let best = [0, null];
  for (const line of text.split("\n").slice(0, 40)) {
    const l = line.trim();
    if (/summary|objective|profile|skills|education|projects|certification|declaration|experience\s*$|responsibilit|achievement/i.test(l)) continue;
    if (l.length > 3 && l.length < 90) { const s = titleSimilarity(titles, l); if (s > best[0]) best = [s, l]; }
  }
  if (best[1] && best[0] >= 0.5) put("current_title", best[1].slice(0, 120), best[1]);
  facts.title_sim = Math.round(best[0] * 100) / 100;
  return facts;
}
