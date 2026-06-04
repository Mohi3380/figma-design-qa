# design-qa

An agent that compares a **Figma design** against a **live web app** and reports every mismatch as a severity-graded issue. Built phase by phase from `figma-design-qa-agent-spec.md`.

**Current status: Phase 1** — Figma extraction. A Figma frame URL in, a normalized design tree (JSON) + rendered frame PNGs out.

## Setup

```bash
npm install
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

## Module map (why each exists)

| Module | Why |
|---|---|
| `src/types.ts` | The **normalized schema** — the contract between every phase. Figma (Phase 1) and the live DOM (Phase 2) both normalize into it, so the matcher/comparator never know the source. |
| `src/config.ts` | Loads `design-qa.config.json` (spec §9) with defaults + loud validation. Optional — the two-URL contract means flags alone are enough. |
| `src/figma/url.ts` | Pasted Figma URLs come in several shapes (`/design/`, `/file/`, branches) and encode node ids as `12-345`; the API wants `12:345`. |
| `src/figma/api.ts` | Thin REST client (`/v1/files/:key/nodes`, `/v1/images/:key`). Fetch is injectable so it's testable offline. |
| `src/figma/normalizer.ts` | Raw Figma JSON → normalized tree. Colors (0..1 floats → hex), auto-layout (→ flex-like values), defaults (`visible`, `opacity`). All source quirks are absorbed **here and nowhere else**. |
| `src/figma/extractor.ts` | Orchestrates fetch → normalize → write artifacts. Pure plumbing, kept separate so the pieces stay independently testable. |
| `src/cli.ts` | `design-qa extract …` (Phase 1). `design-qa run` is reserved for the full pipeline. |

## Tests

```bash
npm test
```

Tests cover the normalizer (against a realistic raw-Figma fixture), the config loader, and URL parsing — no network needed.

## Roadmap (spec §10)

1. ✅ **Phase 1** — Figma extraction (REST) → normalized tree + PNG
2. ⬜ **Phase 2** — Web capture (Playwright) → comparable live tree
3. ⬜ **Phase 3** — Element matching + deterministic spec diff (Layer A)
4. ⬜ **Phase 4** — Pixel diff (Layer B) + HTML report
5. ⬜ **Phase 5** — Vision adjudication with Claude (Layer C)
6. ⬜ **Phase 6** — CI gating, Dev Mode MCP source, multi-viewport
