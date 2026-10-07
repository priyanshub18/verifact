"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Capability, Provider, createCheck, getCapabilities, getProviders } from "@/lib/api";

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export function Hero() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [priv, setPriv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [capsErr, setCapsErr] = useState(false);
  const [provs, setProvs] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    getCapabilities().then(setCaps).catch(() => setCapsErr(true));
    getProviders().then((r) => {
      setProvs(r.providers);
      let saved: string | null = null;
      try { saved = localStorage.getItem("vf-provider"); } catch {}
      const ok = (id: string | null) => r.providers.find((p) => p.id === id && p.configured)?.id ?? null;
      setProvider(ok(saved) ?? ok(r.default));
    }).catch(() => setCapsErr(true));
  }, []);
  function pick(id: string) { setProvider(id); try { localStorage.setItem("vf-provider", id); } catch {} }

  async function submit() {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true); setError(null);
    try {
      const { id } = await createCheck({ ...(isUrl(v) ? { url: v } : { text: v }), private: priv, provider: provider ?? undefined });
      router.push(`/check/${id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <section className="pt-10 sm:pt-20">
      <p className="label mb-4">Investigative verification lab</p>
      <h1 className="max-w-4xl font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl">
        Don’t trust it. <em className="text-signal not-italic">Trace it.</em>
      </h1>
      <p className="mt-6 max-w-xl text-lg text-dim">
        Paste a claim, a post or a link. VeriFact extracts the checkable claims, hunts for evidence on both sides, and
        shows every source it read and how much weight it carried. If the evidence isn’t there, it says so.
      </p>

      <div className="glass relative mt-10 overflow-hidden rounded-2xl p-3">
        {busy && !error && <div aria-hidden className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-signal/25 to-transparent" style={{ animation: "scan 1.2s linear infinite" }} />}
        <label htmlFor="claim" className="sr-only">Claim, article text or link</label>
        <textarea id="claim" value={value} onChange={(e) => setValue(e.target.value)} rows={5} maxLength={20000}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          placeholder="Paste a claim, social post, article, or a link to one…"
          className="w-full resize-none rounded-xl bg-transparent p-4 text-lg outline-none placeholder:text-dim/70" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-3">
          <div className="flex items-center gap-4 text-sm text-dim">
            <span className="font-mono text-xs">{isUrl(value) ? "URL detected" : "Text"}</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />Keep private</label>
            <span title="Image, video and audio checks arrive in later milestones" className="font-mono text-xs opacity-60">Media: not yet implemented</span>
          </div>
          <motion.button whileTap={{ scale: 0.97 }} onClick={submit} disabled={!value.trim() || busy || !provider}
            className="rounded-lg bg-signal px-5 py-2.5 font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Starting…" : "Investigate  ⌘↵"}
          </motion.button>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="label mb-2">Reasoning model</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {provs.map((p) => (
            <label key={p.id} className={`glass cursor-pointer rounded-lg px-4 py-2 text-sm has-[:checked]:border-signal has-[:checked]:text-signal ${!p.configured ? "cursor-not-allowed opacity-50" : ""}`}
              title={p.configured ? p.model : `Not configured. ${p.how_to_enable}`}>
              <input type="radio" name="provider" className="sr-only" disabled={!p.configured} checked={provider === p.id} onChange={() => pick(p.id)} />
              <span className="font-medium">{p.label}</span>
              <span className="ml-2 font-mono text-xs text-dim">{p.configured ? p.model : "not configured"}</span>
            </label>
          ))}
        </div>
        {provs.length > 0 && !provider && <p role="alert" className="mt-2 text-sm text-amber">◌ No LLM provider configured. Add GROQ_API_KEY (free) to .env and restart the backend.</p>}
      </fieldset>

      {error && <p role="alert" className="mt-4 text-ref">⚠ {error}</p>}
      {capsErr && <p role="status" className="mt-4 text-amber">◌ Can’t reach the VeriFact API. Is the backend running?</p>}
      {caps && <Availability caps={caps} />}
    </section>
  );
}

function Availability({ caps }: { caps: Capability[] }) {
  const missing = caps.filter((c) => !c.configured);
  return (
    <div className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Feature availability">
      {caps.map((c) => (
        <div key={c.id} className="glass rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>{c.label}</span>
            <span className={`font-mono text-xs ${c.configured ? "text-sup" : "text-amber"}`}>{c.configured ? "● Ready" : "○ Not configured"}</span>
          </div>
          {!c.configured && <p className="mt-1 text-xs text-dim">Needs <code className="font-mono">{c.needs.join(", ")}</code>. {c.how_to_enable}</p>}
        </div>
      ))}
      {missing.length === 0 && null}
    </div>
  );
}
