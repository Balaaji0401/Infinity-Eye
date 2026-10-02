// Fails fast, in plain words, when the repo layout or wrangler.toml would make a Cloudflare deploy fail.
// Run automatically by `npm run build`; also available as `npm run preflight`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [], warnings = [];
const has = (p) => existsSync(join(root, p));

// ---- Node
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) errors.push(`Node ${process.versions.node} is too old. Set NODE_VERSION=22 in the build environment variables (the repo's .node-version also says 22).`);

// ---- required files at the right place
for (const p of ["package.json", "wrangler.toml", "src/index.js", "src/schema.js", "web/package.json", "web/index.html", "web/vite.config.js", "web/src/main.jsx"])
  if (!has(p)) errors.push(`Missing ${p}. Expected layout: package.json and wrangler.toml at the repo root, with src/ and web/ folders beside them.`);

// ---- wrangler.toml sanity
if (has("wrangler.toml")) {
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8").replace(/^\s*#.*$/gm, "");
  const get = (re) => (toml.match(re) || [])[1];
  const main = get(/^main\s*=\s*"([^"]+)"/m), name = get(/^name\s*=\s*"([^"]+)"/m);
  const dbId = get(/\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]*)"/), bucket = get(/\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"([^"]*)"/);
  const assets = get(/\[assets\][\s\S]*?directory\s*=\s*"([^"]+)"/);
  if (main && !has(main)) errors.push(`wrangler.toml main = "${main}" does not exist.`);
  if (assets && assets.replace(/^\.\//, "") !== "web/dist") errors.push(`wrangler.toml [assets] directory is "${assets}" but the web build writes to ./web/dist.`);
  if (!dbId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dbId))
    errors.push(`wrangler.toml D1 database_id is "${dbId || ""}", not a real id. Copy it from Cloudflare → Storage & Databases → D1 → infinity-eye-db.`);
  if (!bucket) errors.push("wrangler.toml has no R2 bucket_name. Create the bucket in Cloudflare → R2 and put its exact name there.");
  if (!/run_worker_first\s*=/.test(toml)) warnings.push('wrangler.toml [assets] lacks run_worker_first = ["/api/*", "/r/*"]; candidate reply links would show the app instead of the reply page.');
  console.log(`[preflight] Worker name "${name}", D1 ${dbId ? dbId.slice(0, 8) + "…" : "?"}, R2 bucket "${bucket}". The Worker name must equal the Worker's name in the Cloudflare dashboard, or Git builds fail with a name-mismatch error.`);
}

// ---- stray files that mean the folder structure was flattened by an upload
const allowedRoot = new Set([".git", ".github", ".gitignore", ".node-version", ".dev.vars.example", ".wrangler", "README.md", "package.json", "package-lock.json", "wrangler.toml", "node_modules",
  "src", "web", "migrations", "scripts", "config", "docs", "extras", "test", "sample_data"]);
const stray = readdirSync(root).filter((f) => !allowedRoot.has(f));
if (stray.length) warnings.push(`Unexpected files at the repo root (an upload may have flattened the folders): ${stray.slice(0, 12).join(", ")}${stray.length > 12 ? ` and ${stray.length - 12} more` : ""}. They are ignored by the build but should be deleted.`);

for (const w of warnings) console.warn(`[preflight] warning: ${w}`);
if (errors.length) { for (const e of errors) console.error(`[preflight] ERROR: ${e}`); process.exit(1); }
console.log("[preflight] ok");
