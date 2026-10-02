import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, fallbackParse, reusablePatch } from "../src/commands.js";
import { deriveWeights } from "../src/learning.js";
import { mapHeaders, normalizeRow } from "../src/naukri.js";
import { normalizeSpec } from "../src/jd.js";

const spec = normalizeSpec({ title: "Finance Executive", skills: [{ name: "GST", mandatory: true }, { name: "SAP FICO" }], locations: ["Chennai"], ctc_max_lpa: 8, notice_max_days: 30 });

test("prompt commands parse and apply without AI", () => {
  const p = fallbackParse("show 10 profiles, budget 9 LPA, notice up to 60 days, SAP FICO is mandatory, always prefer manufacturing");
  const r = applyPatch({ spec, top_n: 5 }, p);
  assert.equal(r.top_n, 10); assert.equal(r.spec.ctc_max_lpa, 9); assert.equal(r.spec.notice_max_days, 60);
  assert.ok(r.spec.skills.find((s) => s.name === "SAP FICO").mandatory);
  assert.deepEqual(r.spec.industries, ["Manufacturing"]); assert.equal(p.remember, true);
  assert.ok(!("ctc_max_lpa" in reusablePatch(p)) && reusablePatch(p).add_industries);
});

test("learning shifts weights toward what predicts a shortlist", () => {
  const pos = [1, 1, 1].map(() => ({ outcome: 1, values: { experience: 1, location: 0.5, notice: 0.5 } }));
  const neg = [1, 1, 1].map(() => ({ outcome: 0, values: { experience: 0.4, location: 0.5, notice: 1 } }));
  const r = deriveWeights([...pos, ...neg]);
  assert.ok(r.weights.experience > 20); assert.equal(r.weights.location, 10); assert.ok(r.weights.notice < 6);
  assert.equal(deriveWeights(pos).weights, null);
});

test("naukri export rows map to structured candidates", () => {
  const map = mapHeaders(["Candidate Name", "Current Designation", "Current Company", "Experience", "Current Location", "Current CTC", "Expected CTC", "Notice Period", "Last Active", "Email ID", "Mobile No", "Profile URL", "Key Skills"]);
  const r = normalizeRow({ "Candidate Name": "Ramya S", "Current Designation": "Accounts Executive", "Current Company": "TVS", "Experience": "4 Years 3 Months", "Current Location": "Chennai, TN",
    "Current CTC": "Rs. 5,50,000", "Expected CTC": "7 Lakhs", "Notice Period": "1 Month", "Last Active": "2 days ago", "Email ID": "RAMYA@x.com", "Mobile No": "+91 9884400001", "Profile URL": "https://resdex.naukri.com/p/1", "Key Skills": "GST" }, map);
  assert.equal(r.total_exp_years, 4.3); assert.equal(r.ctc_current_lpa, 5.5); assert.equal(r.ctc_expected_lpa, 7); assert.equal(r.notice_days, 30);
  assert.equal(r.phone, "9884400001"); assert.equal(r.email, "ramya@x.com"); assert.equal(r.location, "Chennai"); assert.equal(r.active_status, "Recently active");
});
