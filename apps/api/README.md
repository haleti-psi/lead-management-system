# `@lms/api` — Backend (NestJS)

NestJS **modular monolith** (Node 20, TypeScript strict). One Nest module per BRD module
(M1–M15) under `src/modules/`; shared infrastructure under `src/core/` (consumed, never
re-implemented). Database access is **Kysely** (typed SQL) — no ORM.

## Structure (`docs/architecture.md` §3)

```
src/
├── main.ts                 # bootstrap (global prefix /api/v1, helmet/CORS/guards wired in Stage 7)
├── app.module.ts           # root module
├── health.controller.ts    # GET /health (Cloud Run liveness)
├── modules/                # one feature module per BRD module
│   ├── identity/  capture/  dedupe/  allocation/  product-config/
│   ├── workspace/ self-service/ kyc/ los/ partner/
│   └── engagement/ compliance/ reporting/ admin/ integration/
├── core/                   # shared infra (cross-cutting)
│   ├── db/        # Kysely instance, generated types, UnitOfWork / TransactionHost
│   ├── auth/      # JwtAuthGuard, AbacGuard, @Public, @Requires, EntitlementService
│   ├── audit/     # AuditAppender + single-writer hash-chain consumer
│   ├── outbox/    # OutboxService + Pub/Sub publisher
│   ├── integration/ # IntegrationGateway + ports/ (LosPort, KycPort, ...)
│   ├── sla/       # BusinessCalendarService, SlaEngine
│   ├── masking/   config/  logging/  http/   # envelope interceptor, exception filter, correlation
└── common/                 # decorators, pipes, base DTOs
```

## Non-negotiable conventions (full list: `docs/guidelines/`, `CONTRIBUTING.md`)

- **Owner-writes (§11):** only `LeadService` writes the `leads` table (via mutators with
  `expectedVersion`). Cross-module access goes through the owning module's service.
- **Atomic writes:** multi-entity writes run inside `UnitOfWork.run(tx => ...)`.
- **Auth:** global `JwtAuthGuard` (+ `@Public()`), then `AbacGuard` + `@Requires(capability, scope)`
  → `EntitlementService.can()`. Public endpoints are listed in `auth-matrix.json`.
- **Errors:** only codes from `docs/contracts/error-taxonomy.md` (`VALIDATION_ERROR=400`, …).
  Uniform envelope `{ data, meta, error }`.
- **SQL:** parameterised Kysely only; every list query has `LIMIT` (≤100). No raw string interpolation.
- **Shared services:** reuse from `core/` per `docs/contracts/shared-utilities.md` — pinned signatures
  `AuditAppender.append(entry, tx)`, `OutboxService.emit(event, tx)`.
- Only libraries in `docs/contracts/dependency-register.md`; only env vars in `environment-contract.md`.

## Run / build / test

```bash
npm install                     # from repo root
npm run build:shared            # shared package first
npm run start:dev -w @lms/api   # or: npm run dev:api   (http://localhost:8080)
npm run build -w @lms/api       # nest build → dist/
npm run test  -w @lms/api       # jest unit; test:e2e for supertest + testcontainers
```

The schema is owned by Flyway (`docs/data-model/migrations/`); generate Kysely types with
`npm run db:codegen` (root). Per-FR implementation specs live in `docs/lld/FR-NNN.md`.
