const TOKEN_KEY = "nr_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(method, path, body, isForm = false) {
  const headers = { Authorization: `Bearer ${getToken() || ""}` };
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== "/login") {
    setToken(null);
    window.location.reload();
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`, data = null;
    try { data = await res.json(); msg = data.detail || msg; } catch { /* ignore */ }
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status; err.data = data;
    throw err;
  }
  return res.json();
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),
  form: (p, fd) => request("POST", p, fd, true),
  download(candidateId, fallbackName) { return this.downloadPath(`/candidates/${candidateId}/resume`, fallbackName); },
  async downloadPath(path, fallbackName) {
    const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error((await res.json()).detail || "Download failed");
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? decodeURIComponent(m[1]) : fallbackName || "resume";
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

// deterministic colour per mandate (album-art feel)
const HUES = [38, 152, 205, 262, 330, 18, 180, 95];
export const mandateColor = (id, l = 62) => `hsl(${HUES[(id || 0) % HUES.length]} 62% ${l}%)`;
export const inr = (v) => (v == null ? "—" : "₹" + Math.round(v).toLocaleString("en-IN"));
export const bandClass = (b) => (b === "Do not advance" ? "DNA" : b);
