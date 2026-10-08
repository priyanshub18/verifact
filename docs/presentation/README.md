# VeriFact presentation

| File | What it is |
|---|---|
| `VeriFact.pptx` | The 14-slide deck (editable; speaker notes on every slide) |
| `VeriFact.pdf` | PDF export of the same deck |
| `build_deck.js` | Script that generates the .pptx (pptxgenjs) |

**Before presenting:** fill in the two bracketed placeholders (cover: name/course/date; last slide: repo or contact link). The test counts on slide 8 ("39 tests") reflect the last real runs; update them if you add tests. Slide 11 says no accuracy numbers exist yet; if you run a benchmark sample first, replace that banner with the real numbers, sample size and caveats.

Slide 9's Evidence Board is a drawn sketch of the design, not a screenshot of a real result.

## Regenerating
```bash
cd docs/presentation && npm install pptxgenjs
PPTX_SKILL_DIR=<path to the pptx skill> NODE_PATH=$PWD/node_modules node build_deck.js
```
The last step applies the colour theme using the skill's `apply_theme.js`; without it the file still builds but theme colours fall back to Office defaults. Editing `VeriFact.pptx` directly in PowerPoint/Keynote is the simpler route for small changes.
