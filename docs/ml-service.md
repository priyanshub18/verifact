# ML service

Separate container so torch and model weights never enter the API image. **Weights download on first use** (never at import/startup), so the service boots instantly and `/health` honestly reports what is loaded.

## Models
| Key | Default model | Task | Licence | Size | Env override |
|---|---|---|---|---|---|
| rerank | `cross-encoder/ms-marco-MiniLM-L-6-v2` | passage relevance | Apache-2.0 | ~90 MB | `RERANK_MODEL` |
| nli | `cross-encoder/nli-deberta-v3-xsmall` | entailment / neutral / contradiction | Apache-2.0 | ~280 MB | `NLI_MODEL` |

Verified: `pytest -m models` downloads both and passes (the reranker ranks the Eiffel-Tower passage above a cats passage; the NLI model labels "in Paris" as entailment and "in Rome" as contradiction). CPU only. Check licences yourself before commercial use if you swap models.

## Forensics (no model needed)
- **ELA** (`forensics.ela`): recompress as JPEG (default q=90), amplify the difference, report mean/max/p99 error, **block error CV** (unevenness across 16×16 block grid) and the fraction of unusually hot blocks, plus a heatmap.
- **Noise residual** (`forensics.noise_residual`): image minus 3×3 median filter; block-level noise variation and a heatmap.
- Test: an image with a pasted, differently-compressed patch scores higher `block_error_cv` and `p99_error` than an untouched control.

### Limitations (also returned with every result)
ELA is unreliable on resized, re-saved or heavily compressed images (typical of social media); weak for PNG/WebP; high-contrast edges and textures create error without editing. Noise varies naturally with content and denoising, and no calibrated threshold is claimed. **These are indicators, never proof of manipulation.** No people are identified from faces.

## Integration
`backend/app/retrieval/mlclient.py` calls `/rerank`. With `ML_SERVICE_URL` set, `rerank_method` on each evidence item reads `cross-encoder:<model>`; if the service is down the pipeline falls back to BM25 and adds a visible note. `/nli` and `/forensics/*` are served and tested but **not yet wired into the verdict or the UI**.

## Run
```bash
cd ml-service && uv venv && uv pip install -e ".[dev]"            # forensics only
uv pip install torch --extra-index-url https://download.pytorch.org/whl/cpu && uv pip install -e ".[models]"
uvicorn app.main:app --port 8100
pytest              # offline forensics tests
pytest -m models    # downloads weights (~370 MB)
# Docker: docker compose -f infra/docker-compose.yml --profile ml up --build   (then ML_SERVICE_URL=http://ml-service:8100)
```

## Planned (not implemented)
AI-generated image ensemble, copy-move and JPEG-ghost analysis, splicing localisation model, Whisper/faster-whisper, pyannote diarisation, deepfake and anti-spoofing detectors.
