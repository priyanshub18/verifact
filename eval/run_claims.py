"""Run the REAL pipeline (via the running API) over a labelled JSONL file and report metrics.

Input JSONL, one object per line: {"id": "...", "claim": "...", "label": "supported|refuted|nei"}
Usage: python run_claims.py data.jsonl --api http://localhost:8000 --provider groq --limit 50 --out report.json
Nothing is simulated: each row is submitted as a check and the resulting verdict is mapped to a 3-way label.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request

from metrics import auroc, confusion, ece, prf, reliability_bins

LABELS = ["supported", "refuted", "nei"]
MAP = {"True": "supported", "Mostly True": "supported", "False": "refuted", "Mostly False": "refuted"}


def verdict_to_label(v: str | None) -> str:
    return MAP.get(v or "", "nei")  # Unverifiable / Disputed / Mixed / errors all count as "no verdict"


def _req(url, data=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)


def run_one(api: str, claim: str, provider: str | None, timeout: int = 600) -> dict:
    cid = _req(f"{api}/api/checks", {"text": claim, "provider": provider, "private": True})["id"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        c = _req(f"{api}/api/checks/{cid}")
        if c["status"] in ("done", "failed"):
            return c
        time.sleep(2)
    return {"status": "timeout", "result": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--provider"); ap.add_argument("--limit", type=int, default=50); ap.add_argument("--out", default="report.json")
    a = ap.parse_args()
    rows = [json.loads(l) for l in open(a.data) if l.strip()][: a.limit]
    yt, yp, conf, rows_out = [], [], [], []
    for r in rows:
        c = run_one(a.api, r["claim"], a.provider)
        res = c.get("result") or {}
        claims = [x for x in res.get("claims", []) if x["verdict"] != "Not Checkworthy"]
        verdict = res.get("overall_verdict") if res else None
        pred = verdict_to_label(verdict)
        cf = next((x["confidence"] for x in claims if x["confidence"] is not None), None)
        yt.append(r["label"]); yp.append(pred); conf.append(cf if cf is not None else 0.0)
        rows_out.append({"id": r.get("id"), "label": r["label"], "pred": pred, "verdict": verdict, "status": c["status"], "confidence": cf})
        print(r.get("id"), r["label"], "->", pred, verdict)
    decided = [i for i, p in enumerate(yp) if p != "nei" or yt[i] == "nei"]
    report = {"n": len(rows), "metrics": prf(yt, yp, LABELS), "confusion": confusion(yt, yp),
              "coverage_non_nei_predictions": sum(p != "nei" for p in yp) / max(len(yp), 1),
              "ece_uncalibrated_scores": ece([conf[i] for i in decided], [yt[i] == yp[i] for i in decided]),
              "reliability": reliability_bins([conf[i] for i in decided], [yt[i] == yp[i] for i in decided]),
              "auroc_supported_vs_refuted": None, "rows": rows_out}
    sr = [(1 if t == "supported" else 0, 1.0 if p == "supported" else 0.0 if p == "refuted" else 0.5)
          for t, p in zip(yt, yp) if t in ("supported", "refuted")]
    if sr:
        report["auroc_supported_vs_refuted"] = auroc([s[0] for s in sr], [s[1] for s in sr])
    json.dump(report, open(a.out, "w"), indent=2)
    print(json.dumps({k: report[k] for k in ("n", "coverage_non_nei_predictions", "ece_uncalibrated_scores")}, indent=2))
    print("macro_f1:", round(report["metrics"]["macro_f1"], 3), "accuracy:", round(report["metrics"]["accuracy"], 3))


if __name__ == "__main__":
    main()
