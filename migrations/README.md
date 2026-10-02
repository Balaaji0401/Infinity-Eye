# migrations

`0001_baseline.sql` is the complete current schema, generated from `src/schema.js`. You do not need to run it: the Worker creates
and upgrades its own tables on the first request after every deploy.

Use it only if you prefer explicit migrations: `npx wrangler d1 migrations apply DB --remote`. All statements are idempotent.

When `src/schema.js` changes, regenerate it with `node scripts/gen-baseline.mjs`.
