import { useState } from "react";
import { X } from "lucide-react";

export default function ChipInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = (raw) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    parts.forEach((p) => { if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p); });
    onChange(next);
    setDraft("");
  };
  return (
    <div className="chip-input">
      {values.map((v) => (
        <span className="chip" key={v}>{v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><X size={13} /></button>
        </span>
      ))}
      <input value={draft} placeholder={values.length ? "" : placeholder} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
          if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => add(draft)} />
    </div>
  );
}
