# LMS — Stage 7 Build Continuation Brief

*Saved 2026-06-11 from the Stage-7 dispatcher session; refreshed 2026-06-12 after Wave 1 completion. Every developer (and every coding agent) reads this before starting an FR.*

## 1. Project & environment
- **What:** Lead Management System for an Indian NBFC.
- **Repo:** `C:\Projects\Lead_Management_System` (git, branch `master`). GitHub remote: `haleti-psi/lead-management-system` — **local commits are ahead/unpushed** (history was re-authored once; a `backup-pre-reauthor` branch exists — verify remote before pushing).
- **Stack (fixed):** NestJS modular monolith (Node 20, TS strict) · **Kysely** (typed SQL, not an ORM) + **Flyway** migrations · PostgreSQL 15 · Redis · Cloud Tasks + Pub/Sub · GCS · Cloud Run (asia-south1). Frontend React 18 + Vite + Tailwind + shadcn/ui (PWA). **npm-workspaces monorepo**: `apps/api`, `apps/web`, `packages/shared`.
- **Pipeline:** Stages 1–6 done, Gates A/B/C signed. Now in **Stage 7 (code generation)**, executing the `phase-executor` skill as a dispatcher. `manifest.json` `current_stage=7` with a `stage7` block tracking run state.
- **Source of truth:** everything is spec-driven — `docs/lld/FR-NNN.md` (+ `-tests.md`), `docs/contracts/*`, `docs/architecture.md`, `docs/data-model/schema.sql`. Binding corrections in `docs/lld/CORRECTIONS.md`; open gaps in `docs/lld/AMBIGUITIES.md`.

## 2. What's built & committed on `master` — Wave 1 (foundation) ✅ COMPLETE (63 suites / 546 tests passing)

**13 FRs + platform:** core/ infra · M1 identity (FR-001/002/003) · M5 product-config (FR-040/041/042) · M14 admin (FR-130/131/132) · FR-104 SLA · FR-123 audit chain consumer + explorer · FR-140 IntegrationGateway · FR-141 outbox. The Wave-1 close-out FRs were built in parallel git worktrees, per-FR reviewed, and cherry-picked to master (latest: `752f7f3 chore(manifest): Wave 1 complete`). Early-platform commits:
```
80f9741  feat(core): platform foundation   — config, db/UnitOfWork, logging, http envelope/exception/correlation,
                                             @lms/shared (69 enums), committed 47-table Kysely types
0e6e270  feat(identity): FR-001 auth       — JwtAuthGuard(global)+@Public, TokenService, login/MFA(otplib,
                                             AES-GCM totp)/refresh-rotation/lockout(argon2), Redis throttler, AuditAppender
015bf97  feat(auth): FR-002 ABAC           — EntitlementService.can (deny-by-default, scope from DB not JWT),
                                             AbacGuard+@Requires, EntitlementCacheService, MaskingService+interceptor
fb805c5  feat(outbox): FR-141 outbox       — OutboxService.emit(event,tx) transactional; Pub/Sub publisher behind a port
58efab4  feat(sla): FR-104 SLA             — BusinessCalendarService, SlaEngine(computeDueAt+sweep), /admin/sla-policies
5f1e9d3  chore(manifest): -> Stage 7
```
(Earlier this session: Stage-6 LLDs for all 49 FRs, a v5.3 spec-hardening pass, the monorepo scaffold, lockfile, GitHub push.)

## 3. Foundation services now available — IMPORT these, never re-implement
| Service | Location | Signature / note |
| --- | --- | --- |
| `UnitOfWork.run(fn(tx))` | `core/db` | ambient single Kysely tx via nestjs-cls (§11.1) — all multi-entity writes |
| Kysely `DB` + types | `core/db` | full types in `core/db/types.generated.ts` (committed; `npm run db:codegen` to regen) |
| `AppConfigService` | `core/config` | typed env (Zod-validated, fail-fast). Never read `process.env` directly |
| pino logger | `core/logging` | structured; PII/token redaction. **No `console.log`** |
| `ResponseEnvelopeInterceptor`, `AllExceptionsFilter`, `CorrelationMiddleware`, `DomainException(code,msg,{fields,detail})` | `core/http` | uniform `{data,meta,error}`; taxonomy codes only; no leaks |
| `PaginationParams`, `ZodValidationPipe` | `core/common` | page≥1 / limit 1..100 |
| `JwtAuthGuard`(global)+`@Public()`, current-user decorator, `TokenService` | `core/auth` | FR-001 |
| `AbacGuard`+`@Requires(capability, scopeResolver?)`, `EntitlementService.can(user,cap,resource)`, `EntitlementCacheService.invalidateRole/invalidateUser` | `core/auth` | FR-002. **`@Requires` needs an explicit `() => ({ resourceType: '<table>' })`** or it defaults to `leads` |
| `MaskingService`, `MaskingInterceptor` | `core/masking` | FR-002. Extend FIELD_MAP for `pan_token/ckyc_id/gstin/dob` when KYC serializes identity rows |
| `AuditAppender.append(entry, tx)` | `core/audit` | FR-001. entry = `{action(audit_action enum), entity_type, entity_id, actor_id, lead_id?, detail?}` |
| `OutboxService.emit(event, tx)` | `core/outbox` | FR-141. event = `{event_code, aggregate_type, aggregate_id, payload}` (OBJECT form) |
| `BusinessCalendarService.resolve(branch?,region?)`, `SlaEngine` | `core/sla` | FR-104 |
| `IntegrationGateway.call(port, req, {idempotencyKey})` + ports (`LosPort` → `LosMockAdapter`, `KycPort`, …) | `core/integration` | FR-140. Idempotency, retry, circuit breaker, `IntegrationLog`. **All external calls go through it** — no provider SDK calls in modules |
| `AuditChainConsumer` (single-writer hash chain) | `core/audit` | FR-123. Appender (FR-001) + chain consumer + audit explorer all live |
| shared ioredis client | `core/redis` | FR-001 |
| `@lms/shared` | `packages/shared` | 69 enums, `ApiEnvelope/ApiError`, `ERROR_CODES` — never redefine an enum locally |

**Not built yet** (FRs depend on these later): `LeadService` (Wave 2 / FR-010 — **sole writer of `leads`**) and `AllocationService` (FR-030). The port seams built in Wave 1 (e.g. `LeadSlaWriterPort` for SLA due-dates, admin bulk-reassign) wire into `LeadService` when FR-010 lands. For any new cross-wave dep, define a **port seam** now and wire the adapter when the owner FR lands.

## 4. Non-negotiables every FR must follow
- **Owner-writes:** only the owning module's service writes its entity; **only `LeadService` writes `leads`** (with `expectedVersion`). Never `tx.updateTable('leads')` elsewhere.
- **Atomicity:** multi-entity writes inside `UnitOfWork.run`. Audit + outbox emitted **in the same tx** as the state change.
- **Auth:** every endpoint `@Public()` (and in `auth-matrix.json` `public_endpoints`) OR protected by global `JwtAuthGuard` + `AbacGuard`+`@Requires`. Public endpoints must be in the allow-list.
- **Errors:** only `error-taxonomy.md` codes (`VALIDATION_ERROR=400`, `FORBIDDEN=403`, `CONFLICT=409`, `UPSTREAM_UNAVAILABLE=503`, …). No stack/SQL/path leaks.
- **Data:** parameterised Kysely only; every list query `LIMIT ≤ 100`; secrets via `AppConfigService`/env; never log PII/tokens.
- **Deps:** only `docs/contracts/dependency-register.md` libs (no axios, no `@types/express` — use structural HTTP types, no ORM, no moment/lodash). TS strict, **no `any`/`as any`**, no swallowed errors, no `console.log`.

## 5. The build loop (per FR)
1. Dispatch a **coding sub-agent** with: its `FR-NNN.md` + `-tests.md`, the contracts, CORRECTIONS/AMBIGUITIES, and "use the existing foundation, don't re-implement." (The foundation was built serially in the main working tree; once team buckets split, each developer works in their own clone/branch.)
2. **Independently re-verify** (don't trust the agent): `npm run build:shared` · `npx tsc --noEmit -p apps/api/tsconfig.json` · `npm run build -w @lms/api` · `npm test -w @lms/api` · grep for banned patterns / owner-writes violations.
3. Dispatch a **reviewer sub-agent** (APPROVE/REJECT with file:line) against the LLD + contracts.
4. On **REJECT**, dispatch a focused **fix agent** (max ~2 retries), then re-verify.
5. **Commit** (`feat(<module>): FR-NNN …`). Cadence: **auto-merge within a wave, pause at wave boundaries.**

## 6. Key decisions & learnings (carry these forward)
- **e2e/Testcontainers tier is DEFERRED** to a dedicated integration-test wave (recorded in `manifest.json` `stage7.test_strategy` + each `FR-NNN-tests.md`). Per-FR unit + component coverage is enforced at merge; reviewers verify atomicity structurally.
- **Stream-idle timeouts** hit large coding agents (~Tier-3). Mitigation: keep agent final reports brief; if one times out mid-build, the code is usually on disk and compiles — dispatch a **finishing agent** to add tests rather than restarting.
- DB types are **committed** (so worktrees/CI need no live DB).
- **Worktree rule — NO `git stash` in worktrees:** the stash stack is repo-wide (shared by ALL worktrees of one clone); two parallel agents stashing caused a cross-worktree WIP swap (FR-020/FR-110, 2026-06-12). Parallel worktree agents must never stash; use plain file edits only, and the dispatcher inspects `git status` per worktree before committing.
- Register-clean substitutions the agents made and you should keep: structural `HttpRequestLike`/`HttpResponseLike` instead of `@types/express`; HMAC-derived purpose-token secrets (no new env var); ioredis-backed throttler storage; AES-256-GCM for `totp_secret_enc`.
- Reviewers have caught real issues twice: an out-of-contract `@Public` endpoint (FR-001) and a missing `@Requires` scope resolver (FR-104) — keep the reviewer step.
- Wave-1 close-out review catches (integration bugs the unit tests passed): NestJS **multi-providers don't aggregate across modules** — cross-module registries (config activators) must use the `@Global` self-registering activator registry (FR-040/FR-132); **masters are active-immediately** (a draft row with no activator is stranded forever — FR-131); `schemes` is owned by FR-042, not the generic master allow-list; entitlement cache eviction must evict **all** role-holders, not the first 100 (FR-130).
- **Stage-9 watchlist** (ownership questions flagged during Wave 1, not defects): master-resource overlaps (FR-131 generic `/admin/{masterResource}` vs partners/templates/allocation-rules/retention owned by M10/M11/M4/M12); regions/branches capability (`user_mgmt` vs `configuration`); lead-attach endpoints (e.g. scheme attach) correctly deferred to the capture FRs with logic exported for them.

## 7. Remaining work (architecture §12 build order)
- **Wave 1 (foundation): ✅ COMPLETE** — see §2.
- **Wave 2 core domain:** M2 capture incl. **`LeadService`** + stage-history (FR-010), M3 dedupe (FR-020/021), M4 allocation+scoring (FR-030/031/011).
- **Wave 3 workflow:** M8 KYC (FR-070/071/072), M7 self-service (FR-060/061/062), M12 compliance (FR-110/112/113/114/115), M11 engagement (FR-100/101/102/103).
- **Wave 4 integration:** M9 LOS (FR-080/081/082, vs LosMockAdapter), M10 partner (FR-090/091/092).
- **Wave 5 read models:** M6 workspace (FR-050–054), M13 reporting (FR-120/121/122 — FR-123 done in Wave 1).
- Then: wire the deferred **port seams**, the **integration-test wave**, and Stage 8/9 reviews.

## 8. To continue
Wave 1 is done — resume at **Wave 2: FR-010 (capture + `LeadService`)**. Each agent prompt = the FR's LLD + tests + standard contracts + "use the foundation in §3 above; owner-writes; verify build/tsc/nest/jest before returning; write `AMBIGUITY.md` if genuinely blocked (e.g. the open business-seed FRs FR-011/FR-020)."

## 9. Team fan-out (3 developers, from Wave 2)
*Summary only — the full plan (queues, deliverables, checkpoints) is `docs/TEAM-PLAN.md`.*
| Dev | Owns (modules) | FR order |
|---|---|---|
| **Dev 1 — integrator** (merges ALL PRs; owns contract/schema changes; arbiter per BRD §14.6) | M1–M6 | FR-010/011 (LeadService — critical path) → 020/021 → 030/031 → 050–054 last |
| **Dev 2** | M7, M8, M10 + web foundation (`AppShell`, `DataTable`, `EntityForm`, `MaskedField`, `apiClient`, login — BRD §4.5) | FR-070 → 071 → 072 → 060 → *(after FR-110)* 061/062 → 090–092 |
| **Dev 3** | M9, M11–M15 | **FR-110 first** (consent gates others) → 100–103 → 111–115 → 080–082 → 120–122 last |

**Working rules:** own clone + own Claude session each; one branch per FR (`feature/FR-NNN`); rebase on master daily; only Dev 1 merges; a new field/enum/error-code/endpoint/library = a separate Dev-1-approved contracts PR *before* the code that uses it; spec unclear → ask Dev 1 / write `AMBIGUITY.md`, never guess. Remaining cross-dev waits: Dev 2's FR-061/062 need Dev 3's FR-110 — everything else is fully parallel.
