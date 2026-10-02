// AI layer with two providers:
//   codecraft  — OpenAI-compatible gateway (https://codecraftapi.com/v1), 1M free tokens/month. Default for chat.
//   workers-ai — Cloudflare Workers AI binding. Default for embeddings (cheap, no extra account), fallback for chat.
// Callers must handle errors: the app keeps working with deterministic parsing when AI is unavailable.
import { logEvent } from "./db.js";
export class AIError extends Error {}

export const NEURON_RATES = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [27, 204], "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4.1, 35],
  "@cf/meta/llama-3.1-8b-instruct-fast": [4.1, 35], "@cf/baai/bge-base-en-v1.5": [1.8, 0],
};
export const estimateNeurons = (model, tin, tout) => { const [ri, ro] = NEURON_RATES[model] || [10, 60]; return Math.round(((tin || 0) / 1000) * ri + ((tout || 0) / 1000) * ro); };
const tok = (s) => Math.ceil((s || "").length / 4);
/** Model output can be a string, an array of content parts, or an object; always return a string. */
export function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((p) => (typeof p === "string" ? p : p?.text || p?.content || "")).join("");
  if (typeof v === "object") return asText(v.response ?? v.result?.response ?? v.content ?? v.text ?? JSON.stringify(v));
  return String(v);
}

export const chatProvider = (env) => {
  const p = (env.LLM_PROVIDER || (env.CODECRAFT_API_KEY ? "codecraft" : "workers-ai")).toLowerCase();
  return p === "codecraft" && !env.CODECRAFT_API_KEY ? "workers-ai" : p;   // no key -> fall back to Cloudflare
};
export const embedProvider = (env) => (env.EMBED_PROVIDER || "workers-ai").toLowerCase();
const baseUrl = (env) => (env.LLM_BASE_URL || "https://codecraftapi.com/v1").replace(/\/$/, "");
const chatModel = (env) => (chatProvider(env) === "codecraft" ? env.LLM_MODEL || "deepseek-v4-flash-0731" : env.WORKERS_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8-fast");

function extractJson(text) {
  text = (text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e <= s) throw new AIError("No JSON object in model output");
  return JSON.parse(text.slice(s, e + 1));
}

async function openaiChat(env, messages, maxTokens, json) {
  const body = { model: chatModel(env), messages, max_tokens: maxTokens, temperature: 0.1 };
  if (json) body.response_format = { type: "json_object" };
  let r = await fetch(`${baseUrl(env)}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${env.CODECRAFT_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 400 && json) { delete body.response_format; r = await fetch(`${baseUrl(env)}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${env.CODECRAFT_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { text: asText(d.choices?.[0]?.message?.content), usage: d.usage || null };
}

export async function chatJson(env, system, user, maxTokens = 1200) {
  const provider = chatProvider(env), model = chatModel(env);
  if (provider === "codecraft" && !env.CODECRAFT_API_KEY) throw new AIError("CODECRAFT_API_KEY secret is not set");
  if (provider === "workers-ai" && !env.AI) throw new AIError("Workers AI binding missing");
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now(), tin = messages.reduce((a, m) => a + tok(m.content), 0);
    let text, usage = null;
    try {
      if (provider === "codecraft") ({ text, usage } = await openaiChat(env, messages, maxTokens, true));
      else { const out = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.1 }); text = asText(out); }
    } catch (e) {
      if (env.DB) await logEvent(env.DB, "ai", model, "error", Date.now() - t0, { provider, error: String(e.message || e).slice(0, 200), tokens_in: tin });
      throw new AIError(`AI call failed (${provider}): ${e.message || e}`);
    }
    const tokensIn = usage?.prompt_tokens ?? tin, tokensOut = usage?.completion_tokens ?? tok(text);
    if (env.DB) await logEvent(env.DB, "ai", model, "ok", Date.now() - t0, { provider, tokens_in: tokensIn, tokens_out: tokensOut, tokens: tokensIn + tokensOut,
      neurons: provider === "workers-ai" ? estimateNeurons(model, tokensIn, tokensOut) : 0 });
    text = asText(text);
    try { return extractJson(text); } catch (e) {
      lastErr = e;
      messages.push({ role: "assistant", content: text.slice(0, 2000) }, { role: "user", content: "That was not valid JSON. Return ONLY the JSON object." });
    }
  }
  throw new AIError(`Invalid JSON after retry: ${lastErr?.message}`);
}

/** Embeddings: returns array of vectors or null. Default provider is Workers AI (bge-base, 768 dims). */
export async function embed(env, texts) {
  texts = (texts || []).filter((t) => typeof t === "string" && t.trim());
  if (!texts.length) return null;
  const provider = embedProvider(env), t0 = Date.now();
  const inputs = texts.map((t) => t.slice(0, 2000)), tin = inputs.reduce((a, t) => a + tok(t), 0);
  try {
    if (provider === "codecraft") {
      const r = await fetch(`${baseUrl(env)}/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${env.CODECRAFT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.EMBED_MODEL || "text-embedding-3-small", input: inputs }) });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
      const d = await r.json();
      if (env.DB) await logEvent(env.DB, "ai", env.EMBED_MODEL || "text-embedding-3-small", "ok", Date.now() - t0, { provider, tokens_in: d.usage?.prompt_tokens ?? tin, tokens: d.usage?.total_tokens ?? tin });
      return d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
    }
    if (!env.AI) return null;
    const model = env.WORKERS_EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
    const out = await env.AI.run(model, { text: inputs });
    if (env.DB) await logEvent(env.DB, "ai", model, "ok", Date.now() - t0, { provider: "workers-ai", tokens_in: tin, neurons: estimateNeurons(model, tin, 0) });
    return out?.data || null;
  } catch (e) {
    if (env.DB) await logEvent(env.DB, "ai", "embeddings", "error", Date.now() - t0, { provider, error: String(e.message || e).slice(0, 200) });
    return null;
  }
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
/** Map a raw cosine (bge-style, ~0.5–0.95 for related text) onto 0–1 for scoring. */
export const simToScore = (c) => Math.max(0, Math.min(1, (c - 0.55) / 0.35));
