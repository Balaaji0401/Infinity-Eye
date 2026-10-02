# ∞ Eye: Deploying to Cloudflare

One Worker serves the API and the React app, with D1 (database), R2 (resume files), Workers AI and a five-minute cron. Everything fits the free plan. You do not need a local computer or a Wrangler login once the Git connection is made.

## 1. Repository layout

Cloudflare must find `package.json` and `wrangler.toml` at the **root** of the repository, with `src/` and `web/` beside them.

```text
package.json  package-lock.json  wrangler.toml  .node-version
src/  web/  scripts/  migrations/  config/  extras/  docs/  test/  sample_data/  .github/
```

`npm run build` starts with a preflight that checks this and stops with a plain message when something is off. Loose copies of source files at the root (for example `App.jsx`, `ai.js`, `package (1).json`) do not break the build but mean the folders were flattened during upload; delete them.

## 2. Put the files in GitHub without flattening them

Selecting files in the GitHub upload page flattens folders. Use git instead:

```powershell
git clone https://github.com/<your-account>/Infinity-Eye.git D:\work\Infinity-Eye
cd D:\work\Infinity-Eye
# remove everything except the .git folder
Get-ChildItem -Force | Where-Object Name -ne ".git" | Remove-Item -Recurse -Force
# copy the new tree, including hidden files (.github, .gitignore, .node-version)
robocopy "D:\Downloads\Infinity-Eye" . /E /XD .git
git add -A
git status          # check: package.json and wrangler.toml at the top, src/ and web/ as folders
git commit -m "Reorganize for Cloudflare deployment"
git push
```

(robocopy prints exit codes 0 to 7 for success.) Dragging whole *folders* onto the GitHub upload page also keeps the structure.

## 3. Cloudflare resources and settings

| Item | Value |
|---|---|
| Worker name | `infinity-eye`. Must equal the `name` in `wrangler.toml` and the Worker's name in the dashboard, otherwise Git builds fail with a name-mismatch error. |
| D1 database | `infinity-eye-db`; its id is already in `wrangler.toml`. The Worker creates and upgrades the tables itself on the first request. |
| R2 bucket | `infinity-eye-resumes`. Must exist in the same account (R2 → Create bucket). |
| Root directory | `/` (leave empty) |
| Build command | blank or `npm run build`. Either works: `wrangler.toml` has a `[build]` hook that builds the web app before every deploy, and the second run is skipped when `web/dist` is current. |
| Deploy command | `npx wrangler deploy` |
| Build variable (optional) | `NODE_VERSION` = `22` |

## 4. Secrets and variables

Set under Worker → Settings → Variables and Secrets.

| Name | Type | Purpose |
|---|---|---|
| `APP_USERS` | secret (remove the same-named line from `wrangler.toml` first) | Logins as `user:password,user:password`. Defaults are `admin:admin,tester:tester,guest:guest`; change them before real data. |
| `CODECRAFT_API_KEY` | secret | Chat model. Without it the app falls back to Workers AI. |
| `SERPER_API_KEY`, `EXA_API_KEY` | secret | Public-profile discovery (optional). |
| `GITHUB_TOKEN` | secret | Higher GitHub limits (optional). |
| `RESEND_API_KEY` | secret | Automatic email sending (optional); set `MAIL_FROM` in `wrangler.toml`. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | secret | Automatic WhatsApp sending (optional). |
| `PUBLIC_URL` | variable in `wrangler.toml` | The app's address, e.g. `https://infinity-eye.xxx.workers.dev`. Used in the reply links sent to candidates. |

`SECRET_KEY` is optional: if absent, the Worker creates a random signing key and keeps it in D1.

## 5. Verify after a deploy

1. Open the Worker URL and sign in.
2. Sidebar footer says *Assistant online* (or offline if no AI key is set; screening still works).
3. Create a mandate from the sample JD in `sample_data/` and upload the sample resumes.
4. Draft an outreach email for one candidate, approve it, and open its reply link in a **different browser window**. You should see the reply page ("Hi …, … reached out about this role"), not the sign-in page. This checks the `run_worker_first` setting.

## 6. If the Git build fails

Open the failed deployment and read the **first red line** of the log.

| Message contains | Cause | Fix |
|---|---|---|
| `[preflight] ERROR: Missing …` | Folders were flattened or the root directory is wrong | Section 2; root directory `/` |
| `[preflight] ERROR: … database_id` | Placeholder or wrong D1 id | Copy the id from D1 → infinity-eye-db into `wrangler.toml` |
| `R2 bucket … not found` | Bucket missing in this account | R2 → Create bucket `infinity-eye-resumes` |
| `D1 database … not found` | D1 id from another account | Use this account's `infinity-eye-db` id |
| Worker name / `name` mismatch | Dashboard Worker name differs from `wrangler.toml` | Rename one so both are `infinity-eye` |
| `[build-web] could not install` | Build environment has no network, or Node is old | Set `NODE_VERSION` = `22`; retry |
| `Node … is too old` | Build image default | `NODE_VERSION` = `22` |
| TOML parse error | A hand edit broke `wrangler.toml` | Compare with the file in this package |
| `web/dist` not found | Build hook did not run | Confirm `wrangler.toml` contains the `[build]` block |

## 7. Optional: deploy from GitHub Actions instead

`.github/workflows/deploy.yml` is manual by default. Add repository secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template plus D1 and R2 edit) and `CLOUDFLARE_ACCOUNT_ID`, disconnect Cloudflare's Git integration so the two do not race, then run the workflow from the Actions tab. Its log shows exactly where a failure happens.

## 8. Free-plan notes

- No containers, VM or paid database. PDF, DOCX and Excel text extraction runs in the browser because free Workers allow 10 ms of CPU per request.
- The AI fallback model is Llama 3.1 8B FP8 Fast; the default chat model is CodeCraft's (1M free tokens a month).
- The cron runs every five minutes to finish AI verification and queued searches.
