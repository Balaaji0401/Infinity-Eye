import { useEffect, useRef, useState } from "react";
import { ArrowUp, MessageSquare, Sparkles } from "lucide-react";
import { api } from "../api.js";

/** Chat thread + composer. Works with no mandate (setting context / asking across mandates) or grounded in one mandate. */
export default function Chat({ mandateId = null, conversationId, onConversation, onActions, compact = false, placeholder }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (conversationId) { const c = await api.get(`/conversations/${conversationId}`); if (alive) setMsgs(c.messages || []); }
        else if (mandateId) { const list = await api.get(`/conversations?mandate_id=${mandateId}`); if (alive && list[0]) { setMsgs(list[0].messages || []); onConversation?.(list[0].id); } }
      } catch { /* start empty */ }
    })();
    return () => { alive = false; };
  }, [conversationId, mandateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setText(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: message }]);
    try {
      const r = await api.post("/chat", { conversation_id: conversationId, mandate_id: mandateId, message });
      if (!conversationId) onConversation?.(r.conversation_id);
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, actions: r.actions }]);
      if (r.actions?.length) onActions?.(r.actions);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: `Something went wrong: ${e.message}`, error: true }]); }
    finally { setBusy(false); }
  };

  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div className="chat-thread" ref={threadRef}>
        {msgs.length === 0 && !busy && (
          <div className="chat-empty">
            <MessageSquare size={18} />
            <div>{mandateId ? "Ask about these profiles: “who has the shortest notice?”, “compare the top two on GST”, “why isn’t Divya a fit?”, or give instructions: “shortlist Karthik”, “show 10 profiles”."
              : "Set the scene before pasting a JD (“this is for HellermannTyton, plant in Oragadam, budget 8 LPA, they want auto-components people”), or ask about past mandates and the talent pool."}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" && <Sparkles size={14} className="bubble-icon" />}
            <div>
              <div className={`bubble-text ${m.error ? "error" : ""}`}>{m.content}</div>
              {m.actions?.length > 0 && <div className="bubble-actions">Applied: {m.actions.join(" · ")}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="bubble assistant"><Sparkles size={14} className="bubble-icon" /><div className="bubble-text muted">Thinking…</div></div>}
      </div>
      <div className="chat-input">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={busy}
          placeholder={placeholder || (mandateId ? "Ask about these profiles or tell ∞ Eye what to change…" : "Set context or ask a question…")} aria-label="Chat message" />
        <button className="btn primary small" onClick={send} disabled={busy || !text.trim()} aria-label="Send"><ArrowUp size={16} /></button>
      </div>
    </div>
  );
}
