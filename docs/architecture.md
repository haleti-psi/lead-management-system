# Architecture Document
*Project: Lead Management System for NBFCs (India) | Generated: 2026-06-08 | Status: Active | Stage 3*

> **Authority:** This document makes the structural decisions once for all downstream stages. It honours the stack fixed in **BRD §4.1** (Gate A) and the data model in **docs/data-model/** (Gate B). Where the council review (`docs/evaluations/lms-brd-v5-council-report-2026-06-05.md`) flagged architecture gaps, the resolutions are encoded here (see §11–§13). Coding agents must not deviate.

## 1. System Overview

The LMS is the NBFC's front-office origination platform — omnichannel lead capture, duplicate resolution, rules-based allocation, consent management, KYC/document orchestration, partner attribution, task discipline, and clean, idempotent hand-off to a separate LOS. It serves distributed sales (branch/field/DSA/dealer/digital) and compliance-sensitive operations, is **mobile-first (PWA)**, **consent-led**, **India-data-resident**, and explicitly **does not** perform credit decisioning. It is designed to be built by a fleet of parallel coding agents against a shared contract.

## 2. Technology Choices

### Runtime and Framework
- **Frontend:** React 18 + TypeScript 5 (strict), **Vite**, Tailwind CSS, **shadcn/ui** (Radix), TanStack Query (server state), React Hook Form + Zod (forms). Installable **PWA** (service worker for shell + reference data; offline draft capture is Phase 1.5).
- **Backend:** Node.js 20 + TypeScript 5 (strict), **NestJS** as a **modular monolith** (one Nest module per BRD module M1–M15). REST under `/api/v1`.
- **Database:** PostgreSQL 15 (Google Cloud SQL). Schema is the Gate-B `docs/data-model/schema.sql`.
- **Query layer:** **Kysely** (typed SQL query builder) — *not* a heavy ORM. Rationale: the schema is hand-authored SQL with native enums, deferred FKs, partial/GIN indexes, and a hash-chained audit table that ORMs model poorly; Kysely gives full-typed access without owning the schema. **Migrations stay owned by Flyway** (`docs/data-model/migrations/`), so there is no ORM-vs-schema drift. DB types are generated from the schema via `kysely-codegen`.
- **Language discipline:** TypeScript strict, no `any`, no `as any`.

### Deployment Target
- **Hosting:** Google **Cloud Run** (one service for `apps/api`; `apps/web` served as static assets via Cloud Run or Cloud CDN/bucket). Stateless app tier, horizontal autoscale (NFR-05).
- **Region:** **asia-south1 (Mumbai)** — India data residency (NFR-09). *(Assumption — confirm vs Delhi `asia-south2`.)*
- **Container strategy:** multi-stage Dockerfiles — `apps/api/Dockerfile` (build → prune → distroless/node-slim runtime), `apps/web/Dockerfile` (build → nginx/static). Non-root user.
- **CI/CD:** Google **Cloud Build** → Artifact Registry → Cloud Run. (Matches the `deploy-app` skill / `project.config.yaml`.)

### Supporting Infrastructure
| Concern | Choice | Notes |
|---|---|---|
| Cache / rate-limit / idempotency keys | **Redis** (Memorystore) | per §4.1; idempotency cache for FR-140 |
| Durable queue + retries | **Cloud Tasks** | retry/backoff for IntegrationGateway, SLA escalation |
| Event bus (outbox relay) | **Pub/Sub** | transactional-outbox publisher → analytics/AI sink (FR-141) |
| Object storage (documents) | **Google Cloud Storage** | signed-URL access only; virus scan before availability (NFR-18) |
| Secrets | **Secret Manager** | never in env files committed; never logged |
| Scheduler | **Cloud Scheduler** | SLA sweep, retention engine (FR-115), LOS status poll (FR-082) |

### Authentication
- **Provider:** Custom JWT (the BRD auth model is app-level RBAC/ABAC, not a managed provider, not Postgres RLS). Optional enterprise **OIDC SSO**.
- **Session model:** short-lived **JWT access token (15 min)** + **rotating refresh token**. **Tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies — never `localStorage`.**
- **MFA:** TOTP/OTP; mandatory for ADMIN, DPO, HEAD, PARTNER (NFR-07).
- **Auth middleware names (referenced by every FR LLD):**
  - `JwtAuthGuard` — authentication; applied **globally**. Validates the access token, loads the user + ABAC attributes onto the request context, returns `AUTH_REQUIRED` (401) if invalid.
  - `@Public()` — decorator that exempts an endpoint from `JwtAuthGuard` (the only public endpoints are BRD §8.6).
  - `AbacGuard` + `@Requires(capability, scopeResolver)` — authorization; calls `EntitlementService.can(user, action, resource)` (§4.7). Returns `FORBIDDEN` (403) + audit on deny.
  - Customer micro-site (`/c/{token}`) uses an opaque token + OTP step-up via `CustomerLinkGuard` — never a JWT.

### External Services (BRD §8.7) — each behind an abstraction
| Service | Provider (TBD via OD-08/OD-17) | Abstraction (port) |
|---|---|---|
| LOS eligibility / hand-off / status | NBFC's LOS | `LosPort` → `LosHttpAdapter` / `LosMockAdapter` |
| PAN / CKYC / DigiLocker / Aadhaar / V-CIP | KYC vendor(s) | `KycPort` → per-provider adapters |
| SMS / WhatsApp / Email | comms vendor + TRAI-DLT/WABA | `NotificationChannelPort` |
| Account Aggregator / GST / VAHAN | providers (Phase 1.5) | `*Port` adapters |
| Telephony / CTI | CTI vendor (Phase 1.5) | `TelephonyPort` |

All external calls route through the **`IntegrationGateway`** (FR-140): idempotency, retry/backoff (Cloud Tasks), circuit breaker, and an `IntegrationLog` row. No module calls a provider SDK directly.

## 3. Project Structure

npm-workspaces monorepo. Every coding agent uses this layout.

```
Lead_Management_System/
├── CLAUDE.md                     # agent instructions (+ architecture pointer)
├── manifest.json                 # pipeline state
├── package.json                  # workspaces root
├── docs/                         # pipeline artefacts (brd, data-model, contracts, lld, reviews)
├── packages/
│   └── shared/src/               # cross-cutting TS shared by api + web
│       ├── enums/                # generated from §5.5 catalog — single source
│       ├── types/                # DTOs, API envelope types
│       └── errors/               # error-code constants (from §8.4 / error-taxonomy)
├── apps/
│   ├── api/                      # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── modules/          # ONE Nest module per BRD module (§2.7)
│   │   │   │   ├── identity/         # M1  auth, users, roles, branches, teams, break-glass
│   │   │   │   ├── capture/          # M2  lead capture, identity, attribution, stage-history, import
│   │   │   │   ├── dedupe/           # M3  duplicate detection & merge
│   │   │   │   ├── allocation/       # M4  allocation & scoring
│   │   │   │   ├── product-config/   # M5  product configs, schemes
│   │   │   │   ├── workspace/        # M6  lists, lead-360, board, dashboard, search, notes, saved-views
│   │   │   │   ├── self-service/     # M7  customer links, grievance intake, status/callback
│   │   │   │   ├── kyc/              # M8  documents, KYC verification, exceptions
│   │   │   │   ├── los/              # M9  eligibility, hand-off, status mirror
│   │   │   │   ├── partner/          # M10 partner master, submission, quality
│   │   │   │   ├── engagement/       # M11 tasks, templates, comms, notif prefs, SLA engine
│   │   │   │   ├── compliance/       # M12 consent, sharing, grievance, rights, DLA, retention
│   │   │   │   ├── reporting/        # M13 reports, exports, audit explorer
│   │   │   │   ├── admin/            # M14 user/role/master admin, config governance
│   │   │   │   └── integration/      # M15 IntegrationGateway, outbox, webhooks
│   │   │   ├── core/              # shared infrastructure (consumed by all modules)
│   │   │   │   ├── db/               # Kysely instance, generated DB types, UnitOfWork / TransactionHost
│   │   │   │   ├── auth/             # JwtAuthGuard, AbacGuard, @Public, @Requires, EntitlementService
│   │   │   │   ├── audit/            # AuditAppender + single-writer hash-chain consumer
│   │   │   │   ├── outbox/           # OutboxService + Pub/Sub publisher worker
│   │   │   │   ├── integration/      # IntegrationGateway + ports/ (LosPort, KycPort, ...)
│   │   │   │   ├── sla/              # BusinessCalendarService, SlaEngine
│   │   │   │   ├── masking/          # field-level masking (PAN/mobile/Aadhaar)
│   │   │   │   ├── config/           # env schema + validation (Zod)
│   │   │   │   ├── logging/          # pino logger, correlation
│   │   │   │   └── http/             # response-envelope interceptor, exception filter, correlation middleware
│   │   │   └── common/            # decorators, pipes, base DTOs
│   │   ├── test/                 # integration + e2e fixtures, factories
│   │   └── Dockerfile
│   └── web/                      # React + Vite PWA
│       ├── src/{app,components/{ui,<feature>},lib/{api,auth},hooks,types,utils}
│       └── Dockerfile
└── db/ → docs/data-model/        # schema.sql + migrations/ (Flyway) are the migration authority
```

**Module boundary rule:** a Nest module owns its §5.4 entities and exposes a service interface; cross-module access goes through that service (see §11). Shared infra in `core/` is consumed, never re-implemented.

## 4. API Design

### Style & conventions (BRD §4.4 / §8)
- **REST + JSON**, base path **`/api/v1/`**; breaking changes bump the path version.
- **Auth header:** `Authorization: Bearer <jwt>` (token also accepted from the httpOnly cookie). All endpoints authenticated unless `@Public()` (§8.6).
- **Correlation:** every request/response carries `X-Correlation-Id` (generated if absent); present in every log line and error.
- **Idempotency:** state-creating POSTs accept an `Idempotency-Key` header (FR-140).
- **Pagination:** `?page` (default 1), `?limit` (default 25, **max 100**). The server **always** applies a LIMIT — unbounded list queries are forbidden (NFR-17).
- **Filter/sort:** `?filter[field]=value&sort=-created_at`; allowed fields are per-endpoint.

### Response envelope (uniform, per BRD §4.4)
```json
{ "data": { }, "meta": { "correlation_id": "corr_…", "pagination": { "page": 1, "limit": 25, "total": 134 } }, "error": null }
```
Single-resource responses set `data` to the resource and omit `pagination`. **This uniform envelope (with inline `error`) is the BRD contract — use it; do not switch to a bare resource body.**

### Error format & status codes (BRD §8.3 / §8.4 — authoritative)
```json
{ "data": null, "meta": { "correlation_id": "corr_…" },
  "error": { "code": "VALIDATION_ERROR", "message": "…", "retryable": false, "fields": [ { "field": "mobile", "issue": "…" } ] } }
```
Codes come **only** from the §8.4 catalog (→ `docs/contracts/error-taxonomy.md` in Stage 5). **Status mapping follows BRD §8.4, which overrides this skill's generic table** — notably **`VALIDATION_ERROR` = HTTP 400** (not 422):

| Code | HTTP |
|---|---|
| VALIDATION_ERROR | 400 |
| AUTH_REQUIRED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND | 404 |
| CONFLICT | 409 |
| PAYLOAD_TOO_LARGE | 413 |
| UNSUPPORTED_MEDIA | 415 |
| RATE_LIMITED | 429 |
| INTERNAL_ERROR | 500 |
| UPSTREAM_UNAVAILABLE | 503 |

Domain sub-reasons (`DUPLICATE_BLOCKED`, `STAGE_GUARD_FAILED`, `CONSENT_MISSING`, `IDEMPOTENT_REPLAY`, `EXPORT_APPROVAL_REQUIRED`, `LEGAL_HOLD`) ride in `error.detail.reason` with the HTTP status above. Created → 201, no-content → 204.

## 5. Middleware & Cross-Cutting Concerns

Order (NestJS global pipeline): **CorrelationMiddleware → JwtAuthGuard → AbacGuard → ValidationPipe(Zod) → handler → ResponseEnvelopeInterceptor → ExceptionFilter**.

- **Correlation/logging:** every request logs `{ method, path, status, duration_ms, user_id, correlation_id }` via **pino** (nestjs-pino), structured JSON. **Never log PII values, passwords, tokens, or raw documents** (NFR + §4.6).
- **Auth:** `JwtAuthGuard` (global) + `AbacGuard` (`@Requires(...)`) as in §2. `@Public()` for §8.6 endpoints.
- **Validation:** Zod schemas; failures → `VALIDATION_ERROR` (400) with `fields[]`.
- **Exception filter:** unhandled errors logged with stack trace (server-side only), returned as `INTERNAL_ERROR` (500) in the standard envelope. **Never expose stack traces, internal IDs, or paths** (§7 security rule).
- **Masking interceptor:** applies role-based field masking (PAN/mobile/Aadhaar) on serialization; exports apply the strictest masking (§4.6).
- **CORS:** origins from `ALLOWED_ORIGINS` (comma-separated); `credentials: true` (cookie auth).
- **Rate limiting (Redis-backed):** auth/OTP 10/min; public capture & customer-link endpoints tightened (captcha + per-IP); mutations 60/min; reads 300/min (`RATE_LIMITED` 429).

## 6. Configuration & Secrets

- All config via **environment variables**, **validated at startup** with a Zod schema (Nest `ConfigModule`); missing required vars → immediate crash with a clear message (no silent late failure). Full list → `docs/contracts/environment-contract.md` (Stage 5).
- Secrets only from **Secret Manager** (injected as env at deploy); never hardcoded, never logged, never committed.
- Local dev: `cp .env.example .env.local`; values from the team secret store. India-resident services only.

## 7. Observability

- **Logging:** structured JSON (pino); mandatory fields `correlation_id`, `user_id` (if authed), `module`; levels debug/info/warn/error.
- **Audit (distinct from logs):** append-only, hash-chained `audit_logs` — see §11.4 (single-writer).
- **Tracing:** `X-Correlation-Id` per request, propagated to outbound integration calls and into `IntegrationLog`.
- **Metrics/alerts:** Cloud Monitoring — API P95 latency (NFR-02 ≤500 ms read / ≤800 ms write), error rate, queue depth, integration failure rate, SLA-breach counts, outbox lag.
- **Health:** `GET /health` → `{status:"ok"}` (public, lightweight); `GET /ready` → DB + Redis connectivity (load-balancer probe).

## 8. Testing Strategy

| Layer | Type | Tool | Location |
|---|---|---|---|
| Business logic (scoring, allocation, dedupe, guards, SLA) | Unit | Jest | `*.spec.ts` adjacent |
| API endpoints | Integration | Jest + supertest | `*.e2e-spec.ts` (api/test) |
| UI flows | E2E | Playwright | `apps/web/e2e/` |
| Authz / masking / scope | Integration | supertest | per-module negative tests |

- **Test data:** factory functions in `apps/api/test/factories/`; a seeded test DB (Flyway + seed) per run; Testcontainers-Postgres for isolation.
- **Coverage gate (per FR, §4.9):** every FR ships the unit + API tests named in its LLD "Test Guidance" row; every §8.4 error path has a test; authz negative tests (cross-scope/cross-partner denied); masking-on-export; rate-limit on public/OTP; transaction rollback on failure.

## 9. Deployment Architecture

| Env | Trigger | Database | Notes |
|---|---|---|---|
| development | push to `main` | dev Cloud SQL | auto-deploy |
| staging | `release/*` | staging Cloud SQL | auto-deploy; UAT |
| production | tag `v*` | prod Cloud SQL | **manual approval** |

- **Build:** Cloud Build → Artifact Registry → Cloud Run (api + web services).
- **Migrations:** **Flyway** runs as a pre-deploy step (Cloud Build) **before** new code serves traffic; files in `docs/data-model/migrations/`. Backward-compatible migrations only (expand/contract) for zero-downtime.
- **Backups/DR:** Cloud SQL automated daily backups + PITR; RPO ≤ 24 h, RTO ≤ 4 h (NFR-11).

## 10. Shared Conventions (every FR; no deviation)

- **PKs:** UUID v4 (`gen_random_uuid()`); never integer sequences.
- **Timestamps:** `TIMESTAMPTZ` UTC, displayed IST; `created_at`/`updated_at` on every table.
- **Soft delete:** `deleted_at` on `leads`/`lead_identities`/`customer_profiles`/`documents`; `is_active` on masters (DATA_MODEL.md).
- **Money:** `NUMERIC(15,2)` INR; never floats.
- **Naming:** `snake_case` DB columns; `camelCase` TS variables; `PascalCase` components/classes; modules/files `kebab-case`.
- **Imports:** absolute from package roots (`@api/...`, `@shared/...`); no deep `../../`.
- **Types:** no `any`/`as any`; enums imported from `@shared/enums` (generated from §5.5) — never redefined locally.
- **SQL:** parameterised only (Kysely); no string interpolation; every list query has a LIMIT.
- **Errors:** never swallow (`catch {}` forbidden); log + rethrow or return a typed error; codes from §8.4 only.
- **Async:** `async/await` throughout; no `.then()` chains.

## 11. Domain Write Model, Transactions & Concurrency  *(resolves council clash #2)*

The BRD's owner-writes rule (§4.8.3) and its mandated atomic multi-entity writes (§5.6.4) are reconciled here so agents do not improvise incompatibly.

### 11.1 Unit of Work (single ambient transaction)
A request-scoped transaction is provided by **`UnitOfWork`** (built on `nestjs-cls` + a Kysely `TransactionHost`). A use-case opens one transaction; every owner-service method invoked within it **enlists in that same transaction/connection** (one Cloud SQL connection per request). This makes "owner-writes" (which module's code issues the SQL) and "atomicity" (one commit across modules) coexist on the NestJS modular monolith — no distributed transaction needed.

- Pattern: `await uow.run(async (tx) => { … call owner services with tx … })`.
- **Owner-writes rule:** an entity's lifecycle is written only via its owning module's service (e.g., only `LeadService` writes `leads`). Consumers call the service, never the table.
- **Stated exception (append-only sinks):** any owning service may `INSERT` into `audit_logs`, `event_outbox`, and `data_sharing_logs` within the caller's transaction. These are sinks, not lifecycle entities.

### 11.2 LeadService mutator interface  *(contract entry #1 — the serialization point for the 14 Lead-writer FRs)*
`leads` is written by ~14 FRs across 6 modules. All go through one interface; no module writes `leads` directly:
```
LeadService.create(input, tx)
LeadService.transitionStage(leadId, toStage, guardCtx, expectedVersion, tx)   // enforces §10.3 guards + version
LeadService.assignOwner(leadId, ownerId, reason, tx)
LeadService.setScore(leadId, score, reasons, tx)        LeadService.setHotFlag(leadId, isHot, reasons, tx)
LeadService.setKycStatus(leadId, status, tx)            LeadService.setConsentStatus(leadId, status, tx)
LeadService.recordEligibility(leadId, snapshotRef, tx)  LeadService.markHandedOff(leadId, losAppId, expectedVersion, tx)
LeadService.merge(masterId, duplicateId, reason, tx)
```
- **Optimistic locking:** mutators take `expectedVersion` and use `WHERE version = :v` (bump on success); stale → `CONFLICT` (409).
- **Volatile vs human fields:** system-managed volatile fields (`sla_*_due_at`, `is_hot`, `score`) are updated by dedicated mutators so background SLA/scoring writes don't raise false 409s against RM edits.
- Every `transitionStage` writes, in the same tx: `leads` update + `stage_history` row + `audit_logs(stage_transition)` + `event_outbox(LEAD_STAGE_CHANGED)` (BRD §10.3).

### 11.3 Stage guards
`StageGuardService` evaluates §10.3 transition guards; failure → `VALIDATION_ERROR` with `detail.reason=STAGE_GUARD_FAILED` and the failing guard(s). It is the single owner of the transition matrix.

### 11.4 Audit hash-chain — single writer  *(resolves council blind-spot #9)*
The `audit_logs` chain (`prev_audit_hash`) requires serial append, which conflicts with stateless horizontal scaling. Resolution: services emit audit intent via the outbox/queue; a **single-writer `AuditChainConsumer`** (one Cloud Run instance, `max-instances=1`, or a Cloud Tasks queue with concurrency 1) computes `prev/after` hashes and appends in order. App instances never write the chain concurrently.

### 11.5 Idempotency & outbox
`IntegrationGateway` dedups on `Idempotency-Key`/`IntegrationLog.idempotency_key` (Redis + unique index). `event_outbox` rows are written in the state-change transaction; a publisher worker relays to Pub/Sub (at-least-once; idempotent consumers).

### 11.6 Retention/erasure — privileged cross-table writer  *(resolves cross-FR review H3)*
Data-principal erasure (DPDP "right to erasure", FR-115) inherently spans every PII table. The M12 **`RetentionEngine`** is therefore a *sanctioned privileged writer* of the PII columns it anonymises/purges across `lead_identities`, `customer_profiles`, `lead_product_details`, `communication_logs`, `documents`, and `kyc_verifications` — analogous to the §11.4 single-writer `AuditChainConsumer`. This is a bounded, documented exception to owner-writes (§4.8.3), justified because it is a single scheduled actor (no concurrent races), each lead is processed in its own `UnitOfWork` transaction, candidates under `legal_hold`/open-DRR/open-grievance are excluded, and the writes null PII only (no state-machine or `version` transition). The one carve-out: the **`leads`** aggregate root is never written directly — its retention soft-delete goes through `LeadService.softDeleteForRetention` (§11.2) so the optimistic `version` is bumped. `audit_logs`, `consent_records`, and `stage_history` are never touched by retention.

## 12. Module Build Order & Dependencies  *(resolves council "foundation-then-fan-out")*

The §13.2 increment plan is reordered so cross-cutting foundations exist before the consumer waves (the §14.2 dependency map and the council both require this).

1. **Foundation (build first, serial):** `core/` infra — `db`/UnitOfWork, `config`, `logging`, `http` envelope/exception, `auth` (JwtAuthGuard/AbacGuard/EntitlementService), `audit` (single-writer), `outbox`, `integration` (gateway + `LosMockAdapter`), `sla` (BusinessCalendar/SlaEngine); plus **M1 identity**, **M14 admin/config**, **M5 product-config**. Freeze the `LeadService` interface (§11.2) and the §5/§5.5/§8.4 contracts here.
2. **Core domain:** M2 capture (incl. `LeadService`, stage-history), M3 dedupe, M4 allocation.
3. **Workflow:** M8 KYC/docs, M7 self-service, M12 compliance (consent gates), M11 engagement (tasks/SLA/comms).
4. **Integration-dependent:** M9 LOS (against `LosMockAdapter`; real adapter last), M10 partner.
5. **Read models:** M6 workspace, M13 reporting (depend on data existing).

No consumer module is dispatched before the foundation contracts it references are frozen.

## 13. Key Architectural Decisions (ADRs)

| # | Decision | Rationale |
|---|---|---|
| ADR-1 | NestJS modular monolith (not microservices) | Single Cloud SQL connection enables the §11.1 UnitOfWork; simplest correct way to honour atomic multi-module writes; can extract modules later. |
| ADR-2 | Kysely + Flyway (not a heavy ORM) | Schema is hand-authored SQL with enums/deferred-FKs/partial indexes/hash-chain an ORM models poorly; avoids schema drift. |
| ADR-3 | App-level RBAC/ABAC via `EntitlementService`; **no Postgres RLS / Supabase** | Matches BRD §4.7; one decision point; consistent with Cloud SQL + Cloud Run. |
| ADR-4 | Hexagonal ports for all externals; **LOS behind `LosPort` + versioned mock** | LOS wire contract is third-party/undefined (council); build now against `LosMockAdapter`, swap real adapter last. |
| ADR-5 | Single-writer audit-chain consumer | Preserves tamper-evidence under horizontal scale (council #9). |
| ADR-6 | `BusinessCalendarService` centralises business-hours/holidays | One clock for all SLA/TAT timers (council #10). **Done (v5.2):** the `business_calendars` entity is in the data model (BRD §5.2.46, schema.sql); `BusinessCalendarService` reads it, resolving branch→region→`is_default`. Holidays are a JSONB list on the calendar; a default Mon–Sat IST calendar is seeded. |
| ADR-7 | Transactional outbox → Pub/Sub | Reliable events for analytics/AI (FR-141) without dual-write inconsistency. |

## 14. Assumptions to verify

1. Region **asia-south1 (Mumbai)** (vs `asia-south2` Delhi).
2. **Kysely** as the query layer and **nestjs-cls** for the UnitOfWork (sub-choices not named in the BRD; record in `dependency-register.md` at Stage 5).
3. **Cloud Tasks** (queue) + **Pub/Sub** (event bus) + **Memorystore Redis** as the concrete GCP services.
4. **ADR-6 — RESOLVED:** the `BusinessCalendar` entity was added to the data model (BRD §5.2.46 / `business_calendars`, v5.2) and is the SLA engine's business-time source.
5. Vendor selection (PAN/CKYC/comms/CTI) and TRAI-DLT/WhatsApp-WABA registration remain open (OD-08/OD-17) — adapters are built against the ports regardless.
