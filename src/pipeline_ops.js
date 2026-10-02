// Phase B operations: clients & ownership rules, client submissions (immutable), candidate history, tracker export.
import { REASON_CODES, REASON_STATUSES, STATUSES, all, audit, get, insert, one, stageIndex, update } from "./db.js";
import { rankKey } from "./scoring.js";

// ------------------------------------------------------------------ clients
export async function ensureClient(env, owner, name) {
  const n = (name || "").trim();
  if (!n) return null;
  let c = await one(env.DB, "clients", "SELECT * FROM clients WHERE owner = ? AND name = ? COLLATE NOCASE", owner, n);
  if (!c) c = await insert(env.DB, "clients", { owner, name: n });
  return c;
}

/** Ownership / resubmission check before a candidate is submitted to a client. */
export async function submissionConflict(env, owner, match, mandate) {
  const client = await ensureClient(env, owner, mandate.client_name);
  if (!client) return null;
  const days = client.resubmission_days || 180;
  const rows = await all(env.DB, "submissions", `SELECT s.*, md.code, md.title FROM submissions s JOIN mandates md ON md.id = s.mandate_id
    WHERE s.owner = ? AND s.candidate_id = ? AND s.client_name = ? COLLATE NOCASE AND s.created_at >= datetime('now', ?) ORDER BY s.id DESC`, owner, match.candidate_id, mandate.client_name, `-${days} days`);
  const prior = rows.filter((r) => r.mandate_id !== mandate.id);
  const samePosition = rows.find((r) => r.mandate_id === mandate.id);
  if (!prior.length && !samePosition) return null;
  return { rule: client.ownership_rule || "warn", days, same_position: !!samePosition,
    prior: prior.map((r) => ({ code: r.code, title: r.title, at: r.created_at, version: r.version })) };
}

// ------------------------------------------------------------------ submissions
function unclear(v) { return v === null || v === undefined || v === ""; }

/** Client-ready snapshot: verified or recruiter-stated facts only; anything else is marked Unclear. */
export function buildSnapshot(mandate, match, cand) {
  const checks = (match.checklist || []).filter((c) => c.key !== "mandatory_skills");
  const critical = checks.filter((c) => c.key === "skill" || ["experience", "location", "ctc", "notice"].includes(c.key));
  const toStatus = (c) => (c.status === "meets" ? "Verified" : c.status === "unverified" || c.status === "unknown" ? "Unclear" : c.status === "partial" ? "Partially verified" : "Not verified");
  return {
    role: mandate.title, client: mandate.client_name, mandate_code: mandate.code,
    candidate: { name: cand.name, current_title: cand.current_title || "Unclear", current_company: cand.current_company || "Unclear", location: cand.location || "Unclear",
      total_exp_years: unclear(cand.total_exp_years) ? "Unclear" : cand.total_exp_years, education: cand.education || "Unclear",
      ctc_current_lpa: unclear(cand.ctc_current_lpa) ? "Unclear" : cand.ctc_current_lpa, ctc_expected_lpa: unclear(cand.ctc_expected_lpa) ? "Unclear" : cand.ctc_expected_lpa,
      notice_days: unclear(cand.notice_days) ? "Unclear" : cand.notice_days, top_skills: cand.top_skills || [] },
    score: match.score, band: match.band,
    critical_requirements: critical.map((c) => ({ requirement: c.criterion, status: toStatus(c), evidence: c.status === "meets" || c.status === "partial" ? c.evidence || c.detail : "" })),
    preferred: checks.filter((c) => c.key === "preferred_skills" || c.key === "industry").map((c) => ({ requirement: c.criterion, status: toStatus(c), evidence: c.detail })),
    strengths: checks.filter((c) => c.status === "meets" && c.weight > 0).map((c) => `${c.criterion}: ${c.detail}`),
    unclear: checks.filter((c) => ["unknown", "unverified"].includes(c.status)).map((c) => c.criterion),
    summary: match.summary || "", model: match.model || "",
  };
}

export async function createSubmissions(env, owner, mandate, matchIds, user, override = false) {
  const results = [], blocked = [];
  for (const id of matchIds) {
    const m = await get(env.DB, "matches", id);
    if (!m || m.mandate_id !== mandate.id) continue;
    const conflict = await submissionConflict(env, owner, m, mandate);
    if (conflict && conflict.rule === "block" && !override) { blocked.push({ match_id: id, conflict }); continue; }
    if (conflict && conflict.same_position && !override) { blocked.push({ match_id: id, conflict }); continue; }
    const cand = await get(env.DB, "candidates", m.candidate_id);
    const prev = await one(env.DB, "submissions", "SELECT MAX(version) AS v FROM submissions WHERE match_id = ?", id);
    const sub = await insert(env.DB, "submissions", { owner, mandate_id: mandate.id, match_id: id, candidate_id: cand.id, client_name: mandate.client_name || "",
      version: (prev?.v || 0) + 1, submitted_by: user, snapshot: buildSnapshot(mandate, m, cand) });
    if (stageIndex(m.status) < stageIndex("Submitted")) {
      await insert(env.DB, "status_events", { match_id: m.id, from_status: m.status, to_status: "Submitted", band_at_time: m.band, note: `Submission pack v${sub.version}`, actor: user });
      await update(env.DB, "matches", m.id, { status: "Submitted" });
    }
    await audit(env.DB, "submitted_to_client", "match", m.id, { submission_id: sub.id, version: sub.version, user, override });
    results.push({ ...sub, name: cand.name });
  }
  return { submissions: results, blocked };
}

/** Printable HTML pack for one or more submissions. */
export function renderPack(mandate, subs, recruiter) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const cards = subs.map((s) => { const p = s.snapshot, c = p.candidate; return `
  <section class="cand">
    <header><h2>${esc(c.name)}</h2><div class="sub">${esc(c.current_title)} · ${esc(c.current_company)} · ${esc(c.location)}</div>
      <div class="score">Match ${esc(p.score)}/10 <span class="band">${esc(p.band === "Do not advance" ? "Review" : p.band)}</span></div></header>
    <table class="facts">${row("Total experience", c.total_exp_years === "Unclear" ? "Unclear" : c.total_exp_years + " years")}${row("Qualification", c.education)}
      ${row("Current CTC", c.ctc_current_lpa === "Unclear" ? "Unclear" : "₹" + c.ctc_current_lpa + " LPA")}${row("Expected CTC", c.ctc_expected_lpa === "Unclear" ? "Unclear" : "₹" + c.ctc_expected_lpa + " LPA")}
      ${row("Notice period", c.notice_days === "Unclear" ? "Unclear" : c.notice_days === 0 ? "Immediate" : c.notice_days + " days")}${row("Key skills", (c.top_skills || []).join(", ") || "—")}</table>
    <h3>Critical requirements</h3>
    <table class="req"><thead><tr><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
      ${p.critical_requirements.map((r) => `<tr class="${r.status === "Verified" ? "ok" : r.status === "Unclear" ? "unc" : "no"}"><td>${esc(r.requirement)}</td><td>${esc(r.status)}</td><td>${esc(r.evidence)}</td></tr>`).join("")}
    </tbody></table>
    ${p.summary ? `<h3>Summary</h3><p>${esc(p.summary)}</p>` : ""}
    ${p.unclear.length ? `<p class="unc-note"><b>To be verified:</b> ${esc(p.unclear.join(", "))}</p>` : ""}
    <footer>Submission v${esc(s.version)} · ${esc(String(s.created_at).slice(0, 16))} UTC · by ${esc(s.submitted_by)}</footer>
  </section>`; }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(mandate.code)} ${esc(mandate.title)} — Candidate submission</title>
<style>body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0;padding:32px;max-width:900px}h1{font-size:22px;margin:0}
.head{border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:20px}.head .meta{color:#555;margin-top:4px}
.cand{border:1px solid #ddd;border-radius:10px;padding:18px 20px;margin-bottom:18px;page-break-inside:avoid}.cand header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h2{font-size:18px;margin:0}.sub{color:#555}.score{font-weight:700;white-space:nowrap}.band{background:#eee;border-radius:12px;padding:2px 8px;font-size:12px;margin-left:6px}
table{border-collapse:collapse;width:100%;margin-top:10px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}.facts th{width:160px;color:#555;font-weight:600}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:16px 0 4px}.req thead th{color:#555;font-size:12px}
tr.ok td:nth-child(2){color:#1a7f4b;font-weight:600}tr.unc td:nth-child(2){color:#b7791f;font-weight:600}tr.no td:nth-child(2){color:#b42318;font-weight:600}
.unc-note{background:#fff7e6;border:1px solid #f5d9a6;padding:8px 10px;border-radius:6px}footer{color:#777;font-size:12px;margin-top:12px}
.print{position:fixed;top:12px;right:16px;padding:8px 14px;border-radius:20px;border:0;background:#111;color:#fff;cursor:pointer}@media print{.print{display:none}body{padding:0}}</style></head>
<body><button class="print" onclick="window.print()">Save as PDF / Print</button>
<div class="head"><h1>Candidate submission: ${esc(mandate.title)}</h1><div class="meta">For ${esc(mandate.client_name || "client")} · Ref ${esc(mandate.code)} · ${subs.length} candidate${subs.length === 1 ? "" : "s"} · Prepared by ${esc(recruiter)}</div>
<div class="meta">Information marked <b>Unclear</b> was not stated in the candidate's profile and is being verified.</div></div>${cards}</body></html>`;
}

// ------------------------------------------------------------------ candidate history (across mandates)
export async function candidateHistory(env, owner, candidateId) {
  const matches = await all(env.DB, "matches", `SELECT m.*, md.code, md.title AS mandate_title, md.client_name FROM matches m JOIN mandates md ON md.id = m.mandate_id WHERE m.candidate_id = ? AND md.owner = ? ORDER BY m.id DESC`, candidateId, owner);
  const ids = matches.map((m) => m.id);
  const events = ids.length ? await all(env.DB, "status_events", `SELECT * FROM status_events WHERE match_id IN (${ids.map(() => "?").join(",")}) ORDER BY id DESC`, ...ids) : [];
  const subs = await all(env.DB, "submissions", "SELECT id, mandate_id, match_id, client_name, version, submitted_by, created_at FROM submissions WHERE candidate_id = ? AND owner = ? ORDER BY id DESC", candidateId, owner);
  const timeline = [
    ...matches.map((m) => ({ at: m.created_at, kind: "sourced", text: `Added to ${m.code} ${m.mandate_title} (${m.client_name || "no client"}) via ${m.origin}, scored ${m.score}/10 ${m.band}`, mandate_id: m.mandate_id })),
    ...events.map((e) => { const m = matches.find((x) => x.id === e.match_id); return { at: e.created_at, kind: "status", text: `${m?.code || ""}: ${e.from_status} → ${e.to_status}${e.reason ? ` (${e.reason})` : ""}${e.note ? ` — ${e.note}` : ""}`, mandate_id: m?.mandate_id }; }),
    ...subs.map((s) => ({ at: s.created_at, kind: "submission", text: `Submitted to ${s.client_name} (v${s.version}) by ${s.submitted_by}`, mandate_id: s.mandate_id })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return { mandates: matches.map((m) => ({ mandate_id: m.mandate_id, code: m.code, title: m.mandate_title, client: m.client_name, status: m.status, score: m.score, band: m.band })), timeline, submissions: subs };
}

// ------------------------------------------------------------------ tracker export (manual §8)
export async function trackerRows(env, mandate, source = "all") {
  let rows = await all(env.DB, "matches", "SELECT * FROM matches WHERE mandate_id = ?", mandate.id);
  if (source !== "all") rows = rows.filter((m) => m.origin === source);
  const ids = rows.map((r) => r.candidate_id);
  const cands = ids.length ? await all(env.DB, "candidates", `SELECT * FROM candidates WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
  const byId = Object.fromEntries(cands.map((x) => [x.id, x]));
  const mids = rows.map((r) => r.id);
  const events = mids.length ? await all(env.DB, "status_events", `SELECT * FROM status_events WHERE match_id IN (${mids.map(() => "?").join(",")}) ORDER BY id`, ...mids) : [];
  const subs = await all(env.DB, "submissions", "SELECT match_id, MIN(created_at) AS at FROM submissions WHERE mandate_id = ? GROUP BY match_id", mandate.id);
  const subAt = Object.fromEntries(subs.map((s) => [s.match_id, s.at]));
  rows.sort(rankKey);
  const CLIENT_STATUS = { Submitted: "Pending", "Client Review": "Pending", "Interview Scheduled": "Interview", "Interview Completed": "Interview", "Further Round": "Interview", Selected: "Selected", Rejected: "Rejected", Hold: "Hold",
    "Offer Discussion": "Selected", "Offer Released": "Selected", "Offer Accepted": "Selected", "Joining Pending": "Selected", Joined: "Joined", "Offer Declined": "Declined", "Candidate Withdrew": "Withdrew", "No-show": "No-show" };
  const NEXT = { Sourced: "Review profile", "AI Analysed": "Review profile", "Recruiter Reviewed": "Decide shortlist", Shortlisted: "Contact candidate", Contacted: "Await response / follow up", Interested: "Qualify (CTC, notice, location)", Qualified: "Submit to client",
    Submitted: "Follow up with client", "Client Review": "Follow up with client", "Interview Scheduled": "Confirm attendance", "Interview Completed": "Collect feedback", "Further Round": "Schedule next round", Selected: "Offer discussion", "Offer Discussion": "Close offer terms",
    "Offer Released": "Get acceptance", "Offer Accepted": "Track joining", "Joining Pending": "Confirm joining date", Joined: "Close", Hold: "Check back with client", Rejected: "Inform candidate", "Not Interested": "Close or revisit later" };
  return rows.map((m, i) => {
    const c = byId[m.candidate_id] || {}, ev = events.filter((e) => e.match_id === m.id);
    const first = (st) => ev.find((e) => e.to_status === st)?.created_at || "";
    const last = (st) => [...ev].reverse().find((e) => e.to_status === st)?.created_at || "";
    const mand = (m.checklist || []).filter((x) => x.key === "skill" || ["experience", "location", "ctc", "notice"].includes(x.key));
    const verified = mand.filter((x) => x.status === "meets").length, unclear = mand.filter((x) => ["unknown", "unverified"].includes(x.status)).length;
    const lastReason = [...ev].reverse().find((e) => e.reason)?.reason || "";
    return {
      "Candidate ID": `C${String(c.id).padStart(5, "0")}`, "Candidate Name": c.name, Source: m.origin, "Job ID / Position": `${mandate.code} ${mandate.title}`, Client: mandate.client_name,
      Qualification: c.education || "", "Total Experience": c.total_exp_years ?? "", "Relevant Experience": (m.facts?.total_exp_years ?? "") === "" ? "" : m.facts?.total_exp_years,
      "Current Company": c.current_company || "", "Current Role": c.current_title || "", "Key Skills": (c.top_skills || []).join("; "),
      "Current CTC": c.ctc_current_lpa ?? "", "Expected CTC": c.ctc_expected_lpa ?? "", "Notice Period": c.notice_days ?? "", "Current Location": c.location || "",
      Relocation: m.facts?.relocation ? "Yes" : m.facts?.location && mandate.spec?.locations?.length && !mandate.spec.locations.map((l) => l.toLowerCase()).includes(String(m.facts.location).toLowerCase()) ? "Unclear" : "",
      "Match Score": m.score, Band: m.band, "Critical Requirements": `${verified}/${mand.length} verified${unclear ? `, ${unclear} unclear` : ""}`,
      "Match Summary": m.summary || (m.gaps || []).slice(0, 3).join("; "), "Recruiter Status": m.status, "Client Status": CLIENT_STATUS[m.status] || "",
      "Status Reason": lastReason, "Last Contacted": last("Contacted") || last("Interested") || "", "Next Action": NEXT[m.status] || "", "Source Date": m.created_at,
      "Submission Date": subAt[m.id] || first("Submitted") || "", "Interview Date": last("Interview Scheduled") || "", Outcome: ["Joined", "Rejected", "Offer Declined", "Candidate Withdrew", "No-show", "Closed", "Not Interested"].includes(m.status) ? m.status : "",
      "Last Status Change": ev.length ? ev[ev.length - 1].created_at : m.created_at, "Scoring Model": m.model || "",
    };
  });
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => { let t = v == null ? "" : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return "\ufeff" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export const reasonRequired = (status) => REASON_STATUSES.includes(status);
export { REASON_CODES, STATUSES };
