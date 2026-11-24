"""Deterministic, inspectable evidence aggregation & multimodal verdict fusion.

Confidence here is a *heuristic evidence-strength score*, not a calibrated probability.
It is flagged `confidence_calibrated=False` until a calibrator fitted on held-out data is loaded.
"""
from __future__ import annotations

import math

from app.schemas import (
    ClaimImageAlignment,
    ClaimResult,
    EvidenceItem,
    ImageAnalysis,
    MultimodalSummary,
    Stance,
    Verdict,
    VisualAuthAssessment,
)

MIN_DOMAINS = {"none": 2, "finance": 2, "health": 3, "election": 3, "violence": 3}
MIN_TOTAL_WEIGHT = 0.9

ALIGNMENT_LABELS = {
    ClaimImageAlignment.consistent: "Consistent",
    ClaimImageAlignment.partially_consistent: "Partially Consistent",
    ClaimImageAlignment.mismatched_context: "Mismatched / Out of Context",
    ClaimImageAlignment.contradicts_image: "Contradicts Image",
    ClaimImageAlignment.no_claim: "No Claim Provided",
}


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


def evaluate_image_authenticity(
    metadata: dict,
    forensic_risk: str,
    visual_auth: VisualAuthAssessment | None,
    visual_anomalies: list[str],
    provenance_finding: str,
) -> tuple[str, bool | None, float | None]:
    """Deterministically assess whether the image appears real, manipulated, AI-generated, or inconclusive."""
    ai_meta = bool(metadata.get("ai_metadata_detected"))
    editor_meta = bool(metadata.get("editing_software_detected"))
    has_camera_exif = bool(metadata.get("camera_make") or metadata.get("camera_model"))

    if ai_meta or provenance_finding == "debunked_ai":
        conf = 0.92 if (ai_meta and (visual_auth == VisualAuthAssessment.likely_ai_generated or provenance_finding == "debunked_ai")) else 0.85
        return "Likely AI-Generated", False, conf

    if provenance_finding == "debunked_manipulated":
        return "Likely Manipulated", False, 0.85

    if visual_auth == VisualAuthAssessment.likely_ai_generated:
        conf = 0.78 if (len(visual_anomalies) >= 2 or not metadata.get("has_exif")) else 0.65
        return "Likely AI-Generated", False, conf

    if visual_auth == VisualAuthAssessment.suspicious_editing or (editor_meta and forensic_risk == "elevated"):
        conf = 0.76 if (editor_meta or forensic_risk in ("elevated", "moderate")) else 0.62
        return "Likely Manipulated", False, conf

    if provenance_finding == "confirmed_authentic":
        return "Likely Authentic", True, 0.82

    if visual_auth == VisualAuthAssessment.likely_authentic:
        if forensic_risk == "elevated":
            return "Inconclusive", None, 0.45
        conf = 0.74 if has_camera_exif else 0.62
        return "Likely Authentic", True, conf

    return "Inconclusive", None, None


def fuse_multimodal(
    image_analysis: ImageAnalysis,
    claim_results: list[ClaimResult],
    claim_overall: Verdict,
    has_user_claim: bool,
) -> tuple[Verdict, MultimodalSummary]:
    """Deterministically fuse image authenticity + image-claim alignment + claim factuality."""
    img_v = image_analysis.image_verdict
    img_real = image_analysis.image_is_real
    visual = image_analysis.visual
    alignment = visual.claim_alignment if visual else ClaimImageAlignment.no_claim
    prov = image_analysis.provenance_finding

    # If provenance search explicitly revealed out-of-context reuse, elevate alignment mismatch
    if prov == "debunked_out_of_context" and has_user_claim:
        alignment = ClaimImageAlignment.mismatched_context

    align_label = ALIGNMENT_LABELS.get(alignment, "Unclear")
    claim_v_str = claim_overall.value if (has_user_claim or claim_results) else "No Claim Provided"

    # Determine claim_is_real tri-state
    claim_is_real: bool | None
    if not (has_user_claim or claim_results):
        claim_is_real = None
    elif claim_overall in (Verdict.true, Verdict.mostly_true):
        claim_is_real = True
    elif claim_overall in (Verdict.false, Verdict.mostly_false, Verdict.satire):
        claim_is_real = False
    else:
        claim_is_real = None

    # If the image directly contradicts the claim and web evidence was inconclusive, mark claim false/misleading
    if has_user_claim and alignment == ClaimImageAlignment.contradicts_image and claim_is_real is None:
        claim_is_real = False
        claim_v_str = "False (Contradicted by Image)"
    elif has_user_claim and alignment == ClaimImageAlignment.mismatched_context and claim_is_real is not False:
        claim_is_real = False
        if claim_overall in (Verdict.unverifiable, Verdict.not_checkworthy):
            claim_v_str = "Mixed/Misleading Context"

    # Fuse into overall Verdict
    if img_v == "Likely AI-Generated":
        overall = Verdict.ai_generated
    elif img_v == "Likely Manipulated":
        overall = Verdict.manipulated
    elif has_user_claim and alignment == ClaimImageAlignment.contradicts_image:
        overall = Verdict.false
    elif has_user_claim and alignment == ClaimImageAlignment.mismatched_context:
        overall = Verdict.false if claim_overall in (Verdict.false, Verdict.mostly_false) else Verdict.mixed
    elif has_user_claim or claim_results:
        if claim_overall in (Verdict.true, Verdict.mostly_true) and img_real is True and alignment == ClaimImageAlignment.consistent:
            overall = claim_overall
        elif claim_overall in (Verdict.false, Verdict.mostly_false):
            overall = claim_overall
        elif claim_overall in (Verdict.mixed, Verdict.disputed, Verdict.satire):
            overall = claim_overall
        elif claim_overall in (Verdict.true, Verdict.mostly_true):
            overall = Verdict.mostly_true if alignment == ClaimImageAlignment.partially_consistent else claim_overall
        else:
            overall = Verdict.unverifiable
    else:
        # Image-only check with no claims
        overall = Verdict.unverifiable if img_real is None else Verdict.mostly_true

    # Compose clear, honest human summary
    parts: list[str] = []
    if img_v == "Likely AI-Generated":
        parts.append("Image assessment: Likely AI-Generated (synthetic media signals detected).")
    elif img_v == "Likely Manipulated":
        parts.append("Image assessment: Likely Manipulated (editing or forensic anomalies detected).")
    elif img_v == "Likely Authentic":
        parts.append("Image assessment: Likely Authentic (no clear AI-generation or manipulation signals found; note that authentic photos can still be miscaptioned).")
    else:
        parts.append("Image assessment: Inconclusive (forensic and visual cues are insufficient to confirm or refute authenticity).")

    if has_user_claim:
        if alignment == ClaimImageAlignment.contradicts_image:
            parts.append("Image–Claim match: The uploaded image visibly contradicts the submitted claim.")
        elif alignment == ClaimImageAlignment.mismatched_context:
            parts.append("Image–Claim match: The image appears out of context or mismatched with the submitted claim.")
        elif alignment == ClaimImageAlignment.consistent:
            parts.append("Image–Claim match: What is visible in the image is consistent with the claim.")
        elif alignment == ClaimImageAlignment.partially_consistent:
            parts.append("Image–Claim match: Only partially verifiable from the image alone; external evidence is needed for details like date/location.")
        parts.append(f"Claim verification: {claim_v_str}.")

    summary = MultimodalSummary(
        image_verdict=img_v,
        image_is_real=img_real,
        claim_verdict=claim_v_str,
        claim_is_real=claim_is_real,
        image_claim_match=align_label,
        summary=" ".join(parts),
    )
    return overall, summary


def how_to_verify(claim_text: str, evidence: list[EvidenceItem], sensitivity: str) -> list[str]:
    tips = ["Open the cited sources and read the highlighted excerpt in its original context.",
            "Check the original publication date against the date the claim refers to.",
            "Look for the primary source (official data, court record, study) rather than commentary about it."]
    if sensitivity == "health":
        tips.append("Cross-check with WHO, national health agencies, and the underlying study (PubMed).")
    if sensitivity == "election":
        tips.append("Confirm with the official electoral commission or certified results.")
    return tips
