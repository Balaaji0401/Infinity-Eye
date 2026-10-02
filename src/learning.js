// The "training" loop. There is no model fine-tuning on the free tier; instead the scoring engine adapts in two ways:
// 1. Outcome learning: compare criterion values of candidates the recruiter shortlisted vs rejected and shift the weights
//    toward what actually predicts a shortlist. Learned per client and overall.
// 2. Prompt learning: instructions the recruiter asks us to remember are stored as rules and re-applied to every
//    new mandate for that client (or all clients), and also fed back into the weights.
import { all, getSetting, setSetting } from "./db.js";
import { applyPatch } from "./commands.js";
import { DEFAULT_WEIGHTS } from "./scoring.js";

const MIN_EXAMPLES = 3;
const POSITIVE = new Set(["Shortlisted", "Contacted", "Interested", "Qualified", "Submitted", "Client Review", "Interview Scheduled", "Interview Completed", "Further Round", "Selected", "Offer Discussion", "Offer Released", "Offer Accepted", "Joining Pending", "Joined"]);

function outcomeOf(match, events) {
  if (events.some((e) => POSITIVE.has(e.to_status)) || POSITIVE.has(match.status)) return 1;
  if (match.status === "Rejected" || events.some((e) => e.to_status === "Rejected")) return 0;
  return null;
}

export function deriveWeights(samples, base = DEFAULT_WEIGHTS) {
  // samples: [{outcome: 0|1, values: {criterionKey: value 0..1}}]
  const pos = samples.filter((s) => s.outcome === 1), neg = samples.filter((s) => s.outcome === 0);
  if (pos.length < MIN_EXAMPLES || neg.length < MIN_EXAMPLES) return { weights: null, examples: { positive: pos.length, negative: neg.length } };
  const mean = (arr, k) => { const v = arr.map((s) => s.values[k]).filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const weights = {}, signal = {};
  for (const k of Object.keys(base)) {
    const mp = mean(pos, k), mn = mean(neg, k);
    if (mp == null || mn == null) { weights[k] = base[k]; continue; }
    const diff = Math.max(-0.5, Math.min(0.5, (mp - mn) * 0.8));   // bounded ±50% adjustment
    weights[k] = Math.max(1, Math.round(base[k] * (1 + diff)));
    signal[k] = Math.round((mp - mn) * 100) / 100;
  }
  return { weights, signal, examples: { positive: pos.length, negative: neg.length } };
}

export async function learnWeights(env, owner = null) {
  const db = env.DB;
  const mandates = owner ? await all(db, "mandates", "SELECT id, client_name FROM mandates WHERE owner = ?", owner) : await all(db, "mandates", "SELECT id, client_name FROM mandates");
  const mids = new Set(mandates.map((m) => m.id));
  const matches = await all(db, "matches", "SELECT id, mandate_id, status, checklist FROM matches WHERE kind = 'resume' OR origin = 'naukri'");
  const events = await all(db, "status_events", "SELECT match_id, to_status FROM status_events");
  const evBy = {};
  for (const e of events) (evBy[e.match_id] ||= []).push(e);
  const clientOf = Object.fromEntries(mandates.map((m) => [m.id, m.client_name || "—"]));
  const samples = [];
  for (const m of matches) {
    if (!mids.has(m.mandate_id)) continue;
    const outcome = outcomeOf(m, evBy[m.id] || []);
    if (outcome === null) continue;
    const values = {};
    for (const c of m.checklist || []) if (c.weight > 0) values[c.key] = c.value;
    samples.push({ outcome, values, client: clientOf[m.mandate_id] });
  }
  const learned = { _all: deriveWeights(samples), updated_at: new Date().toISOString() };
  for (const client of new Set(samples.map((s) => s.client))) learned[client] = deriveWeights(samples.filter((s) => s.client === client));
  await setSetting(db, owner ? `learned_weights:${owner}` : "learned_weights", learned);
  return learned;
}

export async function weightsFor(env, clientName, owner = null) {
  const learned = (await getSetting(env.DB, owner ? `learned_weights:${owner}` : "learned_weights")) || {};
  const c = learned[clientName || "—"]?.weights, a = learned._all?.weights;
  return { weights: c || a || null, from: c ? "client" : a ? "all clients" : null };
}

/** Apply remembered rules (client-specific first, then global) to a fresh spec. */
export async function applyRememberedRules(env, mandate) {
  const rules = await all(env.DB, "rules", "SELECT * FROM rules WHERE owner = ? AND scope IN ('client','global') AND (client_name = ? OR scope = 'global') ORDER BY id", mandate.owner || "admin", mandate.client_name || "");
  let spec = mandate.spec, topN = mandate.top_n || 5;
  const applied = [];
  for (const r of rules) {
    const res = applyPatch({ spec, top_n: topN }, r.patch || {});
    spec = res.spec; topN = res.top_n;
    if (res.applied.length) applied.push({ rule: r.text, changes: res.applied });
  }
  return { spec, top_n: topN, applied, rules: rules.map((r) => r.text) };
}
