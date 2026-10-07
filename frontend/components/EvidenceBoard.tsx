"use client";
import { useMemo, useState } from "react";
import { ClaimResult, Evidence } from "@/lib/api";

const W = 760, H = 520, CX = W / 2, CY = H / 2;
const COLOR = { supports: "rgb(var(--sup))", refutes: "rgb(var(--ref))", neutral: "rgb(var(--dim))" };

// stance is encoded by shape + glyph as well as colour
function Mark({ stance, r }: { stance: Evidence["stance"]; r: number }) {
  const c = COLOR[stance];
  if (stance === "refutes") return <g><rect x={-r} y={-r} width={2 * r} height={2 * r} transform="rotate(45)" fill={c} fillOpacity=".25" stroke={c} strokeWidth="2" /><text textAnchor="middle" dy=".35em" fill={c} fontFamily="monospace" fontSize={r}>−</text></g>;
  if (stance === "supports") return <g><circle r={r} fill={c} fillOpacity=".25" stroke={c} strokeWidth="2" /><text textAnchor="middle" dy=".35em" fill={c} fontFamily="monospace" fontSize={r}>+</text></g>;
  return <circle r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 3" />;
}

export function EvidenceBoard({ claim }: { claim: ClaimResult }) {
  const [hover, setHover] = useState<Evidence | null>(null);
  const items = useMemo(() => claim.evidence.slice(0, 18), [claim]);
  const nodes = items.map((e, i) => {
    const ring = e.counted ? (e.stance === "neutral" ? 215 : 150 + (1 - e.rerank_score) * 40) : 235;
    const a = (i / Math.max(items.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { e, x: CX + Math.cos(a) * ring * 1.35, y: CY + Math.sin(a) * ring * 0.95, r: 9 + e.credibility.score * 14 };
  });
  return (
    <div className="glass relative rounded-2xl p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Evidence board: ${items.length} sources around the claim`}>
        {[110, 170, 230].map((r) => <ellipse key={r} cx={CX} cy={CY} rx={r * 1.35} ry={r * 0.95} fill="none" stroke="rgb(var(--line))" strokeDasharray="2 6" />)}
        {nodes.map(({ e, x, y }) => <line key={`l${e.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke={COLOR[e.stance]} strokeOpacity={e.counted ? 0.5 : 0.15} />)}
        <g transform={`translate(${CX} ${CY})`}>
          <circle r="46" fill="rgb(var(--panel))" stroke="rgb(var(--signal))" strokeWidth="2" />
          <text textAnchor="middle" dy=".35em" fill="rgb(var(--signal))" fontFamily="monospace" fontSize="11" letterSpacing="2">CLAIM</text>
        </g>
        {nodes.map(({ e, x, y, r }) => (
          <g key={e.id} transform={`translate(${x} ${y})`} opacity={e.counted ? 1 : 0.45} tabIndex={0} role="link"
            aria-label={`${e.domain}, ${e.stance}, credibility ${Math.round(e.credibility.score * 100)} percent`}
            onMouseEnter={() => setHover(e)} onFocus={() => setHover(e)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
            onClick={() => window.open(e.url, "_blank", "noopener,noreferrer")}
            onKeyDown={(ev) => { if (ev.key === "Enter") window.open(e.url, "_blank", "noopener,noreferrer"); }} style={{ cursor: "pointer" }}>
            <Mark stance={e.stance} r={r} />
            <text y={r + 13} textAnchor="middle" fontSize="10" fill="rgb(var(--dim))" fontFamily="monospace">{e.domain.slice(0, 22)}</text>
          </g>
        ))}
      </svg>
      <div className="min-h-[7.5rem] border-t border-line p-4 text-sm" aria-live="polite">
        {hover ? (
          <>
            <p className="font-mono text-xs text-dim">{hover.domain} · {hover.credibility.domain_class} · cred {Math.round(hover.credibility.score * 100)} · {hover.published_at ?? "date unknown"} · retrieved {new Date(hover.retrieved_at).toLocaleString()}</p>
            <p className="mt-1 font-medium" style={{ color: COLOR[hover.stance] }}>{hover.stance.toUpperCase()}{!hover.counted && " (not counted)"}</p>
            <blockquote className="mt-1 border-l-2 border-line pl-3 italic">{hover.quote || hover.excerpt.slice(0, 280)}</blockquote>
            {hover.discard_reason && <p className="mt-1 text-xs text-amber">{hover.discard_reason}</p>}
          </>
        ) : <p className="text-dim">Hover or focus a source to see the exact excerpt. Size = credibility prior. <span className="font-mono">+</span> supports, <span className="font-mono">−</span> refutes, dashed = neutral. Click to open the source.</p>}
      </div>
    </div>
  );
}
