# design-qa

An agent that compares a **Figma design** against a **live web app** and reports every mismatch as a severity-graded issue. Built phase by phase from `figma-design-qa-agent-spec.md`.

**Current status: Phase 4** — the two-URL contract works end to end:

```bash
design-qa run --figma "https://figma.com/design/AbC123/Checkout?node-id=12-345" \
              --target "https://app.example.com/checkout"
```

Extract → capture → spec diff (Layer A) → region pixel diff (Layer B) → **vision adjudication with Claude (Layer C)** → a **`report.pdf`** (one attachable document, evidence images embedded), plus the self-contained `report.html` it's rendered from and the canonical `report.json`.

Layer C sends each candidate issue (evidence crops + structured deltas) to Claude, which judges **real regression vs cosmetic noise**, re-grades severity, and writes the one-line explanations in the report. Noise is down-ranked to `low`, never deleted — the previous grade is kept so a human can override. Requires `ANTHROPIC_API_KEY`; without it the run continues with the deterministic layers only (`--no-vision` silences the notice). `--no-pdf` skips the PDF.

## Setup

```bash
npm install
npx playwright install chromium   # browser for `capture`
```

Create a Figma personal access token (Figma → Settings → Security → Personal access tokens) and expose it:

```powershell
$env:FIGMA_TOKEN = "figd_..."
```

## Usage

```bash
# From a frame URL (the share link with ?node-id=…)
npm run dev -- extract --figma "https://www.figma.com/design/AbC123/Checkout?node-id=12-345"

# Or explicitly
npm run dev -- extract --file-key AbC123 --node-id 12:345 --out ./design-qa-output
```

Outputs into `./design-qa-output/`:

- `design-tree-<node>.json` — the normalized design tree (the pipeline contract, see `src/types.ts`)
- `frame-<node>@1x.png` / `@2x.png` — the frame rendered by Figma

### Capture a live page (Phase 2)

```bash
npm run dev -- capture --target "http://localhost:3000/signup"

# Override viewports (default 1440,768,375 from config)
npm run dev -- capture --target "https://app.example.com/checkout" --viewports 1440,375
```

Outputs per viewport:

- `live-tree-<page>@<width>.json` — the normalized live tree (same schema as the design tree)
- `page-<page>@<width>.png` — full-page screenshot (Phase 4 crops evidence regions from it)

### Compare the two (Phases 3–4)

```bash
# Spec diff only (Layer A)
npm run dev -- compare --design design-qa-output/design-tree-12-345.json \
                       --live design-qa-output/live-tree-app-example-com-checkout@1440.json

# + region pixel diff and evidence images (Layer B)
npm run dev -- compare --design … --live … \
                       --frame-png design-qa-output/frame-12-345@1x.png \
                       --page-png design-qa-output/page-app-example-com-checkout@1440.png
```

Prints a severity-graded issue list and writes `report.json` + a self-contained `report.html`:

```
✔ Report ready: design-qa-output\report.html
  40 pointers checked · 28 passed · 8 failed · 4 deferred
  Critical 1 · High 3 · Medium 4 · Low 0 · Info 0
  🔴 [existence] Trust badges — expected INSTANCE "Trust badges" present, got no matching element in the DOM
  🟠 [color.background] Button / Sign up — expected #1D5CCF, got #2D6CDF
  🟡 [visual] Label — expected ≤ 20% differing pixels, got 28.7% differ
```

### Or all of it in one command (the §14 contract)

```bash
npm run dev -- run --figma "https://figma.com/design/AbC123/Checkout?node-id=12-345" \
                   --target "http://localhost:3000/checkout"
```

`run` captures at the design frame's own width by default (override with `--viewport`), so positions compare 1:1 against the frame the designer actually drew (spec §11).

## Module map (why each exists)

| Module | Why |
|---|---|
| `src/types.ts` | The **normalized schema** — the contract between every phase. Figma (Phase 1) and the live DOM (Phase 2) both normalize into it, so the matcher/comparator never know the source. |
| `src/config.ts` | Loads `design-qa.config.json` (spec §9) with defaults + loud validation. Optional — the two-URL contract means flags alone are enough. |
| `src/figma/url.ts` | Pasted Figma URLs come in several shapes (`/design/`, `/file/`, branches) and encode node ids as `12-345`; the API wants `12:345`. |
| `src/figma/api.ts` | Thin REST client (`/v1/files/:key/nodes`, `/v1/images/:key`). Fetch is injectable so it's testable offline. |
| `src/figma/normalizer.ts` | Raw Figma JSON → normalized tree. Colors (0..1 floats → hex), auto-layout (→ flex-like values), defaults (`visible`, `opacity`). All source quirks are absorbed **here and nowhere else**. |
| `src/figma/extractor.ts` | Orchestrates fetch → normalize → write artifacts. Pure plumbing, kept separate so the pieces stay independently testable. |
| `src/web/snapshot.ts` | The in-page collector, serialized into the browser by Playwright — so it must be self-contained. Returns a raw JSON DOM snapshot (tag, attrs, computed styles, bbox, text); no shaping happens in the page, keeping the interesting logic testable without a browser. |
| `src/web/normalizer.ts` | Raw DOM snapshot → normalized tree, mirror of the Figma normalizer. CSS colors → hex, flexbox → auto-layout, font-weight keywords → numbers. Direct text becomes a **synthetic TEXT child** (fills = text color) so DOM trees have the same shape as Figma trees (Button → TEXT). |
| `src/web/capturer.ts` | Playwright plumbing: viewport → goto → wait for network idle **and** `document.fonts.ready` (late font swaps would corrupt typography) → snapshot + full-page screenshot. |
| `src/compare/color.ts` | Perceptual color difference: sRGB → Lab → **CIEDE2000**, not hex equality (spec §15). Tests pin the published Sharma et al. reference values. |
| `src/compare/matcher.ts` | The hard part (spec §6.3): aligns Figma nodes ↔ DOM elements in four passes — `data-figma-id` attribute (exact), text content, **anchor propagation** (a matched text pulls its parents together), geometry. Every pair logs its method + confidence. Hidden DOM elements can only be claimed by explicit signals, never by geometry. |
| `src/compare/pointers.ts` | Builds + evaluates the checkpoints per matched pair (spec §6.4): existence, position, size, color (ΔE), typography, spacing, text. `asset`/`visual` are emitted as *skipped* so the pointer count stays honest about what wasn't checked yet. |
| `src/compare/engine.ts` | Layer A orchestration (spec §6.5): match → evaluate → grade severities (§7) → canonical `report.json` (§8). Positions compare frame-relative design coords against page coords — the frame's top-left ↔ the page's (0,0). |
| `src/compare/vision.ts` | Layer C (spec §6.5-C): per-issue verdicts from Claude — real/noise/uncertain + severity + explanation + confidence. Structured outputs (JSON schema) so verdicts parse guaranteed-valid, adaptive thinking, streaming, and a prompt-cached static rubric. The client is injectable, so tests run offline. |
| `src/report/images.ts` | PNG crop / nearest-neighbor resize / `pixelmatch` region diff, pure buffers so it's testable with synthetic images. Nearest-neighbor on purpose: smoother resampling blurs away genuine 1px differences. |
| `src/report/evidence.ts` | Layer B (spec §6.5-B): evaluates the deferred `visual` pointers (design crop ↔ live crop → mismatch %), attaches design/live/diff evidence to every issue — missing elements get the live crop *at the expected location* — then recounts the summary. |
| `src/report/html.ts` | The reporter (spec §6.6): `ComparisonReport` → one self-contained HTML file, evidence inlined as data URIs, issues grouped by element and ordered by worst severity. Pure render, no I/O. |
| `src/report/write.ts` | Writes the two §8 artifacts: `report.json` (canonical, relative evidence paths) and `report.html` (inlined). |
| `src/report/pdf.ts` | `report.html` → `report.pdf` via Chromium's print engine (`printBackground: true` — severity badges and chips are CSS backgrounds and would otherwise vanish). |
| `src/cli.ts` | `extract` (Phase 1), `capture` (Phase 2), `compare` (Phases 3–4), and `run` — the full two-URL pipeline (§14). |

## Tests

```bash
npm test
```

Tests cover both normalizers (against realistic raw-Figma and raw-DOM fixtures), CIEDE2000 (reference dataset values), the matcher (each pass + bucket rules), the comparison engine (a seeded-regression end-to-end), the config loader, and URL parsing — no network and no browser needed.

## Roadmap (spec §10)

1. ✅ **Phase 1** — Figma extraction (REST) → normalized tree + PNG
2. ✅ **Phase 2** — Web capture (Playwright) → comparable live tree + screenshots
3. ✅ **Phase 3** — Element matching + deterministic spec diff (Layer A) → severity-graded `report.json`
4. ✅ **Phase 4** — Pixel diff (Layer B) + evidence images + self-contained `report.html` + `design-qa run`
5. ✅ **Phase 5** — Vision adjudication with Claude (Layer C): noise filtering, severity re-grades, human explanations
6. ⬜ **Phase 6** — CI gating, Dev Mode MCP source, multi-viewport
