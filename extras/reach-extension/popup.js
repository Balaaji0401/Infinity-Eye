const $ = (id) => document.getElementById(id);
const msg = (t, err) => { $("msg").textContent = t; $("msg").className = "msg" + (err ? " err" : ""); };

async function settings() { return chrome.storage.local.get(["url", "token", "mandate"]); }
async function api(path, opts = {}) {
  const s = await settings();
  if (!s.url || !s.token) throw new Error("Open Settings and enter the ∞ Eye URL and token.");
  const r = await fetch(s.url.replace(/\/$/, "") + "/api" + path, { ...opts, headers: { Authorization: "Bearer " + s.token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) { let d = ""; try { d = (await r.json()).detail; } catch {} throw new Error(d || "Request failed " + r.status); }
  return r.json();
}
async function loadMandates() {
  try {
    const list = await api("/mandates");
    const s = await settings();
    $("mandate").innerHTML = list.filter((m) => m.status === "open").map((m) => `<option value="${m.id}" ${String(m.id) === String(s.mandate) ? "selected" : ""}>${m.code} · ${m.title}</option>`).join("") || "<option value=''>No open mandates</option>";
  } catch (e) { $("mandate").innerHTML = "<option value=''>—</option>"; msg(e.message, true); }
}
async function capture(selectionOnly) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (selOnly) => {
    const sel = window.getSelection()?.toString() || "";
    if (selOnly && sel.trim().length > 20) return { text: sel, url: location.href, mode: "selection" };
    return { text: document.body.innerText.slice(0, 80000), url: location.href, mode: "page" };
  }, args: [selectionOnly] });
  return result;
}
async function send(selectionOnly) {
  const mandate = $("mandate").value;
  if (!mandate) return msg("Pick a mandate first.", true);
  await chrome.storage.local.set({ mandate });
  msg("Reading page…");
  try {
    const cap = await capture(selectionOnly);
    msg(`Sending ${cap.mode === "selection" ? "selected text" : "page"} (${Math.round(cap.text.length / 1000)}k chars) — AI is extracting profiles…`);
    const r = await api(`/mandates/${mandate}/reach-import`, { method: "POST", body: JSON.stringify({ text: cap.text, url: cap.url }) });
    msg(r.error ? r.error : `Done: ${r.extracted} profiles found, ${r.imported} imported and scored.`, !!r.error);
  } catch (e) { msg(e.message, true); }
}
$("sendSel").onclick = () => send(true);
$("sendPage").onclick = () => send(false);
$("save").onclick = async () => { await chrome.storage.local.set({ url: $("url").value.trim(), token: $("token").value.trim() }); msg("Saved."); loadMandates(); };
(async () => { const s = await settings(); $("url").value = s.url || ""; $("token").value = s.token || ""; loadMandates(); })();
