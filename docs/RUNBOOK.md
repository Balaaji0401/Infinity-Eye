# Infinity Eye — Operations Runbook

## Deployment model

`main` in GitHub is the production source. Cloudflare Workers Builds installs
the locked dependencies, builds the React application and runs
`npx wrangler deploy`. D1 and R2 are bound from `wrangler.toml`; the application
initializes its schema on first use.

## Normal update

1. Edit or upload the changed files in GitHub.
2. Commit them to `main`.
3. Open **Cloudflare → Workers & Pages → infinity-eye → Deployments**.
4. Confirm the newest deployment is marked successful.

No local commands are required.

## Initial access

```text
Username: admin
Password: admin
```

Before uploading real candidate information, add a production
`APP_PASSWORD` secret under **Settings → Variables and Secrets**. Cloudflare
keeps runtime secrets when later Git commits are deployed.

## Logs and failures

Open **Workers & Pages → infinity-eye → Logs**.

- `D1 binding DB is unavailable`: confirm the D1 binding exists in Settings.
- `no such table`: retry once; the Worker initializes all tables on first use.
- `AI unavailable`: check Workers AI usage and the `AI` binding.
- Resume upload/storage errors: confirm the `FILES` R2 binding exists.
- Wrong password: remove or reset the `APP_PASSWORD` secret, or use
  `admin/admin` only when no override secret exists.

## Optional settings

Production variables are stored in `wrangler.toml`. Edit them in Git so the
repository remains the source of truth:

- `APP_DISPLAY_NAME`
- `RECRUITER_NAME`
- `DEEP_TOP_N`
- `POOL_MIN_SCORE`
- `RECRUITER_HOURLY_COST`
- `MANUAL_MINUTES_PER_RESUME`

Keep passwords and API keys in Cloudflare Secrets, never in Git.

## Branch previews

The package is production-first. If you enable branch Previews, review their
D1/R2 bindings before adding test candidate data. The initial login remains
`admin/admin` unless the Preview has an `APP_PASSWORD` override.

## Recovery

- A failed deployment does not replace the last successful production version.
- Use the Cloudflare Deployments page to inspect or roll back a Worker version.
- D1 Time Travel/backups can restore database data independently of Worker code.
- R2 resume objects are independent of Git deployments.

## Free-plan monitoring

Review Workers requests/CPU, Workers AI neurons, D1 reads/writes/storage and R2
storage/operations in the Cloudflare dashboard. The configured app does not use
Cloudflare Containers.
