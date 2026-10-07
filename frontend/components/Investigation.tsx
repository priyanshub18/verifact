"use client";
import { motion } from "framer-motion";
import { ProgressEvent } from "@/lib/api";

const STEP_LABEL: Record<string, string> = {
  fetch: "Fetching the page", claims: "Extracting claims", queries: "Planning searches (incl. disconfirming)",
  search: "Searching sources", read: "Reading evidence", verify: "Weighing stance & credibility", done: "Finished", error: "Error",
};

export function Investigation({ events, failed, errors }: { events: ProgressEvent[]; failed: boolean; errors?: string[] }) {
  // Only real events from the backend are rendered: latest status per step, in order of first appearance.
  const order: string[] = [];
  const latest: Record<string, ProgressEvent> = {};
  for (const e of events) { if (!order.includes(e.step)) order.push(e.step); latest[e.step] = e; }
  return (
    <section aria-live="polite" aria-label="Live investigation">
      <p className="label mb-3">Live investigation</p>
      <h2 className="font-display text-4xl">{failed ? "The investigation stopped" : "Reading the evidence…"}</h2>
      <ol className="mt-8 space-y-3">
        {order.length === 0 && <li className="text-dim">Waiting for the worker to pick up the job…</li>}
        {order.map((s) => {
          const e = latest[s];
          const mark = e.status === "done" ? "✓" : e.status === "failed" ? "✗" : "◐";
          const tone = e.status === "done" ? "text-sup" : e.status === "failed" ? "text-ref" : "text-signal";
          return (
            <motion.li key={s} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="glass flex gap-4 rounded-lg p-4">
              <span className={`font-mono text-xl ${tone}`} aria-label={e.status}>{mark}</span>
              <div>
                <p className="font-medium">{STEP_LABEL[s] ?? s}</p>
                <p className="text-sm text-dim">{e.detail}</p>
                {s === "queries" && Array.isArray(e.data.queries) && (
                  <ul className="mt-2 font-mono text-xs text-dim">{(e.data.queries as string[]).map((q) => <li key={q}>› {q}</li>)}</ul>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {failed && errors?.map((er) => <p key={er} role="alert" className="mt-4 text-ref">⚠ {er}</p>)}
    </section>
  );
}
