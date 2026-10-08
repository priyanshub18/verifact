"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const COMMANDS = [
  { label: "New check", href: "/" }, { label: "Architecture", href: "/architecture" }, { label: "How VeriFact works", href: "/how-it-works" },
  { label: "Known limitations", href: "/limitations" },
];

export function Chrome() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { const t = localStorage.getItem("vf-theme"); if (t === "light" || t === "dark") setTheme(t); } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("vf-theme", theme); } catch {}
  }, [theme]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const list = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-2xl tracking-tight">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-signal shadow-[0_0_18px_rgb(var(--signal))]" />VeriFact
        </Link>
        <nav className="flex items-center gap-2 text-sm" aria-label="Primary">
          <Link className="hidden px-3 py-2 text-dim hover:text-fg sm:block" href="/architecture">Architecture</Link>
          <Link className="hidden px-3 py-2 text-dim hover:text-fg sm:block" href="/how-it-works">How it works</Link>
          <Link className="hidden px-3 py-2 text-dim hover:text-fg sm:block" href="/limitations">Limitations</Link>
          <button onClick={() => setOpen(true)} className="glass rounded-md px-3 py-2 font-mono text-xs text-dim hover:text-fg" aria-label="Open command palette">⌘K</button>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="glass rounded-md px-3 py-2 text-xs" aria-pressed={theme === "light"}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </nav>
      </header>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Command palette" className="fixed inset-0 z-[80] grid place-items-start bg-black/60 p-4 pt-[15vh]" onClick={() => setOpen(false)}>
          <div className="glass mx-auto w-full max-w-md rounded-lg p-2" onClick={(e) => e.stopPropagation()}>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to…" aria-label="Command"
              onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { router.push(list[0].href); setOpen(false); } }}
              className="w-full bg-transparent px-3 py-2 font-mono text-sm outline-none" />
            <ul>{list.map((c) => (
              <li key={c.href}><button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-line/40" onClick={() => { router.push(c.href); setOpen(false); }}>{c.label}</button></li>
            ))}</ul>
          </div>
        </div>
      )}
    </>
  );
}
