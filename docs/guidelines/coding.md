# Coding Guidelines
*Stack: NestJS (Node 20, TS 5 strict) backend · React 18 + Vite + TS 5 frontend · Kysely + PostgreSQL 15 · pino | Updated: 2026-06-08*

Single source of truth for how every line is written. Consumed by `lld-generator` (build) and `full-review` (check). Aligns with `docs/architecture.md`; do not introduce conflicting conventions.

## Language & framework versions
- **TypeScript 5.x strict** everywhere — `"strict": true`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Applies to both apps.
- **Node.js 20 LTS**; **NestJS** (modular monolith) backend; **React 18 + Vite** frontend.
- **Kysely** typed query builder (not a heavy ORM); **Flyway** owns migrations. **Never** hand-write raw string SQL — use Kysely.

## File & folder naming
- Source files: `kebab-case.ts` (`lead.service.ts`, `create-lead.dto.ts`, `stage-guard.service.ts`).
- NestJS classes follow Nest suffixes: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.dto.ts`, `*.repository.ts`.
- React components: `PascalCase.tsx` (`LeadTable.tsx`); hooks `use-*.ts`.
- Tests: `*.spec.ts` (unit) / `*.e2e-spec.ts` (API) adjacent to source; Playwright in `apps/web/e2e/`.
- Directories: `kebab-case/`. One Nest module per BRD module under `apps/api/src/modules/` (see architecture §3).

## Import ordering (blank line between groups)
1. Node stdlib · 2. third-party (`@nestjs/*`, `kysely`, `zod`, …) · 3. workspace aliases (`@shared/*`, `@api/*`) · 4. relative imports **within the same module only**.
- Cross-module access is via the other module's **service** (DI), never deep relative imports into its internals.
- **Enums and shared types come from `@shared/*`** (generated from BRD §5.5) — never redefine an enum locally.

## Naming conventions
- Variables/functions `camelCase`; classes/components `PascalCase`; constants `SCREAMING_SNAKE_CASE`; DB columns `snake_case`.
- Booleans prefixed `is/has/should/can`; event handlers prefixed `handle`; React hooks prefixed `use`.
- Money is `NUMERIC(15,2)` in DB → represent as integer paise or a decimal string in TS; **never `number` float for money**.

## TypeScript rules
- **No `any`. No `as any`. No `@ts-ignore`** without an adjacent justification comment. Use `unknown` + narrowing or precise types.
- All function params and return types explicitly typed. `interface` for object shapes; `type` for unions/intersections.
- **Zod** schemas for every external input (API DTOs, form data, webhook payloads, env). Validate at the boundary before the service layer.
- DB row types come from `kysely-codegen` (generated from the schema) — do not hand-maintain table types.

## Domain write rules (architecture §11 — mandatory)
- **Owner-writes:** an entity's lifecycle is written only by its owning module's service. Only **`LeadService`** writes `leads` (via its mutator methods — `transitionStage`, `assignOwner`, `setScore`, `markHandedOff`, …); no other code issues `UPDATE/INSERT` on `leads`.
- **Atomic multi-entity writes** run inside one transaction via **`UnitOfWork`** (`uow.run(async (tx) => …)`); owner services accept and enlist in the caller's `tx`. Append-only sinks (`audit_logs`, `event_outbox`, `data_sharing_logs`) may be inserted by any owner within that tx.
- **Optimistic locking:** Lead mutators take `expectedVersion` and update `WHERE version = :v`; a stale write returns `CONFLICT` (409).
- Every stage transition (in the same tx) writes `leads` + `stage_history` + `audit_logs(stage_transition)` + `event_outbox(LEAD_STAGE_CHANGED)`.

## Error handling
- **Never swallow errors** — `catch {}` / `catch(e) {}` are forbidden. Always log and rethrow, or map to a typed error response.
- Use **only** the codes in `docs/contracts/error-taxonomy.md` (the BRD §8.4 catalog; `VALIDATION_ERROR=400`, `CONFLICT=409`, `UPSTREAM_UNAVAILABLE=503`, …). Do not invent codes.
- External error responses use the uniform envelope `{ data:null, meta, error:{ code, message, retryable, fields? , detail? } }`; **never expose stack traces, internal IDs, SQL, or system paths**. Log the full error internally with `correlation_id`.
- The global Nest **exception filter** maps unhandled errors to `INTERNAL_ERROR` (500) in the envelope.

## Logging
- Structured JSON via **pino** (nestjs-pino). **No `console.log` in production code.**
- Every line includes `correlation_id`, `level`, `module`; authenticated requests add `user_id`.
- Levels: `debug` (dev only), `info`, `warn`, `error`.
- **Never log** (even at debug): passwords, JWT/refresh tokens, OTPs, `secret`, and these PII fields — `name`, `mobile`, `email`, `pan_token`, `pan_masked`, `aadhaar_ref_token`, `ckyc_id`, `gstin`, `dob`, `address`, `ip_device`, document contents/URLs. See `security.md`.

## Async patterns
- `async/await` throughout — no `.then()` chains. Every await has error handling (try/catch or typed result).
- `Promise.all` only when every rejection is handled (or `allSettled` + filter). 
- Work > 500 ms or any external provider call goes through the **IntegrationGateway** / a **Cloud Tasks** job — never block the request thread. Jobs are **idempotent**.

## Comments & docs
- Public services/controllers/exported functions get a JSDoc summary. Inline comments explain *why*, not *what*.
- No commented-out code (use git). No `TODO`/`FIXME` without an id: `// TODO(LMS-123): …`.

## Linting & formatting
- **ESLint** (typescript-eslint, strict) + **Prettier**, enforced by pre-commit hooks (husky/lint-staged). Zero lint errors at commit. No `--no-verify` bypass.
- `tsc --noEmit` must pass; `any`/unused are errors, not warnings.
