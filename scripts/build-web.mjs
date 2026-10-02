// Builds the React app (web/) into web/dist, which the Worker serves as static assets.
// Safe to run any number of times: it skips the build when web/dist is already newer than its sources, so it
// can be called both from Cloudflare's "Build command" and from wrangler's [build] hook without doing the work twice.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const out = join(web, "dist", "index.html");
const force = process.argv.includes("--force");

function newest(dir) {
  let t = 0;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name), s = statSync(p);
    t = Math.max(t, s.isDirectory() ? newest(p) : s.mtimeMs);
  }
  return t;
}
function run(args) {
  const r = spawnSync("npm", args, { cwd: web, stdio: "inherit", shell: true });
  return r.status === 0;
}

if (!existsSync(join(web, "package.json"))) {
  console.error("[build-web] web/package.json not found. The web/ folder must sit next to package.json at the repo root.");
  process.exit(1);
}
if (!force && existsSync(out)) {
  const sources = Math.max(newest(web), statSync(join(web, "package.json")).mtimeMs);
  if (statSync(out).mtimeMs >= sources) { console.log("[build-web] web/dist is up to date, skipping."); process.exit(0); }
}

console.log("[build-web] installing web dependencies…");
const lock = existsSync(join(web, "package-lock.json"));
if (!(lock && run(["ci", "--no-audit", "--no-fund"])) && !run(["install", "--no-audit", "--no-fund"])) {
  console.error("[build-web] could not install web dependencies. Check the network access of the build environment.");
  process.exit(1);
}
console.log("[build-web] building…");
if (!run(["run", "build"]) || !existsSync(out)) {
  console.error("[build-web] the web build failed. Run `npm --prefix web run build` locally to see the error.");
  process.exit(1);
}
console.log("[build-web] done: web/dist ready.");
