# Evaluation

**Status: tooling built and unit-tested; no benchmark has been run yet, so no accuracy numbers are published.** Do not quote any until a real run exists.

## Harness (`eval/`)
- `metrics.py`: per-class precision/recall/F1, macro-F1, accuracy, AUROC (Mann-Whitney with ties), ECE and reliability-diagram bins, confusion matrix. Hand-computed unit tests in `eval/tests`.
- `run_claims.py`: submits each labelled claim to the **running API** (real pipeline, real retrieval, real LLM), waits for the verdict and maps it to `supported | refuted | nei`. *Unverifiable, Disputed, Mixed and failures all count as `nei`*, so refusing to answer is measured honestly (see `coverage_non_nei_predictions`).
- `convert_liar.py`: converts the public LIAR TSV (you download it). 6-way → 3-way: true/mostly-true → supported, false/pants-fire → refuted; half-true/barely-true are dropped as ambiguous.

## Run
```bash
python eval/convert_liar.py test.tsv > eval/data/liar_test.jsonl     # data is git-ignored
python eval/run_claims.py eval/data/liar_test.jsonl --provider groq --limit 50 --out eval/report.json
python -m pytest eval/tests
```
Free-tier Groq limits make large runs slow; 50 claims is a sensible first pass. Reports go to `eval/report*.json` (ignored by git).

## What the report contains
`n`, per-class P/R/F1, macro-F1, accuracy, confusion matrix, coverage, **ECE of the uncalibrated scores**, reliability bins, AUROC (supported vs refuted), per-row outcomes.

## Caveats you must state alongside any result
- LIAR is political statements with noisy labels; FEVER is Wikipedia-derived. Neither reflects breaking news. The pipeline retrieves *live* web evidence, so results drift over time and can leak the answer (fact-check pages for LIAR claims exist online).
- The confidence is uncalibrated. Calibration (temperature/Platt/isotonic on a held-out split) is planned; until then ECE here is expected to be poor.
- Small samples: report counts next to every percentage.

## Not yet built
FEVER, AVeriTeC, MultiFC, CheckThat! runners; NewsCLIPpings/Fakeddit; FaceForensics++/Celeb-DF/DFDC; ASVspoof; calibration fitting; user-flag review queue and regression set.
