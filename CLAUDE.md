# Lead Management System (NBFC) — Project Instructions

Project-level guidance, complementing the global guidelines in `~/.claude/CLAUDE.md` (pipeline discipline, security/data-integrity/code-quality non-negotiables). This file adds the project's concrete structural references.

## Pipeline state
See `manifest.json`. Current: Stage 3 (Architecture) done; Gates A & B signed off. Do not start a stage whose prior gate is not signed off.

## Stack (fixed — see docs/architecture.md §2; do not invent alternatives)
React 18 + TS + Vite + Tailwind + shadcn/ui (PWA) · NestJS modular monolith (Node 20, TS strict) · PostgreSQL 15 (Cloud SQL) via **Kysely** + **Flyway** migrations · Redis · Cloud Tasks + Pub/Sub · GCS · Cloud Run (asia-south1).

## Project Structure
See `docs/architecture.md` §3 for the complete monorepo layout (one Nest module per BRD module M1–M15 under `apps/api/src/modules/`, shared infra under `apps/api/src/core/`, shared TS in `packages/shared/`).

## Key Paths & Names (referenced by every FR LLD)
- **Auth (authn):** `JwtAuthGuard` (global) + `@Public()` — `apps/api/src/core/auth/`
- **Auth (authz/ABAC):** `AbacGuard` + `@Requires(capability, scope)` → `EntitlementService.can()` — `apps/api/src/core/auth/`
- **DB / transactions:** Kysely instance + `UnitOfWork`/`TransactionHost` — `apps/api/src/core/db/`
- **Lead writes:** `LeadService` mutator interface (the ONLY writer of `leads`) — `apps/api/src/modules/capture/` (see architecture §11.2)
- **Stage guards:** `StageGuardService` (§10.3 matrix) — `apps/api/src/modules/capture/`
- **External calls:** `IntegrationGateway` + ports (`LosPort` → `LosMockAdapter`/`LosHttpAdapter`) — `apps/api/src/core/integration/`
- **Audit:** `AuditAppender` + single-writer `AuditChainConsumer` — `apps/api/src/core/audit/`
- **Events:** `OutboxService` + Pub/Sub publisher — `apps/api/src/core/outbox/`
- **SLA:** `BusinessCalendarService` + `SlaEngine` — `apps/api/src/core/sla/`
- **Enums:** `@shared/enums` (generated from BRD §5.5) — never redefine locally
- **Data model:** `docs/data-model/schema.sql` (+ `DATA_MODEL.md`, Flyway migrations)
- **Error codes:** BRD §8.4 → `docs/contracts/error-taxonomy.md` (Stage 5)
- **Approved libraries:** `docs/contracts/dependency-register.md` (Stage 5)
- **Env vars:** `docs/contracts/environment-contract.md` (Stage 5)

## Non-negotiables (recap; full list in global CLAUDE.md §7)
App-level RBAC/ABAC (no Postgres RLS); parameterised queries (Kysely) only; every list query has a LIMIT (≤100); secrets via Secret Manager only; never log PII/tokens; no `any`; no swallowed errors; atomic multi-entity writes via the §11 UnitOfWork; owner-writes (only the owning module's service writes its entity); uniform API envelope `{data, meta, error}` with §8.4 error codes (VALIDATION_ERROR = 400).

## Coding Standards
See `docs/guidelines/` (consumed by `lld-generator` to build, and `full-review` to check):
- `coding.md` — TS/Nest/Kysely patterns, naming, error handling, owner-writes / UnitOfWork / LeadService
- `security.md` — non-negotiable auth/ABAC, masking, PII, SQL injection, rate limits, audit integrity
- `ui.md` — shadcn primitives, masking, states, WCAG 2.1 AA, mobile/PWA, i18n
- `performance.md` — NFR targets (P95 ≤500ms read / ≤800ms write), pagination (25/100), LIMIT, jobs, pooling

## Contracts Package (machine-readable; all agents + reviewers use these — no deviations)
See `docs/contracts/`:
- `api-contract.yaml` — every endpoint shape (FR-tagged) · `auth-matrix.json` — role×capability×scope + public endpoints
- `error-taxonomy.md` — permitted error codes ONLY (§8.4; VALIDATION_ERROR=400) · `state-machines.md` — entity transitions
- `integration-map.md` — external ports + test doubles · `environment-contract.md` — all env vars (no others)
- `shared-utilities.md` — shared services/components (reuse, don't recreate) · `dependency-register.md` — approved libs only
- `nfr-thresholds.md` — concrete NFR numbers · `testing-contract.md` — required tests per FR tier
