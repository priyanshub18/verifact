from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app import forensics, registry

app = FastAPI(title="VeriFact ML service", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True, **registry.status(),
            "endpoints": {"/rerank": "needs torch", "/nli": "needs torch", "/forensics/ela": "ready", "/forensics/noise": "ready"}}


class RerankReq(BaseModel):
    query: str = Field(max_length=2000)
    passages: list[str] = Field(max_length=64)


@app.post("/rerank")
def rerank(req: RerankReq):
    """Cross-encoder relevance. Returns raw logits and a sigmoid score in 0..1 per passage (input order)."""
    try:
        m = registry.get_cross_encoder("rerank")
    except registry.ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e
    import numpy as np
    logits = np.asarray(m.predict([(req.query, p[:2000]) for p in req.passages], show_progress_bar=False), dtype=float).reshape(-1)
    return {"model": registry.model_name("rerank"), "logits": logits.tolist(), "scores": (1 / (1 + np.exp(-logits))).tolist()}


class NLIPair(BaseModel):
    premise: str = Field(max_length=4000)
    hypothesis: str = Field(max_length=1000)


class NLIReq(BaseModel):
    pairs: list[NLIPair] = Field(max_length=32)


@app.post("/nli")
def nli(req: NLIReq):
    """Premise = evidence passage, hypothesis = claim. Labels per the model's own config (id2label)."""
    try:
        m = registry.get_cross_encoder("nli")
    except registry.ModelUnavailable as e:
        raise HTTPException(503, str(e)) from e
    import numpy as np
    logits = np.asarray(m.predict([(p.premise, p.hypothesis) for p in req.pairs], show_progress_bar=False), dtype=float)
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs = e / e.sum(axis=1, keepdims=True)
    id2label = {int(k): v.lower() for k, v in m.model.config.id2label.items()}
    return {"model": registry.model_name("nli"),
            "results": [{id2label[i]: float(row[i]) for i in range(len(row))} for row in probs]}


async def _read(file: UploadFile) -> bytes:
    data = await file.read(forensics.MAX_BYTES + 1)
    return data


@app.post("/forensics/ela")
async def ela(file: UploadFile = File(...), quality: int = 90):
    try:
        return forensics.ela(await _read(file), quality=max(50, min(98, quality)))
    except forensics.BadImage as e:
        raise HTTPException(422, str(e)) from e


@app.post("/forensics/noise")
async def noise(file: UploadFile = File(...)):
    try:
        return forensics.noise_residual(await _read(file))
    except forensics.BadImage as e:
        raise HTTPException(422, str(e)) from e
