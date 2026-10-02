const COLORS = { A: "var(--band-a)", B: "var(--band-b)", Review: "var(--band-review)", "Do not advance": "var(--band-dna)", Lead: "var(--text)" };
export default function ScoreRing({ score, band, size = 70 }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(10, score || 0)) / 10;
  const v = score ?? 0;
  const label = v >= 10 ? "10" : v.toFixed(1);          // "10" not "10.0" so it always fits
  const font = Math.round(size * (label.length > 2 ? 0.3 : 0.36));
  const showDenom = size >= 60;
  return (
    <div className="score" style={{ width: size, height: size }} aria-label={`Score ${score} out of 10`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS[band] || "var(--text)"} strokeWidth="5"
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <div className="num" style={{ fontSize: font }}>{label}{showDenom && <small>/10</small>}</div>
    </div>
  );
}
