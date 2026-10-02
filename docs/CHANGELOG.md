# Changelog

Newest first. Features are described in README.md and covered against the Recruit EC manual in PLAN.md.

## What's new in v9 (Phases C and D: engagement and operations)

- **Outreach with approval.** Select candidates → Draft email / Draft WhatsApp from editable templates. Drafts wait in the Engagement queue; you approve each or all. With `RESEND_API_KEY` or Meta Cloud API secrets set, messages send automatically; otherwise you copy, send from your own mailbox or phone, and mark sent. Every message, delivery and reply is logged; "Do not contact" is honoured everywhere.
- **Candidate replies.** Each message carries a personal link to a one-tap response page: Interested, Call me, Need details, Later, Not interested, plus current/expected CTC, notice and preferred location. Replies update the status (Contacted → Interested / Not Interested), refresh the candidate's details, and create a task for you when a call-back is wanted. Phone replies can be recorded by the recruiter.
- **Interviews from the client's message.** Paste the email; the assistant extracts date, mode, link or venue, panel and instructions, highlights anything low-confidence or conflicting, and nothing is saved until you confirm. Then draft the candidate confirmation from a template. Confirmed / rescheduled / completed / no-show / cancelled, with tasks the day before and the day after.
- **Feedback and offers.** Record the client's result with reason codes while keeping their original words; manage offer CTC, dates and stage. Selected is not Joined: tasks for acceptance, pre-joining check-in and joining day.
- **Today's actions and shortlist awaiting review** on the Dashboard, interviews this week, and stale-detail prompts (CTC, notice, location older than 60 days) with a one-line "confirmed with candidate" update.
- **Settings page (admin):** templates, connected services, users.

Set `PUBLIC_URL` in `wrangler.toml` to your app's address so reply links in messages point to the right place.

## What's new in v8 (Phase B: pipeline completeness)

- **Full status machine** (manual §12): Sourcing → Engagement → Client → Offer → Closed, 25 statuses in grouped dropdowns. Rejected, Hold, Not Interested, Offer Declined, Candidate Withdrew and No-show require a reason code. AI verification moves Sourced → AI Analysed automatically. Old statuses migrate on first request.
- **Clients.** A client record is created from each mandate's client name. The Clients page holds approved preferences (what the client said), observed patterns (learned weights and remembered rules) and the **resubmission rule**: warn, block or allow within N days.
- **Submit to client.** Select candidates in Scout → Submit. Each submission is an immutable, versioned record with a snapshot of verified facts; the printable pack marks anything unverified as *Unclear* and never includes AI guesses. Resubmitting to the same position or to the same client within the window is blocked or warned per the client's rule, and overrides are recorded.
- **Candidate history** across all mandates (sourced, status changes with reasons, submissions) on every card, so "have we spoken to this person before?" is answered at a glance.
- **Recruitment tracker** download with every column from §8 (client status, reason, next action, source/submission/interview dates, outcome), plus the scoring model used.
- **Model version per match**: every score carries `scoring-v2` and the AI model that verified it.

## What's new in v7 (demo readiness)

- **Recruiter-grade wording.** No technical text in recruiter-facing screens: AI fallbacks, search strings and setup hints are either rephrased or shown to admin only. Raw search strings sit behind "Show search strings to paste"; a plain-English summary is shown instead.
- **Missing Information Checklist and "Needs a decision"** after Analyze, as the Recruit EC manual requires (§6.1, §6.2): nothing is assumed when the JD is silent or contradicts itself.
- **New sign-in page**: split-screen layout with inline validation, password visibility toggle and loading state.
- **Deployment hardening**: wrangler 4, pinned Node 22, no install-time build hook, and a GitHub Actions deploy workflow as an alternative with full logs. See DEPLOYMENT.md → "If the Git build fails".
- **PLAN.md**: feature status against the Recruit EC manual and the phased plan for what's pending.

## What's new in v6

- **Three logins with separate workspaces.** `admin:admin`, `tester:tester`, `guest:guest` (set in `APP_USERS` in `wrangler.toml`; move it to a secret with `wrangler secret put APP_USERS` before real use). Each user sees only their own mandates, candidates, conversations, rules, learned weights and dashboard. Sign out from the sidebar footer to switch users.
- **Fixes:** chat failing with "text.slice is not a function" when the model returned content parts instead of a string; the page jumping to the bottom on every chat message; score numbers overflowing the ring (now sized to fit, "10" instead of "10.0").

## What's new in v5

- **Sourcing you choose.** Each mandate has a channel selector (Talent pool, Naukri Resdex, LinkedIn & public profiles, GitHub, Job boards & inbound), set when the JD is analysed and editable on the Sourcing page. The agent runs only the ticked channels, and the Sourcing page shows only their cards.
- **Stable links.** Every view has its own URL (`/mandates/12/sourcing`, `/mandates/12/scout`, …) with a copy-link button, so you can bookmark or share a mandate's sourcing page. Each source card also has direct links: open Resdex, open the LinkedIn people search pre-filled with the Boolean, Google X-ray searches, GitHub, Indeed resume search.
- **Downloads per source.** CSV export of pulled profiles (rank, score, band, status, contact details, CTC, notice, activity, profile link, gaps) for all profiles or one source at a time.
- **Duplicate alerts.** A JD that matches an existing mandate (same title and client, identical text, or 92%+ similar requirements) is flagged before creation with links to the existing mandate; creation is blocked until you confirm. Resume uploads and profile imports report which people were already on file and were merged rather than duplicated.

## What's new in v4: chat-first

- **Home opens in Chat.** Talk before there is a JD to set context: client, plant location, budget, industries they like, things they refuse. Switch to **Analyze JD** and the JD is read together with that context (your notes override the JD where they conflict), and the mandate is seeded with what you said (budget, notice, preferences).
- **The chat follows the mandate.** On every mandate page a chat dock stays pinned at the bottom. Ask about the pulled profiles ("who has the shortest notice?", "compare Karthik and Ramya on GST", "why isn't Divya a fit?") and give instructions ("shortlist Karthik", "show 10 profiles", "budget 9 LPA"). Answers are grounded in the actual profile data, checklist evidence and gaps; instructions are applied and confirmed in the reply.
- **Cross-mandate questions** work from the Home chat with no mandate selected ("who did we shortlist for Acme?", "do we have any Tally people in Hosur?") using the mandate list and semantic talent search as context.
- Conversations are stored per mandate, so you can leave and come back. Each turn is one CodeCraft call of roughly 3–6k tokens.

## What's new in v3

- **AI via CodeCraft API.** Chat models now run through CodeCraft's OpenAI-compatible endpoint (1M free tokens a month, no card), default model `deepseek-v4-flash-0731`. Set the `CODECRAFT_API_KEY` secret; set `LLM_PROVIDER = "workers-ai"` to go back to Cloudflare. Embeddings stay on Workers AI (cheap, no account) unless you set `EMBED_PROVIDER = "codecraft"`. Note that resume text is processed by CodeCraft's upstream models; check their privacy policy before using it for client data you've promised to keep in-house.
- **Reach.** A browser extension (`extras/reach-extension`) sends the visible text of any recruiter results page (Resdex, LinkedIn, job boards) to ∞ Eye from your own logged-in browser; the AI extracts the candidates and scores them into Scout. A folder bridge (`extras/ie_reach.py`) auto-imports Resdex exports and resumes from your Downloads. Same pattern as Agent Reach: your session, your files, nothing headless, no stored passwords. See `extras/README.md`, including the terms note.
- **Semantic search everywhere.** Every candidate and JD gets an embedding. The talent pool is ranked by meaning before deterministic scoring; leads and imports get a "profile similarity" component in the score; a global Talent search box (sidebar) finds people by description; Exa neural search (`EXA_API_KEY`) joins Serper as a public-profile discovery engine.

## What's new in v2

- **Scout tab (default view).** After the JD is analysed, the top N profiles (default 5) appear in one table: name, company and role, job-search activity, phone and email where available, score out of 10 with band, status dropdown, open-profile link and resume download. N is changeable from the command box or Requirements.
- **Naukri Resdex import.** Run the generated Resdex search in your own browser, export the results to Excel, and import that file. Names, companies, activity status, contact details and profile links are mapped automatically and scored. Your Naukri login stays in your browser; the app never stores or uses it.
- **Resume analysis tab.** Resume upload is now a sub-feature: add resumes for shortlisted people and compare up to four candidates side by side on every requirement.
- **Command box.** Plain-English control of each mandate: "show 10 profiles", "budget 9 LPA", "notice up to 60 days", "SAP FICO is mandatory", "always prefer manufacturing for this client". Every command is logged as a rule; commands with "always" or "for this client" are remembered and applied to future mandates.
- **Self-learning scoring.** The engine compares the requirement scores of candidates you shortlist against those you reject and shifts the weights toward what predicts a shortlist, per client and overall (minimum three of each). New mandates start with the learned weights; existing ones can apply them with one click. Remembered prompt rules feed the same weights.
- **Observability page.** Requests, error rate and latency, AI calls and estimated neuron use against the daily free budget, verification backlog, per-route and per-model tables, data counts, background jobs, recent errors, and the current learned weights and rules.

### About Naukri credentials

The app deliberately does not store or use your Naukri login. Automated logins to Resdex are against Naukri's terms and would put the subscription at risk, and Cloudflare's free tier cannot run a browser anyway. The import flow gives the same result (structured profiles with contact details and activity status) in about a minute per search, using Resdex's own export feature. If Naukri offers you API access, it can be added as a connector.
