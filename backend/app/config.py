from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Capability(BaseModel):
    id: str
    label: str
    configured: bool
    needs: list[str]
    how_to_enable: str


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://verifact:verifact@localhost:5432/verifact"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:3000"

    llm_provider: str = "groq"  # default provider: groq | anthropic | openai (users can toggle per check in the UI)
    llm_model: str = ""  # optional override applied to the default provider only
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    google_factcheck_api_key: str = ""
    tavily_api_key: str = ""
    brave_api_key: str = ""
    ncbi_api_key: str = ""  # optional, raises PubMed rate limit
    contact_email: str = ""  # sent to Crossref/Unpaywall "polite pool"; optional
    claimbuster_api_key: str = ""

    ml_service_url: str = ""

    cache_ttl_seconds: int = 6 * 3600
    fetch_timeout_seconds: float = 15.0
    fetch_max_bytes: int = 3_000_000
    max_claims: int = 3  # kept small so free-tier LLM rate limits survive a demo
    max_sources_per_claim: int = 8
    stance_excerpt_chars: int = 900
    llm_concurrency: int = 1

    def provider_key(self, provider: str) -> str:
        return {"groq": self.groq_api_key, "anthropic": self.anthropic_api_key, "openai": self.openai_api_key}.get(provider, "")

    def provider_model(self, provider: str) -> str:
        if self.llm_model and provider == self.llm_provider:
            return self.llm_model
        return {"groq": self.groq_model, "anthropic": "claude-opus-5-5", "openai": "gpt-4.1"}.get(provider, "")

    def providers(self) -> list[dict]:
        meta = {"groq": ("Groq (free tier)", "Set GROQ_API_KEY (console.groq.com, free)."),
                "anthropic": ("Anthropic Claude (paid)", "Set ANTHROPIC_API_KEY (console.anthropic.com)."),
                "openai": ("OpenAI (paid)", "Set OPENAI_API_KEY.")}
        return [{"id": k, "label": v[0], "configured": bool(self.provider_key(k)), "model": self.provider_model(k),
                 "how_to_enable": v[1], "free": k == "groq"} for k, v in meta.items()]

    def resolve_provider(self, requested: str | None) -> str | None:
        """An explicit request is honoured or rejected (never silently swapped); otherwise pick the first configured default."""
        if requested:
            return requested if self.provider_key(requested) else None
        for p in (self.llm_provider, "groq", "anthropic", "openai"):
            if self.provider_key(p):
                return p
        return None

    @property
    def llm_configured(self) -> bool:
        return any(self.provider_key(p) for p in ("groq", "anthropic", "openai"))

    def capabilities(self) -> list[Capability]:
        s = self
        return [
            Capability(id="llm", label="Claim extraction & stance reasoning", configured=s.llm_configured,
                       needs=["GROQ_API_KEY (free) or ANTHROPIC_API_KEY or OPENAI_API_KEY"],
                       how_to_enable="Add GROQ_API_KEY (free) or another provider key to .env, then restart."),
            Capability(id="factcheck", label="Existing fact-checks (Google ClaimReview)",
                       configured=bool(s.google_factcheck_api_key), needs=["GOOGLE_FACTCHECK_API_KEY"],
                       how_to_enable="Enable 'Fact Check Tools API' in Google Cloud and create an API key (free)."),
            Capability(id="web_search", label="Paid web search (Tavily/Brave, optional)",
                       configured=bool(s.tavily_api_key or s.brave_api_key),
                       needs=["TAVILY_API_KEY or BRAVE_API_KEY"],
                       how_to_enable="Get a key at tavily.com or brave.com/search/api (free tiers available)."),
            Capability(id="ddg_search", label="Free web search (DuckDuckGo)", configured=True, needs=[],
                       how_to_enable="No key needed. Unofficial endpoint: may rate-limit."),
            Capability(id="gdelt", label="GDELT news index", configured=True, needs=[], how_to_enable="No key needed."),
            Capability(id="wikipedia", label="Wikipedia", configured=True, needs=[], how_to_enable="No key needed."),
            Capability(id="scholarly", label="PubMed / Crossref", configured=True, needs=[],
                       how_to_enable="No key needed. NCBI_API_KEY and CONTACT_EMAIL raise rate limits."),
            Capability(id="claimbuster", label="ClaimBuster checkworthiness score",
                       configured=bool(s.claimbuster_api_key), needs=["CLAIMBUSTER_API_KEY"],
                       how_to_enable="Request a key at idir.uta.edu/claimbuster/api. Optional; LLM labels checkworthiness otherwise."),
            Capability(id="ml_service", label="Neural reranker / NLI / forensics (ml-service)",
                       configured=bool(s.ml_service_url), needs=["ML_SERVICE_URL"],
                       how_to_enable="Start the ml-service container and set ML_SERVICE_URL. BM25 lexical reranking is used until then."),
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
