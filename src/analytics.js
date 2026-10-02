import { PIPELINE, all, stageIndex } from "./db.js";

const IDX = Object.fromEntries(PIPELINE.map((s, i) => [s, i]));
const FUNNEL = ["Sourced", "Shortlisted", "Contacted", "Interested", "Submitted", "Interview Scheduled", "Selected", "Offer Accepted", "Joined"];

function reached(match, events) {
  let best = Math.max(0, stageIndex(match.status));
  for (const e of events) best = Math.max(best, stageIndex(e.to_status));
  return best;
}

function fee(mandate, cand, match) {
  if (mandate.fee_type === "flat") return +mandate.fee_value || 0;
  const ctc = cand?.ctc_expected_lpa || cand?.ctc_current_lpa || mandate.spec?.ctc_max_lpa || 0;
  return Math.round((ctc * 100000 * (+mandate.fee_value || 0)) / 100);
}

export async function dashboard(env, mandateId = null, owner = null) {
  const db = env.DB, hourly = parseFloat(env.RECRUITER_HOURLY_COST || "500"), minutes = parseFloat(env.MANUAL_MINUTES_PER_RESUME || "6");
  const mandates = (owner ? await all(db, "mandates", "SELECT * FROM mandates WHERE owner = ?", owner) : await all(db, "mandates", "SELECT * FROM mandates")).filter((m) => !mandateId || m.id === mandateId);
  const mids = new Set(mandates.map((m) => m.id));
  const matches = (mandateId ? await all(db, "matches", "SELECT * FROM matches WHERE mandate_id = ?", mandateId) : await all(db, "matches", "SELECT * FROM matches")).filter((m) => mids.has(m.mandate_id));
  const cands = Object.fromEntries((await all(db, "candidates", "SELECT id, ctc_expected_lpa, ctc_current_lpa FROM candidates")).map((c) => [c.id, c]));
  const events = await all(db, "status_events", "SELECT * FROM status_events");
  const evBy = {};
  for (const e of events) (evBy[e.match_id] ||= []).push(e);
  const R = (m) => reached(m, evBy[m.id] || []);

  const resumes = matches.filter((m) => m.kind === "resume"), leads = matches.filter((m) => m.kind === "lead");
  const funnel = FUNNEL.map((s) => ({ stage: s, count: matches.filter((m) => R(m) >= IDX[s]).length }));
  funnel[0].count = resumes.length + leads.filter((m) => R(m) >= 1).length;

  const src = {};
  for (const m of matches) {
    const s = (src[m.origin || "upload"] ||= { candidates: 0, shortlisted: 0, interviewed: 0, joined: 0, sum: 0 });
    s.candidates++; s.sum += m.score || 0;
    const r = R(m);
    s.shortlisted += r >= IDX.Shortlisted; s.interviewed += r >= IDX["Interview Completed"]; s.joined += r >= IDX.Joined;
  }
  const sources = Object.entries(src).map(([source, v]) => ({ source, candidates: v.candidates, shortlisted: v.shortlisted, interviewed: v.interviewed, joined: v.joined,
    avg_score: v.candidates ? Math.round((v.sum / v.candidates) * 10) / 10 : 0 }));

  const bands = {};
  for (const m of resumes) bands[m.band] = (bands[m.band] || 0) + 1;
  const buckets = [0, 2, 4, 6, 8].map((i) => ({ range: `${i}–${i + 2}`, count: 0 }));
  for (const m of resumes) buckets[Math.min(4, Math.floor((m.score || 0) / 2))].count++;

  const decisive = events.filter((e) => ["Shortlisted", "Rejected"].includes(e.to_status) && matches.some((m) => m.id === e.match_id));
  const overrides = decisive.filter((e) => (e.to_status === "Shortlisted" && ["Review", "Do not advance"].includes(e.band_at_time)) || (e.to_status === "Rejected" && e.band_at_time === "A"));

  const perMandate = [], perClient = {}, tts = [];
  for (const md of mandates) {
    const mm = matches.filter((m) => m.mandate_id === md.id);
    const joined = mm.filter((m) => R(m) >= IDX.Joined), offered = mm.filter((m) => R(m) >= IDX["Offer Released"] && R(m) < IDX.Joined && !["Offer Declined", "Candidate Withdrew", "No-show", "Rejected"].includes(m.status));
    const revenue = joined.reduce((a, m) => a + fee(md, cands[m.candidate_id], m), 0), pipeline = offered.reduce((a, m) => a + fee(md, cands[m.candidate_id], m), 0);
    const cost = (md.recruiter_hours || 0) * hourly;
    const sl = mm.flatMap((m) => (evBy[m.id] || []).filter((e) => e.to_status === "Shortlisted").map((e) => new Date(e.created_at + "Z"))).sort((a, b) => a - b)[0];
    const created = new Date(md.created_at.replace(" ", "T") + "Z");
    const hrs = sl ? Math.round(((sl - created) / 36e5) * 10) / 10 : null;
    if (hrs != null) tts.push(hrs);
    perMandate.push({ id: md.id, code: md.code, title: md.title, client: md.client_name || "—", status: md.status,
      screened: mm.filter((m) => m.kind === "resume").length, leads: mm.filter((m) => m.kind === "lead").length,
      band_a: mm.filter((m) => m.band === "A").length, shortlisted: mm.filter((m) => R(m) >= IDX.Shortlisted).length,
      joined: joined.length, hours_to_shortlist: hrs, days_open: Math.floor((Date.now() - created) / 864e5), revenue, pipeline, cost, profit: revenue - cost });
    const c = (perClient[md.client_name || "—"] ||= { mandates: 0, submitted: 0, joined: 0, revenue: 0, pipeline: 0, cost: 0 });
    c.mandates++; c.submitted += mm.filter((m) => R(m) >= IDX.Submitted).length; c.joined += joined.length;
    c.revenue += revenue; c.pipeline += pipeline; c.cost += cost;
  }
  const clients = Object.entries(perClient).map(([client, v]) => ({ client, ...v, profit: v.revenue - v.cost })).sort((a, b) => b.revenue - a.revenue);
  const revenue = perMandate.reduce((a, p) => a + p.revenue, 0), cost = perMandate.reduce((a, p) => a + p.cost, 0);
  return {
    kpis: { jds: perMandate.length, open_jds: perMandate.filter((p) => p.status === "open").length, screened: resumes.length, leads: leads.length,
      shortlisted: funnel[1].count, joined: funnel[FUNNEL.length - 1].count,
      avg_hours_to_shortlist: tts.length ? Math.round((tts.reduce((a, b) => a + b, 0) / tts.length) * 10) / 10 : null,
      hours_saved: Math.round(((resumes.length * minutes) / 60) * 10) / 10,
      override_rate: decisive.length ? Math.round((100 * overrides.length) / decisive.length) : null,
      revenue, pipeline: perMandate.reduce((a, p) => a + p.pipeline, 0), cost, profit: revenue - cost },
    funnel, sources, bands, score_buckets: buckets, mandates: perMandate, clients,
    assumptions: { hourly_cost: hourly, manual_minutes_per_resume: minutes },
  };
}
