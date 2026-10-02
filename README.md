# ∞ Eye

Neurosaur's AI recruitment operating system. Paste or discuss a JD; the agent extracts the requirements, prepares Naukri and LinkedIn searches, finds public profiles, and ranks every candidate with evidence, hard gates and a score out of 10. Recruiters review, message candidates (with approval), schedule interviews, submit to clients, track offers and joining, and see revenue on the dashboard.

Runs entirely on Cloudflare's free serverless services: one Worker (API, app and cron), D1, R2 and Workers AI. No containers, no servers.

## Repository layout

```text
package.json  package-lock.json  wrangler.toml  .node-version      <- must sit at the repository root
src/            the Worker: API, screening, sourcing, chat, engagement
web/            the React app (builds to web/dist, served by the Worker)
scripts/        build-web.mjs, preflight.mjs, gen-baseline.mjs
migrations/     0001_baseline.sql (optional; the Worker upgrades its own schema)
config/         wrangler.local.toml for `npm run dev` only
extras/         Reach browser extension and folder bridge (run on a recruiter's PC)
docs/           DEPLOYMENT.md, RUNBOOK.md, PLAN.md, CHANGELOG.md
test/           unit tests and layout guards (npm test)
sample_data/    synthetic JD and 14 test resumes
.github/        optional manual deploy workflow
```

## Deploy

1. Put the **contents** of this folder at the root of your GitHub repository (see docs/DEPLOYMENT.md for the exact commands; do not upload files one by one, that flattens the folders).
2. Cloudflare → Workers & Pages → your Worker → Settings → Build: root directory `/`, deploy command `npx wrangler deploy`. The build command can be blank or `npm run build`; `wrangler.toml` builds the web app itself.
3. Set the secrets listed in docs/DEPLOYMENT.md, push, open the Worker URL, sign in.

`npm run build` runs a preflight that stops with a plain-English message if the layout, D1 id or bucket name is wrong, instead of failing deep inside the deploy.

## Local checks

```text
npm ci
npm test            # unit tests + layout guards
npm run build       # preflight + web build
npm run dev         # local Worker on http://localhost:8787 (no Workers AI)
```

## How it works

1. **JD → requirements.** Workers AI (Llama 3.1 8B FP8 Fast by default) extracts title, skills and tools (mandatory or preferred), experience, location, CTC, notice period, industry and education. A compliance check flags age, gender, marital-status, religion, caste and appearance criteria; the agent never screens on them.
2. **Sourcing.** Talent pool first (every candidate ever uploaded), then LinkedIn and other public profiles via search-engine discovery (Serper API, no LinkedIn login), GitHub for tech roles, and copy-ready Resdex Boolean searches for the recruiter to run in Naukri.
3. **Screening.** Resume text is extracted in the browser (pdf.js, mammoth). The Worker runs the deterministic fast pass (facts with resume-line evidence), hard gates, weighted scoring and banding for every resume in milliseconds. The top 15 per mandate then get an AI verification pass: the model must quote the resume for each fact, quotes are checked against the text, and anything unproven is marked "verify" and never overrides a verified fact.
4. **Review and track.** Candidate cards with checklist, gaps, screening questions and outreach drafts; status pipeline with notes; audited resume downloads.
5. **Dashboard.** Revenue, pipeline, cost, profit, funnel, source yield, score distribution, override rate.

## More

- docs/DEPLOYMENT.md: Cloudflare setup, settings, secrets, troubleshooting
- docs/RUNBOOK.md: operating procedures
- docs/PLAN.md: coverage of the Recruit EC manual
- docs/CHANGELOG.md: what changed in each version
- extras/README.md: Reach extension and folder bridge
