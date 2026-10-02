// Guards the repository layout and the Cloudflare settings that a deploy depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const toml = readFileSync("wrangler.toml", "utf8").replace(/^\s*#.*$/gm, "");

test("required files sit where Cloudflare expects them", () => {
  for (const p of ["package.json", "package-lock.json", "wrangler.toml", ".node-version", "src/index.js", "src/schema.js", "web/package.json", "web/package-lock.json", "web/index.html",
    "web/vite.config.js", "web/src/main.jsx", "scripts/build-web.mjs", "scripts/preflight.mjs", "migrations/0001_baseline.sql"]) assert.ok(existsSync(p), `${p} is missing`);
});

test("no loose duplicates at the repo root", () => {
  const ok = new Set([".git", ".github", ".gitignore", ".node-version", ".dev.vars.example", ".wrangler", "README.md", "package.json", "package-lock.json", "wrangler.toml", "node_modules",
    "src", "web", "migrations", "scripts", "config", "docs", "extras", "test", "sample_data"]);
  assert.deepEqual(readdirSync(".").filter((f) => !ok.has(f)), []);
});

test("wrangler.toml: build hook, assets and worker-first routes", () => {
  assert.match(toml, /\[build\][\s\S]*?command\s*=\s*"npm run build"/);
  assert.match(toml, /main\s*=\s*"src\/index\.js"/);
  assert.match(toml, /\[assets\][\s\S]*?directory\s*=\s*"\.\/web\/dist"/);
  assert.match(toml, /run_worker_first\s*=\s*\[[^\]]*"\/r\/\*"[^\]]*\]/, "candidate reply links must reach the Worker, not the SPA fallback");
  assert.match(toml, /run_worker_first\s*=\s*\[[^\]]*"\/api\/\*"[^\]]*\]/);
  assert.match(toml, /database_id\s*=\s*"[0-9a-f-]{36}"/, "D1 database_id must be a real id");
});

test("every binding the code uses is declared", () => {
  for (const b of ["DB", "FILES", "AI", "ASSETS"]) assert.match(toml, new RegExp(`binding\\s*=\\s*"${b}"`), `binding ${b} missing`);
});

test("the baseline migration matches the schema version", async () => {
  const { SCHEMA_VERSION } = await import("../src/schema.js");
  assert.match(readFileSync("migrations/0001_baseline.sql", "utf8"), new RegExp(`schema version ${SCHEMA_VERSION}\\)`), "run: node scripts/gen-baseline.mjs");
});
