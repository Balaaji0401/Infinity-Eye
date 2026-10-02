import { test } from "node:test";
import assert from "node:assert/strict";
import { semanticSearch, jdText, profileText } from "../src/semantic.js";

// Fake embedder: bag-of-words hash so that related texts land near each other.
const vec = (t) => { const v = new Array(64).fill(0); for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) v[[...w].reduce((a, c) => a + c.charCodeAt(0), 0) % 64] += 1; return v; };
const cands = [
  { id: 1, name: "GST Accountant", current_title: "Accounts Executive", top_skills: '["GST","Tally"]', embedding: JSON.stringify(vec("accounts executive gst tally accounting")) },
  { id: 2, name: "Python Dev", current_title: "Software Developer", top_skills: '["Python"]', embedding: JSON.stringify(vec("software developer python react aws")) },
];
const env = { AI: { run: async (_m, { text }) => ({ data: text.map(vec) }) }, DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: cands }), run: async () => ({}), first: async () => null }) }) } };

test("semantic search ranks by meaning", async () => {
  const r = await semanticSearch(env, "gst accounting tally");
  assert.equal(r.semantic, true); assert.equal(r.results[0].id, 1); assert.ok(r.results[0].similarity > r.results[1].similarity);
  assert.match(jdText({ title: "Finance Executive", skills: [{ name: "GST" }], locations: ["Chennai"] }), /Finance Executive.*GST.*Chennai/);
  assert.match(profileText({ current_title: "X", current_company: "Y", top_skills: ["A"] }, "resume body"), /X\. Y\. A\. resume body/);
});
