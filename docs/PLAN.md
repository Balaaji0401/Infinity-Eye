# ∞ Eye — Feature Plan against the Recruit EC Manual (v1.0)

Status key: **Done** = in the product today · **Partial** = exists but short of the manual · **Planned** = not built yet.

## Where we stand (manual section → status)

| # | Manual area | Status | Notes |
|---|---|---|---|
| 6.1 | Intake: JD + recruiter notes before analysis | Done | Chat-first Home: context before the JD, carried into analysis. |
| 6.1 | Missing Information Checklist | Done (v7) | Shown after Analyze; nothing is assumed. |
| 6.1 | "Ready for Sourcing" gate | Done | Start sourcing is the explicit human gate; nothing is matched before it. |
| 6.2 | Requirement matrix with evidence per requirement | Partial | Matrix exists (mandatory / preferred, every field editable); JD-side evidence text not stored yet. |
| 6.2 | Ambiguity/conflict alerts | Done (v7) | Experience and CTC conflicts flagged as "Needs a decision". |
| 6.3 | Mandatory vs preferred gating; Unclear ≠ No | Done | Hard gates; "unknown"/"unverified" statuses; high score with a critical miss is shown as Not a fit. |
| 6.4 | LinkedIn sourcing via permitted mechanism | Done | Search-engine discovery + Reach extension + direct search links; source and time recorded. |
| 6.5 | Naukri sourcing via permitted workflow | Done | Resdex export import + Reach; dedupe across searches. |
| 6.6 | Extraction with confidence/evidence; original stored separately | Done | Every fact carries resume evidence; AI facts verified against text; original file in R2. |
| 6.7 | Match card: requirement statuses, explanation, commercial fit | Done | Checklist, gaps, questions, summary, CTC/notice/location. |
| 6.8 | Dedup + ownership + previous history | Done (v8) | Dedup alerts; per-client resubmission rule (warn/block/allow, window in days); candidate history timeline across mandates on every card. |
| 6.9 | Bands, filters, choose 5/10/15/20, override with reason | Done | Scout top-N via chat or settings; status change with note. |
| 6.10 | Outreach email/WhatsApp with templates, approval, logging | Done (v9) | Templates (editable), drafts per candidate, recruiter approval, Resend / Meta Cloud API sending or copy-and-mark-sent, delivery and response log, opt-out honoured. |
| 6.11 | Response capture & interest qualification | Done (v9) | Personal reply link: Interested / Call me / Need details / Later / Not interested / Do not contact, plus CTC, notice, location; recruiter can record phone replies; ambiguous replies become tasks. |
| 6.12 | Client submission pack + immutable submission record | Done (v8) | Select candidates → Submit to client: versioned immutable record, client-ready printable pack with verified facts only and Unclear marked. |
| 6.13 | Interview event extraction & scheduling comms | Done (v9) | Paste the client's message → date, mode, link/venue, panel, instructions with low-confidence fields highlighted → recruiter saves → confirmation drafted from template; confirmed / rescheduled / completed / no-show / cancelled. |
| 6.14 | Interview feedback with structured reasons | Done (v9) | Result + reason codes + the client's original words; statuses and follow-up tasks update. |
| 6.15 | Offer/joining tracking (selected ≠ joined) | Done (v9) | Offer CTC, designation, offer and joining dates, stage; tasks for acceptance, pre-joining check-in and joining day. |
| 6.16 | Candidate memory & re-matching | Done | Talent pool matched by meaning first; history per candidate via matches. |
| 7 | Data model | Done (v9) | All entities from §7 exist: client, job, requirement, candidate, source, match, outreach, submission, interview, feedback, offer, activity log, history. |
| 8 | Recruitment tracker export | Done (v8) | Download tracker: all §8 columns including client status, reason, next action, source/submission/interview dates, outcome. |
| 9 | Match card UI | Done | Matches the recommended layout. |
| 10 | Explainability: decomposable score, model version stored, recalc on change | Done (v8) | Scoring version and AI model recorded on every match and shown on the card and in the tracker. |
| 11 | Communication automation | Done (v9) | Approval-first by default; automatic send when a provider is connected; follow-up tasks on no reply; opt-out respected. |
| 12 | Status state machine | Done (v8) | Full §12 machine in five groups, reason codes required for Rejected/Hold/Not Interested/Declined/Withdrew/No-show; legacy statuses migrated. |
| 13 | Exception handling | Done (v9) | Missing data, conflicts, duplicates, AI unavailable, resubmission block, stale-data prompts with last-verified dates, ambiguous interview details flagged. |
| 14 | Client-specific intelligence, isolation | Done (v8) | Clients page separates approved preferences (entered) from observed patterns (learned weights, remembered rules); isolated per user. |
| 15 | Recruiter dashboard widgets | Done (v9) | Today's actions (auto-generated tasks), interviews this week, shortlist awaiting review, stale details to re-verify. |

## Plan

**Phase A — Demo readiness (this release, v7)**
- Professional wording everywhere; no technical strings in recruiter-facing screens (admin-only hints).
- Missing Information Checklist and Needs-a-decision alerts after Analyze.
- Plain-English search summary; raw search strings behind a toggle.
- Split-screen login.
- Deployment hardening (clean build, GitHub Actions alternative).

**Phase B — Pipeline completeness — DONE in v8**
1. Full status state machine from §12 with stage groups (Sourcing → Engagement → Client → Offer → Closed) and reason codes on Reject/Hold.
2. Client entity: clients page, preferences (approved) vs observed patterns, per-client ownership rules (block resubmission to same client/job unless overridden).
3. Submission pack: client-ready candidate summary (verified data only, Unclear marked), PDF export, immutable submission record with version.
4. Candidate history timeline on the match card: sourced, contacted, submitted, interviewed, outcome, across mandates.
5. Tracker export with all §8 columns (Excel via SheetJS in the browser).
6. Store model/provider/version on every match result (§10).

**Phase C — Engagement automation — DONE in v9**
7. Outreach: email (Resend/SMTP) and WhatsApp (Business API) from approved templates, recruiter approval by default, delivery and response log, opt-out handling.
8. Response capture: Interested / Not interested / Call me / Need details / Later, with a short qualification form (CTC, notice, location, shift) and recruiter routing for ambiguous replies.
9. Interview events: paste client email → structured event (date, mode, link/address, panel) → recruiter validates → candidate confirmation message; statuses for confirmed, rescheduled, no-show, completed.
10. Feedback & offers: structured rejection reasons, interview rounds, offer details and dates, joining follow-up tasks, selected ≠ joined.

**Phase D — Recruiter operations — DONE in v9**
11. Today's actions widget (follow-ups, interviews, submissions due) and "Shortlist awaiting review".
12. Stale-data prompts (last verified date on dynamic fields) and a one-click "refresh from new resume".
13. Admin settings page: scoring weights, status lists, templates, users and roles.

## What's still open

- Automatic sending needs your provider keys: `RESEND_API_KEY` (email) and `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` (Meta Cloud API). Without them every message is approved in the app and sent by the recruiter from their own mailbox or phone, then marked sent.
- Inbound replies by email/WhatsApp are captured through the personal reply link, not by reading the mailbox. Mailbox or WhatsApp webhook ingestion is a follow-on item.
- The §9 match card and §8 tracker are complete; a client-facing portal for feedback is not planned.

## Naming
The manual calls the product **Recruit EC**. The app currently says **∞ Eye**. Both are one string in `web/src` and `wrangler.toml`; tell me which to use for the L&T demo.
