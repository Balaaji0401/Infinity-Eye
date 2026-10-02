import { useState } from "react";
import { Star, X } from "lucide-react";
import ChipInput from "./ChipInput.jsx";

const num = (v) => (v === "" || v == null ? null : Number(v));

function SkillBox({ spec, set }) {
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("skill");
  const add = () => {
    const names = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const skills = [...spec.skills];
    names.forEach((n) => { if (!skills.some((s) => s.name.toLowerCase() === n.toLowerCase())) skills.push({ name: n, type, mandatory: true, aliases: [] }); });
    set({ ...spec, skills });
    setDraft("");
  };
  const toggle = (i) => set({ ...spec, skills: spec.skills.map((s, j) => (j === i ? { ...s, mandatory: !s.mandatory } : s)) });
  const remove = (i) => set({ ...spec, skills: spec.skills.filter((_, j) => j !== i) });
  const group = (t) => spec.skills.map((s, i) => [s, i]).filter(([s]) => s.type === t);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {["skill", "tool"].map((t) => (
        <div key={t}>
          <div className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t === "skill" ? "Skills" : "Tools & software"}</div>
          <div className="row" style={{ gap: 6 }}>
            {group(t).length === 0 && <span className="faint" style={{ fontSize: 13 }}>None yet</span>}
            {group(t).map(([s, i]) => (
              <span key={s.name} className={`chip skill-chip ${s.mandatory ? "mand" : ""}`} onClick={() => toggle(i)}
                title={s.mandatory ? "Mandatory — click to make preferred" : "Preferred — click to make mandatory"}>
                {s.mandatory && <Star size={12} fill="currentColor" />}{s.name}
                <button type="button" aria-label={`Remove ${s.name}`} onClick={(e) => { e.stopPropagation(); remove(i); }}><X size={13} /></button>
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <input className="input" style={{ flex: 1 }} placeholder="Add skills or tools, comma separated" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <select className="select" style={{ width: 120 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="skill">Skill</option><option value="tool">Tool</option>
        </select>
        <button type="button" className="btn small" onClick={add}>Add</button>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>★ Mandatory items are hard requirements. Click a chip to switch between mandatory and preferred.</div>
    </div>
  );
}

export default function SpecEditor({ spec, onChange }) {
  const set = (patch) => onChange({ ...spec, ...patch });
  return (
    <div className="spec-grid">
      <label className="field wide">Job title<input className="input" value={spec.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="field wide">Other titles to search<ChipInput values={spec.alt_titles} onChange={(v) => set({ alt_titles: v })} placeholder="e.g. Accounts Executive" /></label>
      <div className="full card" style={{ background: "var(--base)" }}><SkillBox spec={spec} set={onChange} /></div>
      <label className="field">Min experience (yrs)<input className="input" type="number" min="0" step="0.5" value={spec.min_exp ?? ""} onChange={(e) => set({ min_exp: num(e.target.value) })} /></label>
      <label className="field">Max experience (yrs)<input className="input" type="number" min="0" step="0.5" value={spec.max_exp ?? ""} onChange={(e) => set({ max_exp: num(e.target.value) })} /></label>
      <label className="field">CTC budget min (LPA)<input className="input" type="number" min="0" step="0.5" value={spec.ctc_min_lpa ?? ""} onChange={(e) => set({ ctc_min_lpa: num(e.target.value) })} /></label>
      <label className="field">CTC budget max (LPA)<input className="input" type="number" min="0" step="0.5" value={spec.ctc_max_lpa ?? ""} onChange={(e) => set({ ctc_max_lpa: num(e.target.value) })} /></label>
      <label className="field wide">Locations<ChipInput values={spec.locations} onChange={(v) => set({ locations: v })} placeholder="e.g. Chennai" /></label>
      <label className="field">Max notice (days)<input className="input" type="number" min="0" value={spec.notice_max_days ?? ""} onChange={(e) => set({ notice_max_days: num(e.target.value) })} /></label>
      <label className="field">Relocation<select className="select" value={spec.relocation_ok ? "yes" : "no"} onChange={(e) => set({ relocation_ok: e.target.value === "yes" })}>
        <option value="no">Local candidates only</option><option value="yes">Open to relocation</option></select></label>
      <label className="field wide">Preferred industries<ChipInput values={spec.industries} onChange={(v) => set({ industries: v })} placeholder="e.g. Manufacturing" /></label>
      <label className="field wide">Education<ChipInput values={spec.education} onChange={(v) => set({ education: v })} placeholder="e.g. B.Com" /></label>
    </div>
  );
}

export const EMPTY_SPEC = { title: "", alt_titles: [], min_exp: null, max_exp: null, locations: [], relocation_ok: false,
  skills: [], industries: [], education: [], ctc_min_lpa: null, ctc_max_lpa: null, notice_max_days: null, summary: "" };
