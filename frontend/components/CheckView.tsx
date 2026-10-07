"use client";
import { useEffect, useRef, useState } from "react";
import { API, CheckResult, ProgressEvent, getCheck } from "@/lib/api";
import { Investigation } from "./Investigation";
import { ResultView } from "./ResultView";

export function CheckView({ id }: { id: string }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [status, setStatus] = useState("running");
  const [err, setErr] = useState<string | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;
    const load = async () => {
      try {
        const c = await getCheck(id);
        setEvents(c.events); setResult(c.result); setStatus(c.status);
        return c.status;
      } catch (e) { setErr((e as Error).message); return "failed"; }
    };
    load().then((s) => {
      if (s === "done" || s === "failed") return;
      es = new EventSource(`${API}/api/checks/${id}/events`);
      es.addEventListener("progress", (m) => setEvents((p) => [...p, JSON.parse((m as MessageEvent).data)]));
      es.addEventListener("complete", async () => { finished.current = true; es?.close(); await load(); });
      es.onerror = () => { if (!finished.current) { es?.close(); load(); } };
    });
    return () => es?.close();
  }, [id]);

  if (err) return <p role="alert" className="pt-16 text-ref">⚠ {err}</p>;
  if (status === "done" && result) return <ResultView result={result} events={events} />;
  return (
    <div className="pt-12">
      <Investigation events={events} failed={status === "failed"} errors={result?.errors} />
    </div>
  );
}
