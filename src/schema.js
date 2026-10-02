// The production database is initialized on first use. This keeps a Git-connected
// deployment self-contained: Wrangler creates the D1 binding and the Worker creates
// its tables before serving the first authenticated request.
export const SCHEMA_VERSION = "8";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mandates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  client_name TEXT DEFAULT '',
  jd_text TEXT DEFAULT '',
  spec TEXT DEFAULT '{}',
  search_plan TEXT DEFAULT '{}',
  fee_type TEXT DEFAULT 'percent',
  fee_value REAL DEFAULT 8.33,
  recruiter_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  top_n INTEGER DEFAULT 5,
  embedding TEXT,
  sources TEXT DEFAULT '["pool","naukri","linkedin","github"]',
  owner TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  email TEXT,
  phone TEXT,
  current_title TEXT,
  current_company TEXT,
  location TEXT,
  total_exp_years REAL,
  ctc_current_lpa REAL,
  ctc_expected_lpa REAL,
  notice_days INTEGER,
  education TEXT,
  top_skills TEXT DEFAULT '[]',
  source TEXT DEFAULT 'upload',
  profile_url TEXT,
  resume_key TEXT,
  resume_filename TEXT,
  resume_text TEXT DEFAULT '',
  file_hash TEXT,
  active_status TEXT,
  last_active TEXT,
  embedding TEXT,
  owner TEXT DEFAULT 'admin',
  last_verified_at TEXT,
  opt_out INTEGER DEFAULT 0,
  preferred_location TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cand_owner ON candidates(owner);
CREATE INDEX IF NOT EXISTS idx_cand_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_cand_phone ON candidates(phone);
CREATE INDEX IF NOT EXISTS idx_cand_hash ON candidates(file_hash);
CREATE INDEX IF NOT EXISTS idx_cand_url ON candidates(profile_url);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mandate_id INTEGER NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  origin TEXT DEFAULT 'upload',
  kind TEXT DEFAULT 'resume',
  facts TEXT DEFAULT '{}',
  score REAL DEFAULT 0,
  band TEXT DEFAULT 'Review',
  checklist TEXT DEFAULT '[]',
  gaps TEXT DEFAULT '[]',
  questions TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  outreach TEXT DEFAULT '',
  stage TEXT DEFAULT 'provisional',
  deep_done INTEGER DEFAULT 0,
  deep_error TEXT DEFAULT '',
  status TEXT DEFAULT 'Sourced',
  model TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(mandate_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_match_mandate ON matches(mandate_id);
CREATE INDEX IF NOT EXISTS idx_match_deep ON matches(kind, deep_done);

CREATE TABLE IF NOT EXISTS status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT,
  band_at_time TEXT,
  note TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_match ON status_events(match_id);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  locations TEXT DEFAULT '[]',
  preferences TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  ownership_rule TEXT DEFAULT 'warn',
  resubmission_days INTEGER DEFAULT 180,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner, name)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  client_name TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  submitted_by TEXT DEFAULT '',
  snapshot TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_candidate ON submissions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_sub_mandate ON submissions(mandate_id);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  kind TEXT NOT NULL,             -- outreach | interview | selection | rejection | followup
  channel TEXT DEFAULT 'email',   -- email | whatsapp
  name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  channel TEXT DEFAULT 'email',
  kind TEXT DEFAULT 'outreach',
  template_id INTEGER,
  to_address TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT DEFAULT 'draft',    -- draft | approved | sent | failed | responded
  provider_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  response TEXT DEFAULT '',
  response_detail TEXT DEFAULT '{}',
  token TEXT UNIQUE,
  approved_by TEXT DEFAULT '',
  sent_at TEXT,
  responded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outreach_match ON outreach(match_id);
CREATE INDEX IF NOT EXISTS idx_outreach_mandate ON outreach(mandate_id);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  round INTEGER DEFAULT 1,
  mode TEXT DEFAULT 'online',     -- online | in-person | phone
  scheduled_at TEXT,
  duration_min INTEGER,
  location_or_link TEXT DEFAULT '',
  panel TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  documents TEXT DEFAULT '',
  status TEXT DEFAULT 'proposed', -- proposed | scheduled | confirmed | rescheduled | completed | no_show | cancelled
  source_text TEXT DEFAULT '',
  confidence TEXT DEFAULT '{}',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interviews_match ON interviews(match_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  interview_id INTEGER,
  result TEXT NOT NULL,           -- Selected | Rejected | Hold | Further Round | Offer Discussion | Candidate Withdrew
  reasons TEXT DEFAULT '[]',
  original_text TEXT DEFAULT '',
  recorded_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  ctc_offered_lpa REAL,
  designation TEXT DEFAULT '',
  offer_date TEXT,
  joining_date TEXT,
  status TEXT DEFAULT 'discussion', -- discussion | released | accepted | declined | joined | no_show | withdrawn
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT DEFAULT 'admin',
  mandate_id INTEGER,
  match_id INTEGER,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'followup',
  due_at TEXT,
  done INTEGER DEFAULT 0,
  done_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner, done, due_at);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  payload TEXT DEFAULT '{}',
  status TEXT DEFAULT 'queued',
  error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT DEFAULT '',
  mandate_id INTEGER,
  text TEXT NOT NULL,
  patch TEXT DEFAULT '{}',
  scope TEXT DEFAULT 'mandate',
  owner TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  name TEXT,
  status TEXT,
  duration_ms INTEGER DEFAULT 0,
  detail TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mandate_id INTEGER,
  owner TEXT DEFAULT 'admin',
  title TEXT DEFAULT '',
  messages TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_mandate ON conversations(mandate_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '${SCHEMA_VERSION}', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
`;

// D1Database.exec treats newlines as statement boundaries. Because CREATE TABLE
// statements span several lines, prepare each complete semicolon-delimited
// statement and send them as one transactional batch instead.
export const SCHEMA_STATEMENTS = SCHEMA_SQL.split(";").map((statement) => statement.trim()).filter(Boolean);

// Column additions for databases created at an earlier schema version. Each runs on its own and
// "duplicate column" errors are ignored, so this is safe on fresh and upgraded databases alike.
export const UPGRADE_STATEMENTS = [
  "ALTER TABLE mandates ADD COLUMN top_n INTEGER DEFAULT 5",
  "ALTER TABLE candidates ADD COLUMN active_status TEXT",
  "ALTER TABLE candidates ADD COLUMN last_active TEXT",
  "ALTER TABLE candidates ADD COLUMN embedding TEXT",
  "ALTER TABLE mandates ADD COLUMN embedding TEXT",
  "ALTER TABLE mandates ADD COLUMN sources TEXT DEFAULT '[\"pool\",\"naukri\",\"linkedin\",\"github\"]'",
  "ALTER TABLE mandates ADD COLUMN owner TEXT DEFAULT 'admin'",
  "ALTER TABLE candidates ADD COLUMN owner TEXT DEFAULT 'admin'",
  "ALTER TABLE conversations ADD COLUMN owner TEXT DEFAULT 'admin'",
  "ALTER TABLE rules ADD COLUMN owner TEXT DEFAULT 'admin'",
  "ALTER TABLE matches ADD COLUMN model TEXT DEFAULT ''",
  "ALTER TABLE status_events ADD COLUMN reason TEXT DEFAULT ''",
  "ALTER TABLE status_events ADD COLUMN actor TEXT DEFAULT ''",
  "ALTER TABLE candidates ADD COLUMN last_verified_at TEXT",
  "ALTER TABLE candidates ADD COLUMN opt_out INTEGER DEFAULT 0",
  "ALTER TABLE candidates ADD COLUMN preferred_location TEXT",
  "UPDATE candidates SET last_verified_at = created_at WHERE last_verified_at IS NULL",
  "UPDATE matches SET status = CASE status WHEN 'New' THEN 'Sourced' WHEN 'Screened' THEN 'AI Analysed' WHEN 'Submitted to client' THEN 'Submitted' WHEN 'Interview scheduled' THEN 'Interview Scheduled' WHEN 'Interviewed' THEN 'Interview Completed' WHEN 'Offered' THEN 'Offer Released' WHEN 'On hold' THEN 'Hold' ELSE status END",
  "UPDATE status_events SET to_status = CASE to_status WHEN 'New' THEN 'Sourced' WHEN 'Screened' THEN 'AI Analysed' WHEN 'Submitted to client' THEN 'Submitted' WHEN 'Interview scheduled' THEN 'Interview Scheduled' WHEN 'Interviewed' THEN 'Interview Completed' WHEN 'Offered' THEN 'Offer Released' WHEN 'On hold' THEN 'Hold' ELSE to_status END, from_status = CASE from_status WHEN 'New' THEN 'Sourced' WHEN 'Screened' THEN 'AI Analysed' WHEN 'Submitted to client' THEN 'Submitted' WHEN 'Interview scheduled' THEN 'Interview Scheduled' WHEN 'Interviewed' THEN 'Interview Completed' WHEN 'Offered' THEN 'Offer Released' WHEN 'On hold' THEN 'Hold' ELSE from_status END",
];

let schemaPromise;

export function ensureSchema(db) {
  if (!db) throw new Error("D1 binding DB is unavailable.");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const current = await db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first().catch(() => null);
      if (current?.value !== SCHEMA_VERSION) {
        // Column additions only matter for a database that already exists at an older version.
        for (const statement of current?.value ? UPGRADE_STATEMENTS : []) {
          try { await db.prepare(statement).run(); } catch (e) { if (!/duplicate column/i.test(String(e.message || e))) throw e; }
        }
        await db.batch(SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)));
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

const randomHex = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)),
  (value) => value.toString(16).padStart(2, "0")).join("");

// SECRET_KEY can still be supplied as a Cloudflare secret. When it is omitted,
// a strong signing key is generated once and persisted in D1 automatically.
export async function getSigningSecret(env) {
  if (env.SECRET_KEY) return env.SECRET_KEY;
  await ensureSchema(env.DB);
  let row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'auth_signing_secret'").first();
  if (!row?.value) {
    const generated = randomHex();
    await env.DB.prepare(
      "INSERT INTO app_meta (key, value, updated_at) VALUES ('auth_signing_secret', ?, datetime('now')) ON CONFLICT(key) DO NOTHING"
    ).bind(generated).run();
    row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = 'auth_signing_secret'").first();
    return row?.value || generated;
  }
  return row.value;
}
