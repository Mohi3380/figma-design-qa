# Scaling guide — single instance → multi-instance

The app runs as a **single instance with zero extra infrastructure by default**
(in-process job queue, local-disk storage, SQLite). Everything below is opt-in
via environment variables; nothing here changes default behavior.

Going horizontal (more than one API instance behind a load balancer) requires
three things, because each removes a piece of per-instance state:

| Concern | Single instance (default) | Multi-instance | Toggle |
|---|---|---|---|
| Binary artifacts (avatars, reports) | local disk | object storage | `STORAGE_DRIVER=s3` |
| QA run queue + execution | in-process | Redis/BullMQ + worker procs | `REDIS_URL=…` |
| Database | SQLite file | Postgres | `schema.prisma` provider |

> ⚠️ The Redis/worker and S3 paths are implemented and type-checked but were
> **not runtime-verified** in development (no local Redis/S3). Validate them in
> staging with the checklist at the bottom before relying on them in production.

---

## A. Storage (`STORAGE_DRIVER`)

Avatars and QA report html/pdf are written through `StorageService`, so they
don't live on one instance's disk.

```env
STORAGE_DRIVER=s3
S3_BUCKET=my-design-qa-artifacts
S3_REGION=us-east-1
# S3_ENDPOINT=https://…   # for S3-compatible stores (MinIO, Cloudflare R2)
# S3_PREFIX=prod          # optional key namespace
# S3_URL_TTL=300          # presigned download link lifetime (seconds)
# Credentials via the standard AWS chain (env / IAM role / profile):
# AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…
```

Downloads are served as short-lived presigned redirects (not proxied through
the API). Reports created **before** switching to S3 keep their local paths and
still serve from disk; only new runs upload to S3.

`STORAGE_DRIVER=local` (default) keeps everything on disk under
`STORAGE_LOCAL_ROOT` (defaults to `QA_OUTPUT_DIR`).

---

## C. Distributed queue (`REDIS_URL`)

With `REDIS_URL` set, QA runs are enqueued to BullMQ and executed by worker
processes; progress is relayed back to the API instance holding the SSE
connection over Redis pub/sub. Playwright + outbound traffic run in the worker,
off the API process.

```env
REDIS_URL=redis://localhost:6379       # or rediss://… for TLS
QA_MAX_CONCURRENT=2                     # simultaneous runs PER worker
QA_INLINE_WORKER=true                   # run a worker inside the API process
```

**Single box (Redis on the same host):** leave `QA_INLINE_WORKER=true` — the API
process also runs a worker. Done.

**True multi-instance:** set `QA_INLINE_WORKER=false` on the API instances (they
only enqueue + relay), and run dedicated worker processes:

```bash
npm run build
QA_INLINE_WORKER=false npm run start         # API instances (N of them)
npm run start:worker                         # worker processes (M of them)
```

Scale API instances for connections, worker processes for run throughput,
independently. Total run concurrency ≈ `M × QA_MAX_CONCURRENT`.

**Caveat:** the per-user cap (`QA_MAX_CONCURRENT_PER_USER`) is enforced only in
in-process mode. In distributed mode, BullMQ bounds total concurrency per worker
but not per user (OSS BullMQ has no per-group concurrency). If you need a strict
per-user cap across workers, add a Redis-counter gate in `processQueuedJob`.

With `REDIS_URL` unset, none of this loads — the in-process queue is used.

---

## D. Postgres

SQLite is single-writer and can't back multiple instances. Prisma's datasource
`provider` is a static literal (it can't be env-toggled), so this is a
deliberate switch, not a runtime flag. **Do it on a branch and verify against a
real Postgres before deploying** — the committed migrations are SQLite SQL.

1. **Point at Postgres** and switch the provider:
   ```prisma
   // server/prisma/schema.prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
   ```env
   DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
   ```

2. **Regenerate migrations for Postgres.** The existing `prisma/migrations`
   folder is SQLite-specific. Move it aside and create a fresh baseline:
   ```bash
   cd server
   mv prisma/migrations prisma/migrations.sqlite.bak
   npx prisma migrate dev --name init_postgres   # generates Postgres SQL
   npx prisma generate
   ```
   (The schema — including the denormalized `sev*` columns added for the
   dashboards — carries over unchanged; only the generated SQL differs.)

3. **Make the admin search case-insensitive.** SQLite's `LIKE` is
   case-insensitive for ASCII; Postgres' is not. In
   `server/src/admin/admin.service.ts → buildWhere`, add `mode: 'insensitive'`
   to both branches and drop the email `.toLowerCase()` (Prisma rejects `mode`
   on SQLite, which is why it isn't there now):
   ```ts
   { email: { contains: search, mode: 'insensitive' } },
   { name:  { contains: search, mode: 'insensitive' } },
   ```

4. **Point the test suite at Postgres** to verify. The integration tests run
   `prisma migrate deploy` against `DATABASE_URL`; set it to a throwaway
   Postgres DB and `npm test`.

---

## Staging validation checklist (do before production)

- [ ] **S3:** upload an avatar and open a report — both load (presigned
      redirect resolves). Confirm objects land in the bucket under `S3_PREFIX`.
- [ ] **Queue:** with two API instances + one worker, start a run on instance A
      and confirm live SSE progress streams (proves the Redis pub/sub relay).
- [ ] **Worker isolation:** kill/restart an API instance mid-run; the run
      finishes on the worker and the result is retrievable from Run history.
- [ ] **Caps:** start more concurrent runs than `QA_MAX_CONCURRENT`; excess
      queue rather than over-subscribing browsers.
- [ ] **Postgres:** full `npm test` green against Postgres; admin name search
      matches case-insensitively.
