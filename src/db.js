// Thin D1 helpers. JSON columns are parsed/serialised here so the rest of the code sees objects.
// Status state machine (Recruit EC manual §12). Groups are workflow stages, not hiring decisions.
export const STATUS_GROUPS = [
  ["Sourcing", ["Sourced", "AI Analysed", "Recruiter Reviewed", "Shortlisted"]],
  ["Engagement", ["Contacted", "Interested", "Not Interested", "Qualified"]],
  ["Client", ["Submitted", "Client Review", "Interview Scheduled", "Interview Completed", "Further Round", "Selected", "Rejected", "Hold"]],
  ["Offer", ["Offer Discussion", "Offer Released", "Offer Accepted", "Offer Declined", "Joining Pending", "Joined", "No-show", "Candidate Withdrew"]],
  ["Closed", ["Closed", "Replacement Required"]],
];
export const STATUSES = STATUS_GROUPS.flatMap(([, s]) => s);
/** Linear progress order for funnels; terminal/negative statuses map onto the stage they end at. */
export const PIPELINE = ["Sourced", "AI Analysed", "Recruiter Reviewed", "Shortlisted", "Contacted", "Interested", "Qualified", "Submitted", "Client Review",
  "Interview Scheduled", "Interview Completed", "Selected", "Offer Released", "Offer Accepted", "Joined"];
export const STAGE_OF = { "Further Round": "Interview Completed", Rejected: "Client Review", Hold: "Client Review", "Not Interested": "Contacted",
  "Offer Discussion": "Selected", "Offer Declined": "Offer Released", "Joining Pending": "Offer Accepted", "No-show": "Offer Accepted", "Candidate Withdrew": "Selected",
  Closed: null, "Replacement Required": "Joined" };
export const REASON_STATUSES = ["Rejected", "Hold", "Not Interested", "Offer Declined", "Candidate Withdrew", "No-show", "Replacement Required"];
export const REASON_CODES = ["Skill gap", "Experience", "Compensation", "Location", "Notice period", "Communication", "Role fit", "Internal candidate", "Position on hold", "Candidate unavailable", "Other"];
export const stageIndex = (status) => { const s = STAGE_OF[status] === undefined ? status : STAGE_OF[status]; return s === null ? -1 : PIPELINE.indexOf(s); };

const J = { mandates: ["spec", "search_plan", "sources"], clients: ["locations", "preferences"], submissions: ["snapshot"], outreach: ["response_detail"], interviews: ["confidence"], feedback: ["reasons"], candidates: ["top_skills"], matches: ["facts", "checklist", "gaps", "questions"], jobs: ["payload"], audit_log: ["detail"], rules: ["patch"], events: ["detail"], conversations: ["messages"] };

/** Observability event. Fire-and-forget; never throws. */
export async function logEvent(db, kind, name, status, durationMs = 0, detail = {}) {
  try { await db.prepare("INSERT INTO events (kind, name, status, duration_ms, detail) VALUES (?,?,?,?,?)").bind(kind, name, String(status), Math.round(durationMs), JSON.stringify(detail)).run(); } catch {}
}
export async function getSetting(db, key, fallback = null) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first().catch(() => null);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export const setSetting = (db, key, value) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, JSON.stringify(value)).run();

export function parseRow(table, row) {
  if (!row) return null;
  for (const c of J[table] || []) if (typeof row[c] === "string") { try { row[c] = JSON.parse(row[c]); } catch { row[c] = null; } }
  return row;
}
const ser = (table, obj) => {
  const o = { ...obj };
  for (const c of J[table] || []) if (c in o && o[c] !== null && typeof o[c] !== "string") o[c] = JSON.stringify(o[c]);
  for (const k of Object.keys(o)) if (typeof o[k] === "boolean") o[k] = o[k] ? 1 : 0;
  return o;
};

export async function insert(db, table, obj) {
  const o = ser(table, obj), keys = Object.keys(o);
  const r = await db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING *`)
    .bind(...keys.map((k) => o[k] ?? null)).first();
  return parseRow(table, r);
}

export async function update(db, table, id, obj) {
  const o = ser(table, obj), keys = Object.keys(o);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(",") + (["matches", "jobs", "conversations"].includes(table) ? ", updated_at = datetime('now')" : "");
  await db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).bind(...keys.map((k) => o[k] ?? null), id).run();
}

export async function one(db, table, sql, ...binds) {
  return parseRow(table, await db.prepare(sql).bind(...binds).first());
}
export async function all(db, table, sql, ...binds) {
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results.map((r) => parseRow(table, r));
}
export const get = (db, table, id) => one(db, table, `SELECT * FROM ${table} WHERE id = ?`, id);

export async function audit(db, action, entity, entityId, detail = {}) {
  await db.prepare("INSERT INTO audit_log (action, entity, entity_id, detail) VALUES (?,?,?,?)").bind(action, entity, entityId, JSON.stringify(detail)).run();
}
export const enqueue = (db, type, payload) => db.prepare("INSERT INTO jobs (type, payload) VALUES (?,?)").bind(type, JSON.stringify(payload)).run();
