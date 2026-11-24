"use client";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Capability,
  CheckSummary,
  Provider,
  VERDICT_STYLE,
  createCheck,
  createMultimodalCheck,
  getCapabilities,
  getProviders,
  listChecks,
} from "@/lib/api";

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// `demo` lets /demo drive this exact screen on autopilot without creating a real check.
export function Hero({
  demo,
}: {
  demo?: { value: string; pressed: boolean; imageUrl?: string; imageName?: string; imageMeta?: string };
} = {}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [priv, setPriv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [capsErr, setCapsErr] = useState(false);
  const [provs, setProvs] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [recent, setRecent] = useState<CheckSummary[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCapabilities().then(setCaps).catch(() => setCapsErr(true));
    getProviders().then((r) => {
      setProvs(r.providers);
      let saved: string | null = null;
      try { saved = localStorage.getItem("vf-provider"); } catch {}
      const ok = (id: string | null) => r.providers.find((p) => p.id === id && p.configured)?.id ?? null;
      setProvider(ok(saved) ?? ok(r.default));
    }).catch(() => setCapsErr(true));
    if (!demo) {
      listChecks(6).then(setRecent).catch(() => {});
    }
  }, [demo]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(id: string) { setProvider(id); try { localStorage.setItem("vf-provider", id); } catch {} }

  function attachFile(f: File | null) {
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Only JPEG, PNG, and WebP images are supported.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError("Image exceeds the 15 MB upload limit.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (demo) return;
    const item = Array.from(e.clipboardData.items).find((it) => ACCEPTED_TYPES.includes(it.type));
    if (item) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        attachFile(f);
      }
    }
  }

  async function submit() {
    const v = value.trim();
    if ((!v && !file) || busy || demo) return;
    setBusy(true); setError(null);
    try {
      if (file) {
        const { id } = await createMultimodalCheck({
          image: file,
          ...(isUrl(v) ? { url: v } : { claim: v }),
          private: priv,
          provider: provider ?? undefined,
        });
        router.push(`/check/${id}`);
      } else {
        const { id } = await createCheck({
          ...(isUrl(v) ? { url: v } : { text: v }),
          private: priv,
          provider: provider ?? undefined,
        });
        router.push(`/check/${id}`);
      }
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const shown = demo ? demo.value : value;
  const starting = busy || !!demo?.pressed;
  const activePreview = demo ? (demo.imageUrl ?? null) : preview;
  const activeFileName = demo ? (demo.imageName ?? null) : (file?.name ?? null);
  const hasImg = Boolean(activePreview);
  const modeLabel = hasImg
    ? (shown.trim() ? (isUrl(shown) ? "Image + URL" : "Image + Claim") : "Image only")
    : (isUrl(shown) ? "URL detected" : "Claim / Text");

  return (
    <section className="pt-10 sm:pt-16">
      <p className="label mb-4">Multimodal fake information detector</p>
      <h1 className="max-w-4xl font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl">
        Don’t trust it. <em className="text-signal not-italic">Trace it.</em>
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-dim">
        Upload an image and enter the claim about it — or paste any text or link. VeriFact checks{" "}
        <span className="text-fg">whether the image is real</span> (EXIF/C2PA, ELA, noise forensics, visual artifacts &amp; provenance),{" "}
        <span className="text-fg">whether the image matches the claim</span>, and{" "}
        <span className="text-fg">whether the claim itself is factually true</span>.
      </p>

      <div
        className={`glass relative mt-10 overflow-hidden rounded-2xl p-3 transition-colors ${dragging ? "border-signal" : ""}`}
        onDragOver={(e) => { if (!demo) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false);
          if (!demo) attachFile(e.dataTransfer.files?.[0] ?? null);
        }}
        onPaste={handlePaste}
      >
        {starting && !error && <div aria-hidden className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-signal/25 to-transparent" style={{ animation: "scan 1.2s linear infinite" }} />}

        {/* Image upload zone placed ABOVE #claim so Demo.tsx's `#claim + div > button` selector remains intact */}
        {(!demo || demo.imageUrl) && (
          <div className="mb-3 rounded-xl border border-dashed border-line/90 bg-ink/40 p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => { attachFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
            />
            {activePreview ? (
              <div className="flex flex-wrap items-center gap-4">
                <img src={activePreview} alt="Uploaded preview" className="h-20 w-28 rounded-lg border border-line object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{activeFileName}</p>
                  <p className="font-mono text-xs text-dim">
                    {demo?.imageMeta ?? `${(file?.type ?? "").replace("image/", "").toUpperCase()} · ${((file?.size ?? 0) / 1024).toFixed(1)} KB · Ready for EXIF/ELA/noise + vision analysis`}
                  </p>
                </div>
                {!demo && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="glass rounded-md px-3 py-1.5 text-xs hover:text-signal">Replace</button>
                    <button type="button" onClick={() => setFile(null)} className="glass rounded-md px-3 py-1.5 text-xs text-ref hover:border-ref">Remove</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-1">
                <div className="flex items-center gap-3 text-sm text-dim">
                  <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg border border-line font-mono text-signal">IMG</span>
                  <div>
                    <p className="text-fg">Attach an image to verify its authenticity &amp; match against your claim</p>
                    <p className="text-xs text-dim">Drop, paste (⌘V), or browse · JPEG, PNG, WebP up to 15 MB</p>
                  </div>
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="glass rounded-lg px-3.5 py-2 text-xs font-medium text-signal hover:border-signal">
                  + Upload image
                </button>
              </div>
            )}
          </div>
        )}

        <label htmlFor="claim" className="sr-only">Claim about the image, article text or link</label>
        <textarea id="claim" value={shown} readOnly={!!demo} onChange={(e) => setValue(e.target.value)} rows={4} maxLength={20000}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          placeholder={file
            ? "Enter the claim or caption made about this image (e.g. 'Photo shows flooding in Paris today')…"
            : "Enter a claim about your image, paste a social post/article, or paste a URL…"}
          className="w-full resize-none rounded-xl bg-transparent p-4 text-lg outline-none placeholder:text-dim/70" />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-2 pt-3">
          <div className="flex flex-wrap items-center gap-4 text-sm text-dim">
            <span className="font-mono text-xs text-signal">{modeLabel}</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />Keep private</label>
          </div>
          <motion.button whileTap={{ scale: 0.97 }} onClick={submit} disabled={(!shown.trim() && !hasImg) || (busy && !demo) || (!provider && !demo)}
            className="rounded-lg bg-signal px-5 py-2.5 font-medium text-ink disabled:cursor-not-allowed disabled:opacity-40">
            {starting ? "Starting…" : hasImg && shown.trim() ? "Verify Image + Claim  ⌘↵" : hasImg ? "Verify Image  ⌘↵" : "Investigate  ⌘↵"}
          </motion.button>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="label mb-2">Reasoning &amp; Vision model</legend>
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

      {!demo && recent.length > 0 && (
        <div className="mt-8">
          <p className="label mb-2">Recent investigations</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((r) => {
              const st = VERDICT_STYLE[r.overall_verdict ?? "Unverifiable"] ?? VERDICT_STYLE["Unverifiable"];
              const toneCls = st.tone === "sup" ? "text-sup" : st.tone === "ref" ? "text-ref" : st.tone === "amber" ? "text-amber" : "text-dim";
              return (
                <Link key={r.id} href={`/check/${r.id}`} className="glass block rounded-lg p-3 text-sm transition hover:border-signal">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-dim">{r.has_image ? "IMG + CLAIM" : "TEXT / URL"}</span>
                    <span className={`font-mono text-xs ${toneCls}`}>{r.overall_verdict ?? r.status}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-fg">{r.snippet || r.image_name || r.id}</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {caps && <Availability caps={caps} />}
    </section>
  );
}

function Availability({ caps }: { caps: Capability[] }) {
  return (
    <div className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Feature availability">
      {caps.map((c) => (
        <div key={c.id} className="glass rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>{c.label}</span>
            <span className={`font-mono text-xs ${c.configured ? "text-sup" : "text-amber"}`}>{c.configured ? "● Ready" : "○ Optional / Not configured"}</span>
          </div>
          {!c.configured && <p className="mt-1 text-xs text-dim">Needs <code className="font-mono">{c.needs.join(", ")}</code>. {c.how_to_enable}</p>}
        </div>
      ))}
    </div>
  );
}
