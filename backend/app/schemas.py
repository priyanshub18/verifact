from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ClaimKind(str, Enum):
    factual = "factual"
    opinion = "opinion"
    prediction = "prediction"
    question = "question"
    other = "other"


class ExtractedClaim(BaseModel):
    text: str = Field(description="Atomic, self-contained claim; resolve pronouns and implicit context.")
    kind: ClaimKind
    checkworthy: bool
    topic_sensitivity: str = Field(description="one of: none, health, election, violence, finance")
    claim_date: str | None = Field(None, description="ISO date or year the claim refers to, if stated or implied")
    language: str = Field(description="ISO 639-1 code of the original text")
    original_span: str = Field(description="Verbatim substring of the input this claim came from")


class ClaimExtraction(BaseModel):
    claims: list[ExtractedClaim]


class QueryPlan(BaseModel):
    supporting: list[str] = Field(description="2-3 search queries seeking evidence that would confirm the claim")
    disconfirming: list[str] = Field(description="2-3 queries seeking evidence that would refute or complicate it")
    en_queries: list[str] = Field(default_factory=list, description="English versions if claim is not English")


class Stance(str, Enum):
    supports = "supports"
    refutes = "refutes"
    neutral = "neutral"


class PassageStance(BaseModel):
    passage_id: int
    stance: Stance
    quote: str = Field(description="Verbatim excerpt (<=300 chars) copied from the passage that justifies the stance; empty only if neutral")
    rationale: str = Field(description="One sentence")
    evidence_date_note: str | None = Field(None, description="If evidence is about a different time period than the claim")


class StanceBatch(BaseModel):
    results: list[PassageStance]


class VisualAuthAssessment(str, Enum):
    likely_authentic = "likely_authentic"
    suspicious_editing = "suspicious_editing"
    likely_ai_generated = "likely_ai_generated"
    uncertain = "uncertain"


class ClaimImageAlignment(str, Enum):
    consistent = "consistent"
    partially_consistent = "partially_consistent"
    mismatched_context = "mismatched_context"
    contradicts_image = "contradicts_image"
    no_claim = "no_claim"


class VisualAnalysis(BaseModel):
    scene_description: str = Field(description="Objective description of what is visibly depicted in the image")
    visible_text: str = Field(default="", description="Verbatim text visible inside the image (signs, captions, chyrons, watermarks); empty if none")
    visual_entities: list[str] = Field(default_factory=list, description="Key identifiable landmarks, people, organizations, objects, or places")
    authenticity_assessment: VisualAuthAssessment
    authenticity_rationale: str = Field(description="2-3 sentences explaining observable visual cues for or against authenticity")
    visual_anomalies: list[str] = Field(default_factory=list, description="Specific visual anomalies observed (warped fingers, garbled text, lighting mismatch, splicing seams, AI watermarks); empty if none")
    watermarks_or_badges: list[str] = Field(default_factory=list, description="Visible logos, news chyrons, social UI, or AI watermarks")
    claim_alignment: ClaimImageAlignment
    alignment_explanation: str = Field(description="2-3 sentences explaining whether the image actually depicts what the user's claim states")
    image_search_queries: list[str] = Field(default_factory=list, description="2-4 short web search queries to find the original photo, event, or fact-checks about this image")
    embedded_claims: list[str] = Field(default_factory=list, description="Checkable factual claims printed inside the image itself, if any")


class ProvenanceFinding(BaseModel):
    finding: str = Field(description="one of: confirmed_authentic, debunked_ai, debunked_manipulated, debunked_out_of_context, inconclusive")
    summary: str = Field(description="1-2 sentences summarising what retrieved provenance/fact-check sources say about this image")
    supporting_urls: list[str] = Field(default_factory=list, description="URLs from the provided list that justify this finding")


class Verdict(str, Enum):
    true = "True"
    mostly_true = "Mostly True"
    mixed = "Mixed/Misleading Context"
    mostly_false = "Mostly False"
    false = "False"
    manipulated = "Manipulated Media"
    ai_generated = "AI-Generated"
    satire = "Satire"
    unverifiable = "Unverifiable"
    disputed = "Disputed"
    not_checkworthy = "Not Checkworthy"


# ---- API / persisted shapes ----

class CredibilityBreakdown(BaseModel):
    score: float
    domain_class: str
    https: bool
    is_primary: bool
    recency_days: int | None
    signals: list[str]


class EvidenceItem(BaseModel):
    id: int
    url: str
    domain: str
    title: str
    publisher: str
    published_at: str | None
    retrieved_at: datetime
    source_type: str  # factcheck | web | news | wikipedia | scholarly
    excerpt: str
    stance: Stance
    quote: str
    rationale: str
    rerank_score: float
    rerank_method: str
    credibility: CredibilityBreakdown
    syndicate_group: str | None = None
    counted: bool = True
    discard_reason: str | None = None
    date_note: str | None = None
    nli_label: str | None = None
    nli_score: float | None = None


class ExistingFactCheck(BaseModel):
    claim_text: str
    claimant: str | None
    publisher: str
    url: str
    title: str
    rating: str
    review_date: str | None
    retrieved_at: datetime


class ClaimResult(BaseModel):
    claim: ExtractedClaim
    verdict: Verdict
    confidence: float | None
    confidence_calibrated: bool
    confidence_explanation: str
    queries: list[str]
    fact_checks: list[ExistingFactCheck]
    evidence: list[EvidenceItem]
    unknowns: list[str]
    how_to_verify: list[str]
    weights: dict[str, float]


class ImageProvenanceMatch(BaseModel):
    url: str
    domain: str
    title: str
    snippet: str
    source_type: str
    credibility_score: float


class ImageAnalysis(BaseModel):
    image_verdict: str  # Likely Authentic | Likely Manipulated | Likely AI-Generated | Inconclusive
    image_is_real: bool | None = None
    image_confidence: float | None = None
    forensics_source: str = "local"  # ml-service | local
    metadata: dict = Field(default_factory=dict)
    ela_stats: dict = Field(default_factory=dict)
    ela_heatmap_png_base64: str | None = None
    noise_stats: dict = Field(default_factory=dict)
    noise_heatmap_png_base64: str | None = None
    spectral_stats: dict = Field(default_factory=dict)
    forensic_flags: list[str] = Field(default_factory=list)
    forensic_risk: str = "low"
    visual: VisualAnalysis | None = None
    provenance_finding: str = "inconclusive"
    provenance_summary: str = ""
    provenance_matches: list[ImageProvenanceMatch] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class MultimodalSummary(BaseModel):
    image_verdict: str
    image_is_real: bool | None = None
    claim_verdict: str
    claim_is_real: bool | None = None
    image_claim_match: str
    summary: str


class InputInfo(BaseModel):
    kind: str  # text | url | image | image+claim
    text: str
    url: str | None = None
    title: str | None = None
    author: str | None = None
    published_at: str | None = None
    domain: str | None = None
    fetch_note: str | None = None
    image_name: str | None = None
    image_mime: str | None = None
    has_image: bool = False


class CheckResult(BaseModel):
    id: str
    status: str
    created_at: datetime
    input: InputInfo
    overall_verdict: Verdict | None = None
    multimodal_summary: MultimodalSummary | None = None
    image_analysis: ImageAnalysis | None = None
    claims: list[ClaimResult] = []
    style_signals: list[str] = []
    errors: list[str] = []
    llm_usage: dict[str, int] = {}
    timings_ms: dict[str, int] = {}
    limitations: list[str] = []
