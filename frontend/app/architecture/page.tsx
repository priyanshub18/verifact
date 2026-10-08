import { DATA_MODEL, MODULES, PIPELINE, SECURITY, STACK, STATUS_LABEL, Status, TRUST_RULES } from "@/lib/architecture";

export const metadata = { title: "Architecture · VeriFact" };

function Badge({ s }: { s: Status }) {
  const b = STATUS_LABEL[s];
  return <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] ${b.cls}`}><span aria-hidden>{b.glyph}</span>{b.text}</span>;
}

function Box({ x, y, w, h, title, sub, accent }: { x: number; y: number; w: number; h: number; title: string; sub: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="rgb(var(--panel))" stroke={accent ? "rgb(var(--signal))" : "rgb(var(--line))"} strokeWidth={accent ? 2 : 1.2} />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fill="rgb(var(--fg))" fontSize="13" fontFamily="var(--font-sans)" fontWeight="600">{title}</text>
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fill="rgb(var(--dim))" fontSize="10" fontFamily="var(--font-mono)">{sub}</text>
    </g>
  );
}
function Arrow({ d, label, lx, ly, dashed }: { d: string; label?: string; lx?: number; ly?: number; dashed?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" stroke="rgb(var(--signal))" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray={dashed ? "4 4" : undefined} markerEnd="url(#ah)" />
      {label && <text x={lx} y={ly} fill="rgb(var(--dim))" fontSize="9.5" fontFamily="var(--font-mono)" textAnchor="middle">{label}</text>}
    </g>
  );
}

function SystemDiagram() {
  return (
    <svg viewBox="0 0 980 470" className="w-full" role="img"
      aria-label="System diagram: browser calls the API, which enqueues jobs for a worker; the worker uses LLM providers, evidence sources and the ML service, and stores results in PostgreSQL.">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="rgb(var(--signal))" /></marker></defs>
      <text x="20" y="22" className="label" fill="rgb(var(--dim))" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="2">CLIENT</text>
      <text x="260" y="22" fill="rgb(var(--dim))" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="2">YOUR INFRASTRUCTURE</text>
      <text x="720" y="22" fill="rgb(var(--dim))" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="2">EXTERNAL / OPTIONAL</text>
      <rect x="250" y="32" width="440" height="420" rx="12" fill="none" stroke="rgb(var(--line))" strokeDasharray="3 6" />

      <Box x={20} y={50} w={190} h={60} title="Next.js UI" sub="hero · live view · board" accent />
      <Box x={290} y={50} w={170} h={60} title="FastAPI" sub="REST + SSE" accent />
      <Box x={290} y={160} w={170} h={60} title="Redis" sub="Arq job queue" />
      <Box x={290} y={270} w={170} h={64} title="Worker" sub="pipeline orchestrator" accent />
      <Box x={480} y={50} w={190} h={60} title="PostgreSQL" sub="checks · events · results" />
      <Box x={480} y={380} w={190} h={60} title="ML service" sub="rerank · NLI · ELA (CPU)" />
      <Box x={290} y={380} w={170} h={60} title="MinIO (planned)" sub="uploaded media" />

      <Box x={730} y={50} w={220} h={60} title="LLM providers" sub="Groq · Anthropic · OpenAI" />
      <Box x={730} y={150} w={220} h={60} title="Web & news search" sub="DDG/Bing · GDELT · Tavily*" />
      <Box x={730} y={250} w={220} h={60} title="Reference & science" sub="Wikipedia · PubMed · Crossref" />
      <Box x={730} y={350} w={220} h={60} title="Publisher pages" sub="SSRF-safe fetch" />

      <Arrow d="M210 68 L290 68" label="POST /checks" lx={250} ly={62} />
      <Arrow d="M290 94 L210 94" dashed label="SSE" lx={250} ly={108} />
      <Arrow d="M375 110 L375 160" label="enqueue" lx={400} ly={140} />
      <Arrow d="M375 220 L375 270" label="run_check" lx={405} ly={250} />
      <Arrow d="M460 285 C540 285 575 220 575 112" label="events + result" lx={566} ly={140} />
      <Arrow d="M460 80 L480 80" label="" lx={470} ly={42} />
      <Arrow d="M460 300 L730 80" />
      <Arrow d="M460 305 L730 180" />
      <Arrow d="M460 310 L730 280" />
      <Arrow d="M460 318 L730 375" />
      <Arrow d="M410 334 C420 360 560 370 575 380" label="rerank" lx={500} ly={352} dashed />
      <text x="20" y="455" fill="rgb(var(--dim))" fontSize="10" fontFamily="var(--font-mono)">* keyed sources are optional; dashed = optional or return path</text>
    </svg>
  );
}

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="mt-20 scroll-mt-8"><p className="label">{label}</p><h2 className="mt-1 font-display text-3xl sm:text-4xl">{title}</h2><div className="mt-6">{children}</div></section>;
}

export default function Page() {
  const counts = MODULES.reduce((a, m) => ({ ...a, [m.status]: (a[m.status] ?? 0) + 1 }), {} as Record<string, number>);
  const areas = [...new Set(MODULES.map((m) => m.area))];
  return (
    <article className="pt-12">
      <p className="label">System design</p>
      <h1 className="max-w-3xl font-display text-5xl leading-tight sm:text-6xl">Architecture</h1>
      <p className="mt-4 max-w-2xl text-lg text-dim">
        VeriFact is a retrieval-first verification system. Models read evidence we fetched; deterministic rules decide what that evidence adds up to.
        This page shows what is built, what is partial and what is only planned, with no pretending.
      </p>
      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-sm">
        {[["system", "System"], ["pipeline", "Pipeline"], ["trust", "Trust rules"], ["security", "Security"], ["data", "Data"], ["stack", "Stack"], ["status", "Status board"]].map(([id, t]) => (
          <a key={id} href={`#${id}`} className="glass rounded-md px-3 py-1.5 hover:text-signal">{t}</a>
        ))}
      </nav>

      <Section id="system" label="01 · Topology" title="How the pieces connect">
        <div className="glass overflow-x-auto rounded-2xl p-3"><div className="min-w-[640px]"><SystemDiagram /></div></div>
        <ol className="mt-6 grid gap-3 text-sm text-dim sm:grid-cols-2">
          <li><span className="font-mono text-signal">1.</span> The UI posts text or a URL plus the chosen model provider; the API validates, stores a row and enqueues a job.</li>
          <li><span className="font-mono text-signal">2.</span> A worker runs the pipeline and writes each progress event to the database as it happens.</li>
          <li><span className="font-mono text-signal">3.</span> The UI subscribes over SSE; the stream replays the persisted event log, so a refresh or a worker restart loses nothing.</li>
          <li><span className="font-mono text-signal">4.</span> The finished result (claims, evidence, credibility, queries, discarded sources) is one JSON document behind a permalink.</li>
        </ol>
      </Section>

      <Section id="pipeline" label="02 · Text & URL pipeline" title="From input to verdict">
        <ol className="space-y-3">
          {PIPELINE.map((p) => (
            <li key={p.n} className="glass rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl"><span className="mr-3 font-mono text-sm text-signal">{p.n}</span>{p.title}</h3>
                <Badge s={p.status} />
              </div>
              <p className="mt-2 text-dim">{p.does}</p>
              {p.note && <p className="mt-2 text-sm text-amber">◌ {p.note}</p>}
              <p className="mt-2 font-mono text-xs text-dim">{p.where}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="trust" label="03 · Guarantees" title="Trust rules the code enforces">
        <ul className="grid gap-3 sm:grid-cols-2">{TRUST_RULES.map(([t, d]) => (
          <li key={t} className="glass rounded-xl p-4"><h3 className="font-medium text-signal">{t}</h3><p className="mt-1 text-sm text-dim">{d}</p></li>))}</ul>
      </Section>

      <Section id="security" label="04 · Hardening" title="Security & privacy">
        <dl className="grid gap-3 sm:grid-cols-2">{SECURITY.map(([t, d]) => (
          <div key={t} className="glass rounded-xl p-4"><dt className="font-mono text-xs uppercase tracking-widest text-dim">{t}</dt><dd className="mt-1 text-sm">{d}</dd></div>))}</dl>
      </Section>

      <Section id="data" label="05 · Persistence" title="Data model">
        {DATA_MODEL.map((t) => (
          <div key={t.table} className="glass max-w-xl rounded-xl p-4"><p className="font-mono text-signal">{t.table}</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-dim">{t.cols.map((c) => <li key={c}>· {c}</li>)}</ul></div>))}
        <p className="mt-4 max-w-2xl text-sm text-dim">Evidence rows live inside the result JSON together with retrieval timestamp, excerpt, verbatim quote, rerank score and method, and the full credibility breakdown, so a permalink is a self-contained audit trail. Dedicated evidence/embedding tables with pgvector arrive with media and history comparison.</p>
      </Section>

      <Section id="stack" label="06 · Choices" title="Stack and why">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
          <thead className="label"><tr><th className="py-2 pr-4">Layer</th><th className="pr-4">Technology</th><th>Rationale</th></tr></thead>
          <tbody>{STACK.map(([a, b, c]) => <tr key={a} className="border-t border-line align-top"><td className="py-3 pr-4 font-medium">{a}</td><td className="pr-4 text-dim">{b}</td><td className="text-dim">{c}</td></tr>)}</tbody></table></div>
      </Section>

      <Section id="status" label="07 · Honest status" title="What exists today">
        <p className="mb-4 font-mono text-sm text-dim">{counts.built ?? 0} built · {counts.partial ?? 0} partial · {counts.planned ?? 0} planned</p>
        {areas.map((a) => (
          <div key={a} className="mb-6"><h3 className="label mb-2">{a}</h3>
            <ul className="divide-y divide-line border-y border-line">{MODULES.filter((m) => m.area === a).map((m) => (
              <li key={m.item} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div><p className="font-medium">{m.item}</p>{m.detail && <p className="text-sm text-dim">{m.detail}</p>}</div><Badge s={m.status} />
              </li>))}</ul></div>))}
      </Section>
    </article>
  );
}
