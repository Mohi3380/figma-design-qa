# KODERLABS Design QA

Compare a **Figma design** against a **live web app** and get a severity‑graded report of every visual mismatch — color, typography, spacing, icons, text and layout — with side‑by‑side evidence, optional **Claude vision** adjudication, and a PDF.

This repo is a small monorepo with three parts:

| Folder | What it is | Tech | Dev port |
|--------|-----------|------|----------|
| `src/` | The **QA engine** (Figma fetch → live capture → compare → report/PDF) + a CLI | TypeScript (ESM), Playwright, Anthropic SDK | — |
| `server/` | The **backend API**: auth, QA jobs, reports, per‑user Figma | NestJS, Prisma, JWT | `4300` |
| `web/` | The **frontend**: public marketing site + private app (Start QA, dashboard) | Next.js (App Router), React | `4200` |

**How they connect:** the frontend (`web`, :4200) calls the backend (`server`, :4300) for auth + QA. The backend imports the `src/` engine (built to `dist/`) to run a QA and streams progress over SSE. The engine talks to Figma and renders the live page with Playwright.

---

## Prerequisites

- **Node.js 20+** and npm
- A few hundred MB for the Playwright Chromium download
- (Optional) `ANTHROPIC_API_KEY` for vision adjudication; Google/Figma OAuth keys for social login + per‑user Figma

No Docker or database server required — local dev uses **SQLite** (a single file).

---

## Quick start

Run these once, in three terminals (or sequentially).

### 1. The QA engine (`src/`)
```bash
npm install
npx playwright install chromium   # browser used to capture the live page
npm run build                     # compile the engine to dist/ (the backend imports this)
```
> Re‑run `npm run build` whenever you change anything under `src/`.

### 2. The backend API (`server/`)
```bash
cd server
npm install
cp .env.example .env              # then fill in secrets (see below)
npx prisma migrate dev            # creates the SQLite DB, tables, and seeds a demo user
npm run start:dev                 # http://localhost:4300/api  (watch mode)
```

### 3. The frontend (`web/`)
```bash
cd web
npm install
cp .env.local.example .env.local  # NEXT_PUBLIC_API_URL points at the backend
npm run dev                       # http://localhost:4200
```

Open **http://localhost:4200**. **Demo account** (seeded): `demo@koderlabs.local` / `demo1234`

---

## Environment variables

Each app has its own env file; full lists live in `server/.env.example` and `web/.env.local.example`. The important ones:

**`server/.env`**
- `DATABASE_URL` — defaults to `file:./dev.db` (SQLite). For Postgres, set `provider = "postgresql"` in `server/prisma/schema.prisma` and use a Postgres URL (e.g. a free Neon DB).
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_ENC_SECRET` — long random strings.
- `CORS_ORIGINS` — `http://localhost:4200`.
- `ANTHROPIC_API_KEY` — enables vision adjudication (optional).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — "Continue with Google" (optional).
- `FIGMA_OAUTH_CLIENT_ID` / `FIGMA_OAUTH_CLIENT_SECRET` — per‑user "Connect Figma" (optional).
- `FIGMA_TOKEN` — optional server‑wide Figma personal token fallback (needs `file_content:read`).
- `SMTP_*`, `MAIL_FROM`, `APP_BASE_URL` — see the example file.

**`web/.env.local`**
- `NEXT_PUBLIC_API_URL` = `http://localhost:4300/api`
- `NEXT_PUBLIC_SITE_URL` = `http://localhost:4200`

> **Never commit `.env` / `.env.local`** — they are git‑ignored.

---

## Enabling the optional integrations

Everything works without these; the relevant buttons show a "not configured" state until the keys are set.

- **Google login** — Google Cloud Console → OAuth client (Web). Redirect URI `http://localhost:4300/api/auth/google/callback`. Put id/secret in `server/.env`, restart.
- **Per‑user Figma connect** — https://www.figma.com/developers/apps. Callback `http://localhost:4300/api/figma/callback`, scope **File content (read‑only)**. Put id/secret in `server/.env`, restart. Logged‑in users click **Connect Figma** and runs use their own files.
- **Password‑reset / verification email** — with no SMTP set, links are printed to the backend console (dev). Set `SMTP_HOST/USER/PASS` to send real email.

---

## Ports & health

| Service | URL |
|--------|-----|
| Frontend (Next) | http://localhost:4200 |
| Backend API (NestJS) | http://localhost:4300/api |
| Health check | http://localhost:4300/api/health |

---

## Security

- bcrypt password hashing; access + refresh **JWTs in httpOnly/secure/SameSite cookies** with refresh rotation + DB‑tracked revocation.
- All QA + Figma endpoints require auth (`JwtAuthGuard`); the frontend also guards private routes.
- `helmet`, credentialed CORS locked to the frontend origin, global input validation, rate‑limited auth endpoints.
- Third‑party (Figma) tokens encrypted at rest. `npm audit` is clean in `server/`.

## Production notes (deployment‑agnostic)

- The QA engine needs a **Node runtime** (Playwright + the pipeline) — not edge/serverless. Host the backend on a Node server/VM; the frontend can be hosted anywhere that can reach it.
- Switch SQLite → Postgres (provider + `DATABASE_URL`), set strong secrets, serve over HTTPS (cookies become `Secure`; for cross‑site domains use `SameSite=None`).
- Set `APP_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, and OAuth redirect URIs to the production domain.

---

# Engine internals (`src/`)

The engine can be driven directly via its CLI (independent of the web app):

```bash
npm run build && npm link        # installs the `design-qa` command
design-qa run --figma "<figma frame url>" --target "https://your-app.example.com"
# --no-vision skips Claude adjudication · --no-pdf skips the PDF
```

Pipeline: Extract (Figma) → Capture (Playwright) → spec diff (Layer A) → region pixel diff (Layer B) → vision adjudication with Claude (Layer C) → `report.pdf` + self‑contained `report.html` + canonical `report.json`. Layer C judges real regression vs cosmetic noise, re‑grades severity, and writes one‑line explanations; without `ANTHROPIC_API_KEY` the deterministic layers still run.

### Module map

| Module | Why |
|---|---|
| `src/types.ts` | The **normalized schema** — the contract between phases. Figma and the live DOM both normalize into it. |
| `src/config.ts` | Loads `design-qa.config.json` with defaults + validation. |
| `src/figma/url.ts` | Parses the several Figma URL shapes; node ids `12-345` → `12:345`. |
| `src/figma/api.ts` | Thin REST client (`/v1/files/:key/nodes`, `/v1/images`). Supports PAT (`X-Figma-Token`) and OAuth (`Bearer`). |
| `src/figma/normalizer.ts` | Raw Figma JSON → normalized tree (colors, auto‑layout, defaults). |
| `src/figma/mcp.ts` | Dev Mode / MCP `get_metadata` source — no token, geometry only. |
| `src/figma/extractor.ts` | Orchestrates fetch → normalize → write artifacts. |
| `src/web/snapshot.ts` | In‑page DOM collector serialized into the browser by Playwright. |
| `src/web/normalizer.ts` | Raw DOM snapshot → normalized tree (mirror of the Figma normalizer). |
| `src/web/capturer.ts` | Playwright: viewport → goto → wait for network idle + fonts → snapshot + screenshot. |
| `src/compare/color.ts` | Perceptual color diff: sRGB → Lab → CIEDE2000. |
| `src/compare/matcher.ts` | Aligns Figma nodes ↔ DOM elements (attribute, text, anchor, geometry). |
| `src/compare/pointers.ts` | Builds/evaluates checkpoints per matched pair. |
| `src/compare/engine.ts` | Layer A orchestration → canonical `report.json`. |
| `src/compare/vision.ts` | Layer C: per‑issue Claude verdicts (real/noise/uncertain + severity). |
| `src/report/images.ts` | PNG crop / resize / `pixelmatch` region diff. |
| `src/report/evidence.ts` | Layer B: visual pointers + design/live/diff evidence. |
| `src/report/html.ts` | `ComparisonReport` → self‑contained HTML (evidence inlined). |
| `src/report/write.ts` | Writes `report.json` + `report.html`. |
| `src/report/pdf.ts` | `report.html` → `report.pdf` via Chromium print. |
| `src/pipeline.ts` | The full two‑URL pipeline as one reusable function (used by the CLI **and** the backend). |
| `src/web-ui/server.ts` | The original dependency‑free local web UI (superseded by `web/` + `server/`). |
| `src/cli.ts` | `extract` · `capture` · `compare` · `run` · `serve`. |

### Tests
```bash
npm test
```
Covers both normalizers, CIEDE2000 reference values, the matcher passes, a seeded‑regression end‑to‑end, the config loader, and URL parsing — no network or browser needed.
