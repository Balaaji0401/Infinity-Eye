// Regenerates migrations/0001_baseline.sql from src/schema.js (the single source of truth).
// The Worker upgrades its own database on the first request, so running migrations is optional; this file exists
// for people who prefer `wrangler d1 migrations apply`. Every statement is idempotent (IF NOT EXISTS).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from "../src/schema.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0001_baseline.sql");
const sql = `-- Generated from src/schema.js by scripts/gen-baseline.mjs (schema version ${SCHEMA_VERSION}). Do not edit by hand.
-- Optional: the Worker creates and upgrades these tables itself on the first request after a deploy.
${SCHEMA_STATEMENTS.map((s) => s.replace(/;?\s*$/, ";")).join("\n\n")}
`;
writeFileSync(out, sql);
console.log(`wrote migrations/0001_baseline.sql (${SCHEMA_STATEMENTS.length} statements, schema v${SCHEMA_VERSION})`);
