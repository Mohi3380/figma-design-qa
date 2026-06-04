# Design QA Agent — Figma vs. Live Web App Verification

**Purpose of this document:** A build-ready specification you can hand to Claude Code. It defines an AI agent that takes a Figma design and a running website/web app, compares them on a set of defined checkpoints ("pointers"), flags every mismatch as an issue, and produces a report. It also lists the best off-the-shelf options so you can decide build-vs-buy before writing code.

---

## 1. What we're building (in one paragraph)

An agent that, given (a) a Figma file/frame URL and (b) a live page URL (or local dev URL), extracts the *intended* design from Figma and the *actual* rendered UI from the browser, aligns matching elements, compares them on a list of checkpoints, and emits a structured report listing every checkpoint that failed, with severity, location, expected vs. actual values, and a visual diff. The unit of comparison is a **pointer**.

---

## 2. Glossary — what a "pointer" is

A **pointer** is a single, verifiable comparison checkpoint tied to one design element. Each pointer is one assertion. Examples:

- *Element exists* — the "Sign up" button present in Figma also exists in the DOM.
- *Position* — element's top/left within ±N px of the design.
- *Size* — width/height within tolerance.
- *Color* — background/text/border color matches the design token.
- *Typography* — font family, size, weight, line-height, letter-spacing.
- *Spacing* — padding/margin/gap matches auto-layout values.
- *Text content* — visible copy matches (or is intentionally dynamic).
- *Asset* — icon/image matches the exported asset.
- *State* — hover/focus/disabled variants match component variants.
- *Visual* — the rendered region looks like the design region (semantic image diff).

A pointer that fails becomes an **issue**. The agent's job is: build the pointer list from Figma, evaluate each against the live site, report failures.

---

## 3. Comparison strategy — the three approaches

There are three ways to compare, and the right design uses **all three layered together** rather than picking one. This is the single most important design decision, so it's spelled out.

**A. Spec/token comparison (structured, most reliable).** Pull structured data from Figma (node tree, sizes, positions, colors, typography, auto-layout spacing, component variants) and compare it against the live DOM's *computed styles* and bounding boxes. This is deterministic, explainable, and gives exact "expected 16px, got 14px" issues. It is the backbone.

**B. Pixel/region diff (catches what specs miss).** Render the Figma frame to an image, screenshot the matching live region at the same viewport, align them, and diff. Catches rendering bugs, z-index/overlap problems, clipped text, and missing assets that the spec layer can't see. Brittle on its own (anti-aliasing, fonts, dynamic content), so it's gated by tolerances and used as a secondary signal.

**C. Vision-LLM semantic comparison (the "AI agent" layer).** Give a vision model both images (design region + live region) plus the spec deltas, and ask it to judge whether differences are *meaningful* (real regression) or *cosmetic noise* (anti-aliasing, acceptable dynamic content). This is what turns a noisy pixel diff into a usable, prioritized report and is where Claude's vision is used. It explains issues in human terms and assigns severity.

> Rule of thumb: **A decides the facts, B finds the surprises, C decides what matters.**

---

## 4. Recommended architecture

```
                 ┌─────────────────────┐
                 │   Figma Source       │
                 │ (Dev Mode MCP / REST)│
                 └──────────┬───────────┘
                            │  node tree, tokens, frame PNG
                            ▼
┌──────────────┐   ┌─────────────────────┐   ┌──────────────┐
│ Live Web App │──▶│  Capture (Playwright)│   │ Pointer       │
│ (URL/dev)    │   │ DOM + computed styles│──▶│ Builder &     │
└──────────────┘   │ + screenshots        │   │ Element Match │
                   └─────────────────────┘   └──────┬───────┘
                                                     │ aligned pairs
                                                     ▼
                              ┌───────────────────────────────────┐
                              │ Comparison Engine                  │
                              │  A. spec/token diff                │
                              │  B. pixel/region diff              │
                              │  C. vision-LLM adjudication (Claude)│
                              └──────────────────┬────────────────┘
                                                 │ issues[]
                                                 ▼
                              ┌───────────────────────────────────┐
                              │ Report Generator (JSON + HTML/MD)  │
                              │ severity, expected/actual, diffs   │
                              └───────────────────────────────────┘
```

---

## 5. Recommended tech stack

- **Language/runtime:** Node.js + TypeScript (best Playwright + Figma ecosystem support). Python is viable but the browser tooling is weaker.
- **Figma extraction:** Figma **Dev Mode MCP server** (local, runs on `localhost:3845`, exposes node tree, design tokens, layout constraints, variant info — and integrates natively with Claude Code) as the primary path; **Figma REST API** (`GET /v1/files/:key/nodes`, `GET /v1/images/:key`) as a fallback/CI path that needs no desktop app.
- **Live capture:** **Playwright** — multi-browser, screenshots, `getComputedStyle`, bounding boxes, accessibility tree, multiple viewports.
- **Pixel diff:** `pixelmatch` + `pngjs`, or Playwright's built-in `toHaveScreenshot`.
- **Vision adjudication:** Claude (vision) via the Anthropic API, fed both images + the structured deltas.
- **Report:** JSON as the canonical output, plus a self-contained HTML report (and optional Markdown) generated from the JSON.
- **Orchestration:** a CLI (`design-qa run --figma <url> --target <url>`) so it runs locally and in CI.

---

## 6. Component breakdown (what Claude Code should build)

Build these as separate modules so they're testable in isolation.

**6.1 `figma-extractor`** — Input: Figma file key + node id (frame). Output: a normalized design tree where every node has: id, name, type, absolute bounding box, fills/colors (resolved to hex/rgba), typography, auto-layout spacing, opacity, visibility, and (if a component) variant/state. Also exports a PNG of the frame at 1x and 2x. Prefer the Dev Mode MCP for richer token data; fall back to REST. Normalize both into the *same* internal schema so the rest of the pipeline doesn't care which source was used.

**6.2 `web-capturer`** — Input: target URL + viewport list (e.g., 1440, 768, 375). Launches Playwright, waits for network idle + fonts loaded, then for each element of interest captures: bounding box (relative to page), `getComputedStyle` (color, background, font-*, padding, margin, border, etc.), text content, tag/role, and a clipped screenshot. Output: a live element tree in the same normalized schema as 6.1.

**6.3 `matcher`** — Aligns Figma nodes to live elements into pairs. Matching signals, in priority order: explicit mapping (a `data-figma-id` attribute if devs add one — best case), then text content, then role/type + relative position + size similarity. Produce three buckets: **matched pairs**, **in-design-not-in-DOM** (likely "missing element" issues), **in-DOM-not-in-design** (informational, possibly extra/unspecified). This is the hardest module — keep the heuristics swappable and log match confidence.

**6.4 `pointer-builder`** — For each matched pair, generate the list of pointers to evaluate (existence, position, size, color, typography, spacing, text, asset, visual). Tolerances are configurable per pointer type (e.g., position ±4px, color ΔE < 3, font-size exact). Output: a flat list of pointer evaluations with expected/actual/tolerance/result.

**6.5 `comparison-engine`** — Runs the three layers from §3. Layer A computes deterministic pass/fail per pointer. Layer B does the region pixel diff for visual pointers. Layer C sends failing/ambiguous pointers (with the two cropped images + the deltas) to Claude to (i) confirm it's a real issue vs. noise, (ii) assign severity, (iii) write a one-line human explanation. Output: finalized `issues[]`.

**6.6 `reporter`** — Turns `issues[]` into the canonical JSON and a rendered HTML report (and Markdown). Groups issues by element and by severity, embeds before/after/diff thumbnails, and prints a summary (X pointers checked, Y passed, Z issues by severity).

---

## 7. Issue model & severity rules

Each issue object:

```json
{
  "id": "btn-signup-color",
  "elementName": "Button / Sign up",
  "pointer": "color.background",
  "severity": "high",
  "expected": "#2D6CDF",
  "actual": "#3A78E0",
  "tolerance": "ΔE < 3 (actual ΔE 6.1)",
  "viewport": 1440,
  "figmaNodeId": "12:345",
  "selector": "button.signup",
  "evidence": { "design": "...png", "live": "...png", "diff": "...png" },
  "explanation": "Button background is noticeably lighter than the design token.",
  "confidence": 0.93
}
```

Suggested default severity mapping (make it configurable):

- **Critical** — element missing entirely, or wrong text on a key CTA, or completely wrong layout.
- **High** — wrong color token, wrong font family/size on headings, position off by a large margin (> 16px), overlapping/clipped content.
- **Medium** — spacing/padding off beyond tolerance, minor font-weight/line-height mismatch, position off 4–16px.
- **Low** — sub-pixel/anti-aliasing differences, acceptable dynamic-content variance, near-tolerance values.
- **Info** — element present in DOM but not in design (not necessarily wrong).

Let the vision layer down-rank issues it judges as cosmetic noise, and surface its reasoning so a human can override.

---

## 8. Report output

Two artifacts:

1. **`report.json`** — canonical, machine-readable, the source of truth (good for CI gating: fail the build if any Critical/High issues).
2. **`report.html`** — human-facing: summary header (pointers checked / passed / failed by severity), then issues grouped by element, each showing design vs. live vs. diff images, expected/actual values, and the explanation. Self-contained (inline images) so it can be emailed or attached to a PR.

CI behavior: exit non-zero when issues at or above a configurable threshold exist, so it can block merges.

---

## 9. Configuration (single `design-qa.config.json`)

```json
{
  "figma": { "fileKey": "...", "frames": ["12:345"], "source": "mcp" },
  "target": { "baseUrl": "http://localhost:3000", "routes": ["/signup"] },
  "viewports": [1440, 768, 375],
  "tolerances": {
    "positionPx": 4,
    "sizePx": 2,
    "colorDeltaE": 3,
    "fontSizeExact": true
  },
  "pointers": ["existence","position","size","color","typography","spacing","text","asset","visual"],
  "matching": { "preferAttribute": "data-figma-id" },
  "severityGate": "high",
  "vision": { "enabled": true, "model": "claude (vision)" }
}
```

---

## 10. Implementation phases (milestones for Claude Code)

1. **Phase 1 — Skeleton + Figma extraction.** CLI scaffold, `figma-extractor` via REST first (no desktop dependency), normalized schema, dump JSON. *Done when:* a Figma frame produces a normalized tree + frame PNG.
2. **Phase 2 — Web capture.** `web-capturer` with Playwright, normalized live tree + screenshots. *Done when:* a live URL produces a comparable tree.
3. **Phase 3 — Matching + spec diff (Layer A).** `matcher` + `pointer-builder` + deterministic comparison. *Done when:* it emits real color/size/position/typography issues with expected vs. actual.
4. **Phase 4 — Pixel diff (Layer B) + HTML report.** Region diffs, evidence images, `reporter`. *Done when:* there's a shareable HTML report.
5. **Phase 5 — Vision adjudication (Layer C).** Claude judges noise vs. real, assigns severity + explanations, confidence scores. *Done when:* false positives drop and severities feel right.
6. **Phase 6 — CI + Dev Mode MCP path + multi-viewport.** Severity gating, switch Figma source to Dev Mode MCP for richer tokens, responsive checks. *Done when:* it runs in CI and gates merges.

Ship Phase 1–4 first; that alone is a working tool. Phases 5–6 are the polish that makes it trustworthy.

---

## 11. Key risks & how to handle them

- **Matching is the hard part.** The cleanest solution is social, not technical: ask developers to tag implemented elements with `data-figma-id="<node id>"`. With that attribute, matching becomes exact and most flakiness disappears. Without it, lean on text + role + geometry and always log match confidence.
- **Fonts/anti-aliasing cause false pixel diffs.** Load the same web fonts, pin the browser, and let Layer C filter cosmetic noise.
- **Dynamic content** (dates, user names, counts) will never match design placeholder text — support a "dynamic region" mask/ignore list.
- **Responsive gaps:** Figma rarely has a frame for every viewport. Only run a viewport's checks if a corresponding design frame exists.
- **Coordinate systems differ** between Figma (absolute canvas) and browser (page/scroll). Normalize both to the frame/component origin before comparing positions.

---

## 12. Best options — build vs. buy

You don't have to build all of this. Here's the honest landscape so you can choose. The "design file as source of truth, compared against the live app" capability specifically is the thing to look for.

| Option | What it is | Figma-vs-live support | Best for | Trade-off |
|---|---|---|---|---|
| **Build custom (this spec)** | Your own agent: Playwright + Figma API/MCP + Claude vision | Full control; exactly your pointers | Teams wanting full control, custom rules, no per-snapshot fees | You maintain it; matching is real work |
| **Applitools Eyes** | Mature "Visual AI" engine (computer-vision diff, not pure pixels); shipped a **Figma plugin in Eyes 10.22, Jan 2026** that exports frames/pages/prototypes as baselines | Strong, native via plugin | Design-system orgs, regulated/enterprise | Enterprise pricing, no public tiers |
| **SmartUI (LambdaTest/TestMu)** | AI visual testing with a native Figma integration that compares design files directly against live web/app screens and groups deviations by severity | Strong, native | Teams wanting design-drift detection across many browsers/devices | Cloud-based, usage pricing |
| **Sauce Visual (Sauce Labs)** | Visual regression with a Figma plugin that sets design files as the source of truth vs. live code | Yes, via Figma plugin | Teams already on Sauce Labs infra | Platform lock-in |
| **Percy (BrowserStack)** | AI-assisted visual regression; broad framework coverage; generous free tier (~5,000 snapshots/mo) | Primarily code-baseline regression; weaker on design-as-source | BrowserStack-based mid-market teams | Less a "match Figma" tool, more "catch regressions" |
| **Chromatic** | Component-level visual testing built on Storybook | Component baselines, not Figma frames directly | Storybook-centric teams | Needs Storybook; not page-level design match |
| **BackstopJS / Playwright built-in** | Free, open-source pixel-diff | None out of the box (you'd add Figma yourself) | Cheapest regression baseline | No design-source comparison, no AI noise filtering |

**My recommendation:**

- If you want the **fastest path with the least maintenance** and have budget: trial **Applitools Eyes** or **SmartUI** — both ship the exact "Figma frame vs. live app, severity-grouped" feature you described, and Applitools' Jan 2026 Figma plugin is the most direct match.
- If you want **full control, custom pointers, and to lean on Claude/Claude Code** (which is where this whole request points): **build the agent in this spec**. Use the commercial tools as a benchmark for what "good" output looks like.
- A sensible hybrid: **build it**, but start with Layers A+B only, and use a free tool (Playwright built-in) for the raw pixel diff under the hood, adding the Claude vision layer for adjudication.

---

## 13. First message to give Claude Code

> Build Phase 1 of the spec in `figma-design-qa-agent-spec.md`: a TypeScript CLI named `design-qa`. Implement `figma-extractor` using the Figma REST API (`GET /v1/files/:key/nodes` and `GET /v1/images/:key`), reading `FIGMA_TOKEN` from env. Output a normalized design tree (id, name, type, absolute bbox, resolved colors, typography, auto-layout spacing, visibility) as JSON plus a frame PNG. Add a `design-qa.config.json` loader matching §9. Include unit tests for the normalizer. Stop after Phase 1 so I can review.

Then proceed phase by phase. Have Claude Code keep each module independently testable, and keep the normalized schema (§6.1/6.2) stable — it's the contract the whole pipeline depends on.

---

## 14. The outcome — the "two URLs in, report out" product

**Design constraint:** the finished agent takes exactly two inputs and nothing else — a Figma design URL and a production site URL — and produces a report. No per-element config, no manual mapping. Everything in between is automated.

What that looks like in practice:

```bash
$ design-qa --figma "https://figma.com/design/AbC123/Checkout?node-id=12-345" \
            --site  "https://app.example.com/checkout"

▸ Reading Figma file… found 3 frames (Checkout / Desktop, Tablet, Mobile)
▸ Capturing live site at 1440 / 768 / 375…
▸ Auto-matching design frames → live routes…
▸ Matching elements (47 design nodes ↔ 44 DOM elements)…
▸ Evaluating 312 pointers across 3 viewports…
▸ Adjudicating 18 candidate issues with vision model…

✔ Report ready: ./design-qa-report/report.html
  312 pointers checked · 289 passed · 23 issues
  Critical 2 · High 7 · Medium 9 · Low 5
```

And the **result** is two artifacts:

1. **`report.html`** — a human-readable page: a summary bar (pointers checked / passed / failed by severity), then each issue with the design crop, the live crop, the diff, expected-vs-actual values, and a one-line explanation. This is the thing you actually look at.
2. **`report.json`** — the same data, machine-readable, so it can gate CI (fail the build if Critical/High issues exist) or feed a dashboard.

A sample issue as it appears in the report:

> **🔴 Critical — "Place order" button is missing**
> Present in the Figma frame (node 12:781) but no matching element found in the DOM at `/checkout`. Confidence 0.91.
>
> **🟠 High — Heading color drift**
> `h1.checkout-title` — expected `#1A1A2E`, got `#3A3A4E` (ΔE 7.4, tolerance < 3). Design token `text/primary` not applied.

**What the two-URL constraint costs you (be honest with yourself here):** with no developer cooperation (no `data-figma-id` tags) and no config, the agent has to *guess* which design frame maps to the page and which design node maps to which DOM element. That guessing leans heavily on the vision-LLM layer (§3-C) and on text/role/geometry heuristics (§6.3). So expect:
- Very reliable on **color, typography, spacing, missing elements, and obvious layout breaks**.
- Less reliable on **exact pixel position** of deeply nested or dynamically laid-out elements, and on pages with lots of dynamic content.
- The single biggest accuracy upgrade available — if you ever control the front-end code — is adding `data-figma-id` attributes. The agent should *use* them when present and *fall back* to heuristics when not. Build it that way from the start.

**Definition of done for the whole agent:** point it at any Figma frame URL and any reachable site URL, run one command, get a report you'd trust enough to attach to a pull request — with no other setup.

---

## 15. Market examples & best-practice standards

This exact workflow — *design file as the source of truth, compared against the live build, deviations grouped by severity* — is an established category. Studying how the market does it gives you the standard to aim for while you build your own for learning.

- **Applitools Eyes** — the most mature "Visual AI" approach: it compares what regions *mean* rather than raw pixels, which is exactly the §3-C philosophy. In Jan 2026 (Eyes 10.22) it shipped a Figma plugin that exports frames, full pages, or whole prototypes straight in as baselines to compare against the live app. *Best practice to copy:* match levels (Strict / Layout / Content / Exact) instead of one global tolerance — different pointers need different strictness.
- **SmartUI (LambdaTest / TestMu)** — native Figma integration that compares design files directly against live web pages and groups deviations by severity, with AI filtering of anti-aliasing/font-rendering noise. *Best practice to copy:* aggressive noise filtering so the report only contains issues a human would agree are real.
- **Sauce Visual (Sauce Labs)** — a Figma plugin that explicitly sets the design file as the source of truth and checks the build adheres to designer intent rather than just matching a previous code snapshot. *Best practice to copy:* "source of truth" framing — you're checking against the *design*, not against a prior screenshot.
- **Percy (BrowserStack) / Chromatic / BackstopJS** — these are mostly *regression* tools (catch changes vs. a previous baseline), not *design-conformance* tools. Worth knowing the distinction: regression = "did it change since last time," conformance (your agent) = "does it match the design." *Best practice to copy from Percy:* clean CI integration — one command, exit non-zero on real issues, generous use of a review UI.

**Standards your agent should follow (industry norms):**
- Use a **perceptual color metric (ΔE / CIEDE2000)**, not raw hex equality — that's how the field judges "same color."
- Diff **what differences mean**, not just pixels — a 2px shift may or may not be a regression depending on context.
- **Group by severity** and let the report be CI-gateable.
- Treat the **design as the baseline / source of truth**, and support **masking dynamic regions** (dates, names, counts) so they don't flag as false positives.

**Where this fits as a market application:** automated design-QA / "pixel-perfect" verification in the front-end delivery pipeline — run on every PR to confirm the implemented UI matches the approved design before it ships. The buyers are design-system teams and front-end orgs who currently do this review by hand.

---

## 16. Building this on Claude Code (for learning)

Since the goal is learning, structure the build so each step teaches one thing, and let Claude Code explain as it goes:

1. **Start tiny and visible.** Phase 1 (Figma extraction → JSON) and Phase 2 (Playwright capture → JSON) each produce a file you can open and read. Seeing the two normalized trees side by side teaches you the whole problem before any comparison logic exists.
2. **Make Claude Code narrate.** Ask it to add a short README per module explaining *why*, and to write the unit tests first — you'll learn the matching/diff logic faster from the tests than the code.
3. **Use the Figma Dev Mode MCP server with Claude Code.** It runs locally (Claude Code is a supported client) and feeds structured design context — node tree, tokens, layout — directly to the agent, so you also learn how MCP wires an external tool into an agent. Keep the REST API path too, for the no-desktop/CI case.
4. **Build the layers in order (A → B → C).** Get deterministic spec diff working and *trustworthy* before adding pixel diff, and pixel diff before the vision layer. You'll viscerally feel why each layer exists: A is exact but blind to rendering bugs; B is noisy; C cleans up the noise.
5. **Keep it to the two-URL contract.** Resist adding config knobs while learning — every time you're tempted, that's a lesson about what the agent has to infer automatically (frame↔route and node↔element matching). That inference *is* the interesting part.

Suggested learning order of "aha" moments: normalized schema → element matching → ΔE color comparison → region alignment for pixel diff → prompting a vision model to adjudicate noise vs. real. Each is a self-contained thing worth understanding.
