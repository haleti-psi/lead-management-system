# Lead Management System (NBFC)

A Lead Management System for Indian NBFCs — omnichannel lead capture, de-duplication,
allocation & scoring, KYC, LOS hand-off, consent/compliance, and SLA-driven engagement.

> **All product and design decisions live in `docs/`.** This repository is built by a
> structured, pipeline-driven process; the code is generated against frozen specifications
> and contracts. Start at `manifest.json` for pipeline state and `docs/brd.md` for the what/why.

## Tech stack (fixed — see `docs/architecture.md` §2)

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui (PWA) |
| Backend | NestJS modular monolith (Node 20, TS strict) |
| Database | PostgreSQL 15 (Cloud SQL) via **Kysely** (typed SQL, not an ORM) + **Flyway** migrations |
| Cache / queue / events | Redis (Memorystore) · Cloud Tasks · Pub/Sub |
| Storage / hosting | GCS · Cloud Run (`asia-south1`) |
| AuthN / AuthZ | JWT + app-level ABAC (`EntitlementService`); **no Postgres RLS** |

## Repository layout (`docs/architecture.md` §3)

```
Lead_Management_System/
├── apps/
│   ├── api/            # NestJS backend — one module per BRD module (M1–M15) under src/modules/,
│   │   └── src/{modules,core,common}     #   shared infra under src/core/
│   └── web/            # React 18 + Vite PWA — src/{app,components,lib,hooks,...}
├── packages/
│   └── shared/         # cross-cutting TS: enums (BRD §5.5), API envelope types, error codes
├── docs/               # the source of truth — see "Documentation map" below
├── package.json        # npm workspaces root
├── flyway.conf         # Flyway owns the schema (app never auto-migrates)
└── project.config.yaml # deploy-app / local-deployment config (Cloud Run)
```

See `apps/api/README.md`, `apps/web/README.md`, and `packages/shared/README.md` for per-workspace detail.

## Pipeline status

Stages 1–6 complete; **Gates A/B/C signed off** (`manifest.json`). The monorepo is scaffolded;
**Stage 7 (code generation via `phase-executor`) is next** — it builds the foundation wave
(`core/` infra) first, then one coding agent per FR. Until then, `apps/*/src` and `packages/shared/src`
hold only bootstrap stubs.

## Documentation map (read before writing code)

| Need | File |
| --- | --- |
| What & why (requirements) | `docs/brd.md` |
| Data model (tables/columns/enums) | `docs/data-model/schema.sql` (+ `DATA_MODEL.md`) |
| Folder layout, build order, ADRs | `docs/architecture.md` (§3, §12, §13) |
| Coding / security / UI / performance rules | `docs/guidelines/*.md` |
| API shapes · auth · errors · state machines | `docs/contracts/{api-contract.yaml,auth-matrix.json,error-taxonomy.md,state-machines.md}` |
| Approved dependencies (only these) | `docs/contracts/dependency-register.md` |
| Env vars (only these) | `docs/contracts/environment-contract.md` |
| Shared services/components (reuse, don't recreate) | `docs/contracts/shared-utilities.md` |
| Per-FR specs + tests | `docs/lld/FR-NNN.md` (+ `-tests.md`) |
| Binding LLD corrections / open gaps | `docs/lld/CORRECTIONS.md` · `docs/lld/AMBIGUITIES.md` |
| How this repo is built | `CONTRIBUTING.md` |

## Quick start (local development)

```bash
cp .env.example .env.local         # then fill secrets (see docs/contracts/environment-contract.md)
npm install                        # generates package-lock.json
npm run build:shared               # build the shared package first
npm run dev:api                    # NestJS API  → http://localhost:8080  (health: /health)
npm run dev:web                    # Vite web app → http://localhost:5173
```

Database migrations are owned by **Flyway** (`docs/data-model/migrations/`), not the app —
the app never auto-migrates. Regenerate Kysely DB types with `npm run db:codegen`.

## Root scripts

| Script | Does |
| --- | --- |
| `npm run build` | Build `shared` → `api` → `web` (in order) |
| `npm run build:shared` / `:api` / `:web` | Build a single workspace |
| `npm run dev:api` / `dev:web` | Watch-mode dev servers |
| `npm test` | Run api + web test suites |
| `npm run db:codegen` | Generate Kysely types from the DB schema |
| `npm run migrate` | Apply Flyway migrations (`flyway.conf`) |

## License

Proprietary — internal NBFC project. Not for distribution.
