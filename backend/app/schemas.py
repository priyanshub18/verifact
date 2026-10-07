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


class InputInfo(BaseModel):
    kind: str  # text | url
    text: str
    url: str | None = None
    title: str | None = None
    author: str | None = None
    published_at: str | None = None
    domain: str | None = None
    fetch_note: str | None = None


class CheckResult(BaseModel):
    id: str
    status: str
    created_at: datetime
    input: InputInfo
    overall_verdict: Verdict | None = None
    claims: list[ClaimResult] = []
    style_signals: list[str] = []
    errors: list[str] = []
    llm_usage: dict[str, int] = {}
    timings_ms: dict[str, int] = {}
    limitations: list[str] = []
