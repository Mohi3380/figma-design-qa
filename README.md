# design-qa

An agent that compares a **Figma design** against a **live web app** and reports every mismatch as a severity-graded issue. Built phase by phase from `figma-design-qa-agent-spec.md`.

**Current status: Phase 2** — both sides of the comparison now exist. A Figma frame URL produces a normalized design tree; a live page URL produces a comparable live tree in the *same schema*, plus screenshots. Phase 3 (matching + spec diff) compares them.

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
| `src/cli.ts` | `design-qa extract …` (Phase 1), `design-qa capture …` (Phase 2). `design-qa run` is reserved for the full pipeline. |

## Tests

```bash
npm test
```

Tests cover both normalizers (against realistic raw-Figma and raw-DOM fixtures), the config loader, and URL parsing — no network and no browser needed.

## Roadmap (spec §10)

1. ✅ **Phase 1** — Figma extraction (REST) → normalized tree + PNG
2. ✅ **Phase 2** — Web capture (Playwright) → comparable live tree + screenshots
3. ⬜ **Phase 3** — Element matching + deterministic spec diff (Layer A)
4. ⬜ **Phase 4** — Pixel diff (Layer B) + HTML report
5. ⬜ **Phase 5** — Vision adjudication with Claude (Layer C)
6. ⬜ **Phase 6** — CI gating, Dev Mode MCP source, multi-viewport
