import { all, getSetting } from "./db.js";

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const day = (iso) => iso.slice(0, 10);

export async function observability(env, owner = "admin") {
  const db = env.DB;
  const since14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19).replace("T", " ");
  const today = new Date().toISOString().slice(0, 10);
  const events = await all(db, "events", "SELECT * FROM events WHERE created_at >= ? ORDER BY id DESC LIMIT 5000", since14);
  const req = events.filter((e) => e.kind === "request"), ai = events.filter((e) => e.kind === "ai"), jobs = events.filter((e) => e.kind === "job");
  const reqToday = req.filter((e) => day(e.created_at) === today), aiToday = ai.filter((e) => day(e.created_at) === today);
  const neuronsToday = aiToday.reduce((a, e) => a + (e.detail?.neurons || 0), 0);
  const tokensMonth = ai.filter((e) => e.created_at.slice(0, 7) === today.slice(0, 7) && e.detail?.provider === "codecraft").reduce((a, e) => a + (e.detail?.tokens || 0), 0);

  const days = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const series = days.map((d) => ({
    day: d.slice(5), requests: req.filter((e) => day(e.created_at) === d).length,
    errors: req.filter((e) => day(e.created_at) === d && +e.status >= 500).length,
    ai_calls: ai.filter((e) => day(e.created_at) === d).length,
    neurons: ai.filter((e) => day(e.created_at) === d).reduce((a, e) => a + (e.detail?.neurons || 0), 0),
  }));

  const byRoute = {};
  for (const e of req) { const r = (byRoute[e.name] ||= { route: e.name, count: 0, errors: 0, lat: [] }); r.count++; if (+e.status >= 500) r.errors++; r.lat.push(e.duration_ms); }
  const routes = Object.values(byRoute).map((r) => ({ route: r.route, count: r.count, errors: r.errors, p50: pct(r.lat, 0.5), p95: pct(r.lat, 0.95) })).sort((a, b) => b.count - a.count).slice(0, 15);
  const byModel = {};
  for (const e of ai) { const r = (byModel[e.name] ||= { model: e.name, calls: 0, errors: 0, neurons: 0, lat: [] }); r.calls++; if (e.status === "error") r.errors++; r.neurons += e.detail?.neurons || 0; r.lat.push(e.duration_ms); }
  const models = Object.values(byModel).map((r) => ({ ...r, lat: undefined, p50: pct(r.lat, 0.5), p95: pct(r.lat, 0.95) }));

  const counts = {};
  for (const t of ["mandates", "candidates", "matches", "status_events", "audit_log", "events"]) counts[t] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first())?.n || 0;
  counts.resumes_stored = (await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE resume_key IS NOT NULL").first())?.n || 0;
  const deep = await db.prepare("SELECT SUM(CASE WHEN deep_done=1 THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN deep_done=0 THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN deep_error<>'' THEN 1 ELSE 0 END) AS failed FROM matches WHERE kind='resume'").first();
  const jobStats = await all(db, "jobs", "SELECT type, status, COUNT(*) AS n FROM jobs GROUP BY type, status");
  const recentErrors = events.filter((e) => (e.kind === "request" && +e.status >= 500) || e.status === "error").slice(0, 20)
    .map((e) => ({ at: e.created_at, kind: e.kind, name: e.name, status: e.status, error: e.detail?.error || "" }));
  const learned = await getSetting(db, `learned_weights:${owner}`);
  const rules = await all(db, "rules", "SELECT * FROM rules WHERE owner = ? ORDER BY id DESC LIMIT 50", owner);
  const bands = await all(db, "matches", "SELECT band, COUNT(*) AS n FROM matches WHERE kind='resume' OR origin='naukri' GROUP BY band");

  return {
    kpis: { requests_today: reqToday.length, requests_14d: req.length, error_rate_14d: req.length ? Math.round((1000 * req.filter((e) => +e.status >= 500).length) / req.length) / 10 : 0,
      p50_ms: pct(req.map((e) => e.duration_ms), 0.5), p95_ms: pct(req.map((e) => e.duration_ms), 0.95),
      ai_calls_today: aiToday.length, ai_errors_today: aiToday.filter((e) => e.status === "error").length,
      neurons_today: neuronsToday, neuron_budget: 10000, neuron_pct: Math.min(100, Math.round(neuronsToday / 100)),
      codecraft_tokens_month: tokensMonth, codecraft_budget: 1000000, codecraft_pct: Math.min(100, Math.round(tokensMonth / 10000)),
      deep_done: deep?.done || 0, deep_pending: deep?.pending || 0, deep_failed: deep?.failed || 0,
      requests_budget: 100000 },
    series, routes, models, counts, jobs: jobStats, recent_errors: recentErrors, bands: Object.fromEntries(bands.map((b) => [b.band, b.n])),
    learning: { learned, rules: rules.map((r) => ({ id: r.id, text: r.text, scope: r.scope, client: r.client_name, at: r.created_at })) },
    model: env.LLM_MODEL, embed_model: env.EMBED_MODEL,
  };
}
