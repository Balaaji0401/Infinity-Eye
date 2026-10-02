import { test } from "node:test";
import assert from "node:assert/strict";
import { fastFacts } from "../src/parsing.js";
import { scoreCandidate } from "../src/scoring.js";
import { mergeDeep, verifyQuote } from "../src/pipeline.js";
import { buildSearchPlan, complianceFlags, normalizeSpec } from "../src/jd.js";
import { parseLinkedinResult } from "../src/sourcing.js";

const spec = normalizeSpec({ title: "Finance Executive", alt_titles: ["Accounts Executive"], min_exp: 3, max_exp: 5, locations: ["Chennai"],
  skills: [{ name: "GST", mandatory: true }, { name: "Tally", mandatory: true, type: "tool" }, { name: "SAP FICO" }],
  industries: ["Manufacturing"], ctc_max_lpa: 8, notice_max_days: 30 });
const resume = `Karthik Raman
Finance Executive
Chennai | karthik@example.com | +91 98400 11223
Total experience: 4.2 years in plant accounting for an auto-components manufacturer (manufacturing).
Skills: Tally Prime, GST filing
Current CTC: 5.8 LPA | Expected CTC: 7.2 LPA | Notice Period: 15 days`;

test("fast facts + scoring", () => {
  const f = fastFacts(resume, spec, "x.pdf");
  assert.equal(f.name, "Karthik Raman"); assert.equal(f.total_exp_years, 4.2); assert.equal(f.location, "Chennai");
  assert.equal(f.ctc_expected_lpa, 7.2); assert.equal(f.notice_days, 15); assert.deepEqual(Object.keys(f.skills_found), ["GST", "Tally"]);
  const r = scoreCandidate(spec, f);
  assert.equal(r.band, "A"); assert.ok(r.score >= 9);
});

test("gates", () => {
  const f = fastFacts(resume.replace("15 days", "90 days"), spec, "");
  assert.equal(scoreCandidate(spec, f).band, "Do not advance");
});

test("hallucinated AI facts are rejected, verified ones accepted", () => {
  const f = fastFacts(resume, spec, "");
  const merged = mergeDeep(f, {
    current_company: { value: "Sundaram Brakes", quote: "not in resume at all" },
    expected_ctc_lpa: { value: 3, quote: "Expected CTC: 3 LPA" },
    skills: [{ name: "SAP FICO", quote: "invented SAP quote" }],
  }, resume, spec);
  assert.equal(merged.ctc_expected_lpa, 7.2);              // verified value kept
  assert.equal(merged.current_company, "Sundaram Brakes"); // no prior value -> accepted but flagged
  assert.equal(merged.verified.current_company, false);
  assert.equal(merged.skills_found["SAP FICO"].verified, false);
  assert.ok(verifyQuote("Tally Prime, GST filing", resume));
});

test("search plan + compliance + linkedin parse", () => {
  const plan = buildSearchPlan(spec);
  assert.match(plan.resdex[0].query, /"Finance Executive" AND \(GST AND Tally\)/);
  assert.ok(plan.xray_queries[0].startsWith("site:linkedin.com/in"));
  assert.deepEqual(complianceFlags("Male candidates only, age below 30 years").map((f) => f.label).sort(), ["Age requirement", "Gender requirement"]);
  const r = parseLinkedinResult({ title: "Ramya Sekar - Accounts Executive - TVS Motor | LinkedIn", link: "https://in.linkedin.com/in/ramya?trk=1", snippet: "Location: Chennai" });
  assert.equal(r.name, "Ramya Sekar"); assert.equal(r.company, "TVS Motor"); assert.equal(r.location, "Chennai");
});
