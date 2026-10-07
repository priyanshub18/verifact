"""Deterministic, inspectable evidence aggregation.

Confidence here is a *heuristic evidence-strength score*, not a calibrated probability.
It is flagged `confidence_calibrated=False` until a calibrator fitted on held-out data (milestone 4/5) is loaded.
"""
from __future__ import annotations

import math
from collections import defaultdict

from app.schemas import EvidenceItem, Stance, Verdict

MIN_DOMAINS = {"none": 2, "finance": 2, "health": 3, "election": 3, "violence": 3}
MIN_TOTAL_WEIGHT = 0.9


def weight_of(e: EvidenceItem) -> float:
    w = e.credibility.score * (0.5 + 0.5 * e.rerank_score)
    if e.date_note:
        w *= 0.5  # evidence concerns a different time period than the claim
    return round(w, 3)


def aggregate(evidence: list[EvidenceItem], sensitivity: str) -> tuple[Verdict, float | None, str, dict[str, float], list[str]]:
    counted = [e for e in evidence if e.counted and e.stance != Stance.neutral]
    sup = [e for e in counted if e.stance == Stance.supports]
    ref = [e for e in counted if e.stance == Stance.refutes]
    S, R = sum(weight_of(e) for e in sup), sum(weight_of(e) for e in ref)
    weights = {"supports": round(S, 3), "refutes": round(R, 3)}
    unknowns: list[str] = []
    need = MIN_DOMAINS.get(sensitivity, 2)
    d_sup, d_ref = len({e.domain for e in sup}), len({e.domain for e in ref})

    outdated = [e for e in counted if e.date_note]
    if outdated:
        unknowns.append(f"{len(outdated)} source(s) describe a different time period than the claim; down-weighted.")
    if not counted:
        unknowns.append("No retrieved source clearly supports or refutes the claim.")
        return Verdict.unverifiable, None, "No usable evidence was found that takes a position on this claim.", weights, unknowns
    total = S + R
    if total < MIN_TOTAL_WEIGHT:
        unknowns.append("Total weight of evidence is below the minimum threshold.")
        return Verdict.unverifiable, None, f"Evidence is too thin (weight {total:.2f} < {MIN_TOTAL_WEIGHT}).", weights, unknowns

    p = S / total
    strong_both = min(S, R) >= 0.35 * total and min(d_sup, d_ref) >= 1 and min(S, R) >= 0.6
    if strong_both and 0.35 < p < 0.65:
        verdict = Verdict.disputed if min(d_sup, d_ref) >= 2 else Verdict.mixed
    else:
        deciding = d_sup if p >= 0.5 else d_ref
        if deciding < need:
            unknowns.append(f"Only {deciding} independent domain(s) back the leading side; {need} required"
                            f"{' (stricter threshold for sensitive topic: ' + sensitivity + ')' if sensitivity != 'none' else ''}.")
            return Verdict.unverifiable, None, "Not enough independent sources agree to reach a verdict.", weights, unknowns
        verdict = (Verdict.true if p >= 0.85 else Verdict.mostly_true if p >= 0.65 else Verdict.mixed if p > 0.35
                   else Verdict.mostly_false if p > 0.15 else Verdict.false)

    strength = abs(p - 0.5) * 2 * (1 - math.exp(-total / 2.5))
    if sensitivity != "none":
        strength *= 0.85
    conf = round(min(0.95, strength), 2)
    expl = (f"Weighted evidence: {S:.2f} supporting ({d_sup} domains) vs {R:.2f} refuting ({d_ref} domains). "
            f"Score rises with agreement and total source weight; capped at 0.95. Uncalibrated heuristic.")
    if verdict in (Verdict.mixed, Verdict.disputed):
        conf = None
        expl = f"Sources conflict ({S:.2f} supporting vs {R:.2f} refuting); no single confidence is meaningful."
        unknowns.append("Credible sources disagree.")
    return verdict, conf, expl, weights, unknowns


def how_to_verify(claim_text: str, evidence: list[EvidenceItem], sensitivity: str) -> list[str]:
    tips = ["Open the cited sources and read the highlighted excerpt in its original context.",
            "Check the original publication date against the date the claim refers to.",
            "Look for the primary source (official data, court record, study) rather than commentary about it."]
    if sensitivity == "health":
        tips.append("Cross-check with WHO, national health agencies, and the underlying study (PubMed).")
    if sensitivity == "election":
        tips.append("Confirm with the official electoral commission or certified results.")
    return tips
