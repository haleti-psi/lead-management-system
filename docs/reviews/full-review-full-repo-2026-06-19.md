# Full Review — Lead Management System (full repo)

**Date:** 2026-06-19
**Target:** entire project (`apps/api`, `apps/web`, `packages/shared`, `docs/`, infra)
**Severity floor:** `high+` (default — fix CRITICAL + HIGH)
**Baseline:** working tree clean at `c57602e`; **API 1840 + web 393 tests green**; stack verified end-to-end locally.

This is a **re-review** of a mature codebase (49/49 FRs, already passed Stage 8 per-FR review + Stage 9 cross-FR review), focused on the recent changes: the design-system overhaul, the 8 new admin/lead UI screens, and the 2 new backend GET endpoints. Five domain reviews ran in parallel; BRD-coverage was reused from `brd-coverage-lms-2026-06-15.md` (COMPLIANT, 49/49) as it was just run.

---

## 1. Scope and Options

| Item | Value |
| --- | --- |
| Target | full repo |
| Floor | `high+` |
| Skips | Guardrails (clean tree — folded into Coding-Standards); BRD-coverage (reused, just run) |
| Reviews run | Security, Quality, UI, Infra, Coding-Standards (parallel) |
| Commit policy | one commit per fixed tier; plain author `haleti`, no AI trailer |

---

## 2. Sub-Review Summaries

- **Security — SECURE.** Both new GETs guarded (`JwtAuthGuard` + `AbacGuard` + `@Requires`); ABAC deny-by-default with server-side scope resolution; FR-131 generic dispatcher uses a fixed slug→table allow-list (no interpolation); audit hash-chain single-writer intact; refresh token `HttpOnly;Secure;SameSite=Strict`; logger redacts auth headers + token/PII keys. No P0/P1/P2. One P3 (search term in GET URL — as-designed).
- **Quality — SOLID.** The two new backend modules are textbook (atomic `UnitOfWork`, optimistic guards, owner-writes, defence-in-depth authz, full spec trios). All 8 UI screens reuse shared `apiClient`/react-query/`DataTable`/`Modal`/`MaskedField` and are tested. One genuine P2 (`use-eligibility` error-swallowing); rest are minor `as`-cast soft spots.
- **UI — GO.** Component-substance P0 gate **PASS** — all 8 screens render real hooks/forms/API calls/data (zero skeletons). Design overhaul is token-clean (no hardcoded hex), dark-mode complete, reduced-motion aware; shared primitives reused; masking + nav coherence + responsive structure hold. Findings are P3/P4 polish.
- **Infra — CONDITIONAL.** Dockerfiles/env-fail-fast/Cloud-Run wiring/observability/workers are production-grade. **One P0 (duplicate V3 migration — now FIXED)**; two P1 (retention cron not wired; no CI/CD); P2s (argon2-on-slim build risk, liveness-only health, nginx security headers). `project.config.yaml` TODOs are the expected pre-deploy CONDITIONAL.
- **Coding-Standards — COMPLIANT.** No `any`/`as any`/`@ts-ignore` in prod, no `console.*` in server code, no swallowed catches, parameterised Kysely, every list LIMIT-bounded, enums from `@lms/shared`, dependency-register respected, owner-writes intact. One P3 (array-index key in a calendar sub-form).
- **BRD Coverage — COMPLIANT (reused).** 49/49 FRs end-to-end per `brd-coverage-lms-2026-06-15.md`.
- **Sanity — CLEAN.** Only change applied is a migration-file rename (no TS/code impact; no test or doc references the filename); the 2233-test baseline is unaffected. Build health unchanged.

---

## 3. Component Substance Report (P0 Gate)

| Component | Hooks | Form Inputs | API Calls | Data Renders | Verdict |
| --- | --- | --- | --- | --- | --- |
| `app/leads/LeadListPage.tsx` | useLeads, useSavedViews, useCreateSavedView | search + 7 filters + save-view form | list/saved-views GET, create POST | masked name/mobile, stage/consent/KYC chips, score | OK |
| `app/admin/users/UserAdminPage.tsx` | useAdminUsers/Roles/Teams, useUpdateUser/Team | status filter, 3 forms | users/roles/teams GET, PATCH | 3 tables, status chips, masked mobile | OK |
| `app/admin/master/MasterDataPage.tsx` | useMasterList | resource nav, filter, 4 forms | master GET, create/update/deactivate | per-resource columns, status, actions | OK |
| `app/admin/products/ProductConfigPage.tsx` | useProductConfigs, useProductConfig | status/product filters, form | configs GET, by-id GET, create/retire | product/version/status/PAN-timing | OK |
| `app/admin/break-glass/BreakGlassPage.tsx` | useBreakGlassGrants | status filter, request/approve/revoke | grants GET, request/approve/revoke | grantee/scope/status/valid-until | OK |
| `components/admin/ConfigGovernancePage.tsx` | useConfigVersions, useApproveConfig | approve/reject/rollback, diff | pending GET, approve/rollback POST | config type/ref/maker + DiffViewer | OK |
| `pages/audit/AuditExplorerPage.tsx` | useAudit | filter bar, unmask modal | audit GET, single-field unmask POST | timestamp/actor/action, masked detail, integrity badge | OK |
| `app/admin/AdminHomePage.tsx` | — (nav index) | — | — | 6 capability-gated console cards | OK (index) |

**Skeleton components found: 0. Substance verdict: PASS.**

---

## 4. Severity-Mapped Finding Table (deduplicated)

| # | Sev | Domain(s) | Location | Issue | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **CRITICAL** | Infra | `docs/data-model/migrations/V3__*` ×2 | Two `V3__` migrations + `validateOnMigrate=true` → `flyway migrate` aborts; schema never deploys | ✅ FIXED (→ V6) |
| 2 | **HIGH** | Infra | `retention-policy.controller.ts:198`, `env.schema.ts` | `RETENTION_CRON_SCHEDULE` documented (env-contract, FR-115) but no autonomous trigger wired; apply runs only inline behind a user JWT → DPDP scheduled-purge gap | ⏸ DEFERRED — decision needed |
| 3 | **HIGH** | Infra | `.github/workflows` (absent) | No CI/CD: nothing runs the 2233-test suite, builds/scans images, or deploys on push | ⏸ DEFERRED — decision needed |
| 4 | MEDIUM | Quality | `use-eligibility.ts:40` | `.catch(()=>null)` collapses transport/5xx into the empty state; `isError` never trips → load-failure indistinguishable from no-data | Backlog |
| 5 | MEDIUM | Infra | `apps/api/package.json:25`, `Dockerfile:8` | `argon2` native addon on `node:20-slim` (no build toolchain) — relies on prebuilds; unverified (build not yet exercised) | Backlog (verify on first `docker build`) |
| 6 | MEDIUM | Infra | `health.controller.ts:11` | `/health` is liveness-only (static `ok`); no DB readiness probe | Backlog |
| 7 | MEDIUM | Infra | `apps/web/nginx.conf` | SPA origin sets no security headers (CSP / X-Content-Type-Options / X-Frame-Options); API has helmet, web does not | Backlog |
| 8 | LOW | Quality | `MasterDataPage.tsx:144,185-281` | ~10 union downcasts gated by external `slug` rather than a TS discriminant | Backlog |
| 9 | LOW | Quality | `RolePermissionsForm.tsx:72-78` | `as Capability` / `as DataScope` widening casts | Backlog |
| 10 | LOW | Quality | `hooks/use-*.ts` | Data hooks lack dedicated unit tests (covered transitively via screens) | Backlog |
| 11 | LOW | UI | `app/App.tsx:88` | Catch-all `*` redirects to `/`; no dedicated 404/500 page + page-level ErrorBoundary | Backlog |
| 12 | LOW | UI | filter `<select>`s (4 screens) | sr-only label not programmatically associated (aria-label works; not an AA failure) | Backlog |
| 13 | LOW | UI | new tables | dates via `toLocaleDateString()` not the mandated `dd-MM-yyyy` IST | Backlog |
| 14 | LOW | UI + Quality | app-wide | hardcoded English strings (no i18n) — pre-existing project-wide gap, not a regression | Backlog (track separately) |
| 15 | LOW | Standards | `BusinessCalendarForm.tsx:241` | array-index `key` on a removable holidays list → stale controlled-input after mid-list delete | Backlog |
| 16 | LOW | Security | `LeadListPage.tsx:159` | search term travels in GET URL query (as-designed; optional POST hardening) | Backlog |

---

## 5. Conflict Log

- **Full-review "fix HIGH+" vs. global "surgical changes / surface genuine ambiguity" (global wins).** Findings #2 and #3 are HIGH but are net-new infrastructure/feature additions carrying genuine, unspecified design decisions:
  - **#2 retention cron:** the engine is **per-org** (`applyRun(runId, orgId, …)`) while the only sweep precedent (`SlaEngine.sweep(tx)`) is **global**. An autonomous, no-user retention sweep therefore needs an org-iteration strategy that is specified nowhere, *and* it drives **destructive PII purge/anonymisation** that the FR-115 author deliberately deferred ("Cloud Tasks enqueue is out of scope for this implementation"). Per global guideline §9 ("do not silently resolve genuine ambiguity"), this is surfaced for an explicit decision rather than invented in a review pass.
  - **#3 CI/CD:** GitHub Actions vs. Cloud Build is a real choice (deploy target is GCP; repo is on GitHub), and it is net-new infra rather than a code defect.

  Resolution: fix the unambiguous CRITICAL (#1) now; surface #2 and #3 with a recommendation. No domain-vs-domain fix conflicts were found.

---

## 6. Remediation Log

| Finding | Fix | Files | Verification |
| --- | --- | --- | --- |
| #1 CRITICAL — duplicate V3 | Renamed `V3__widen_documents_file_type.sql` → `V6__…` (kept doc-referenced scoring seed at V3; `widen` is a standalone metadata-only `ALTER` with no dependency on V3–V5 and no filename references in code/tests/docs). Updated the file's internal header comment to match. | `docs/data-model/migrations/V6__widen_documents_file_type.sql` (renamed via `git mv`) | `ls` confirms V1–V6 unique → `validateOnMigrate` passes. No TS/code changed; 2233-test baseline unaffected. |

---

## 7. Aggregate Gate Scorecard

```
Guardrails Pre-Check:     CLEAN (clean tree; folded into Coding-Standards)
Coding Standards Review:  COMPLIANT          (1 P3)
UI Review:                GO                 (substance PASS; P3/P4 only)
Quality Review:           SOLID              (1 P2, rest P3)
Security Review:          SECURE             (1 P3)
Infra Review:             CONDITIONAL        (P0 FIXED; 2 P1 deferred; P2/P3)
BRD Coverage:             COMPLIANT (reused) (49/49 DONE)
Sanity Check:             CLEAN

Component Substance:      PASS (0 skeletons)

CONSOLIDATED
  Total findings:   1 CRITICAL, 2 HIGH, 4 MEDIUM, 9 LOW
  Fixed:            1 / 1 CRITICAL  (HIGH deferred to a decision — see §8)
  Remaining:        2 HIGH (decision), 4 MEDIUM, 9 LOW (backlog)
  Commits:          1 (CRITICAL tier)
  Final verdict:    CONDITIONAL
```

---

## 8. Unresolved Findings (decision required)

Both are HIGH but require a product/architecture decision, not a mechanical fix:

### #2 — Wire the autonomous retention sweep (DPDP scheduled purge)
- **Gap:** `RETENTION_CRON_SCHEDULE`/`RETENTION_BATCH_SIZE` are in `environment-contract.md` + `FR-115.md` but absent from `env.schema.ts`; no `InternalTaskGuard`-protected sweep exists. The purge **logic** already exists and is tested (`RetentionEngine.applyRun`) — only the autonomous trigger is missing.
- **Decision needed:** how should a no-user sweep scope orgs? (a) global all-orgs (`SELECT DISTINCT org_id` → loop `applyRun`, mirroring how `SlaEngine.sweep` runs system-wide), or (b) single configured org per deployment.
- **Remediation once decided (mirrors `sla-sweep`):** add `POST /internal/retention/run` (`@Public()` + `InternalTaskGuard`), add the two env vars to `env.schema.ts`, add a sweep method to the engine, register the controller, add a spec; drive it from Cloud Scheduler → Cloud Tasks.

### #3 — Add CI/CD
- **Gap:** no `.github/workflows` or `cloudbuild.yaml`; releases are manual.
- **Decision needed:** GitHub Actions (repo is on GitHub) or Cloud Build (matches the GCP deploy target)? Build+test-only to start, or include image build + Cloud Run deploy (the latter needs the `project.config.yaml` TODOs filled first)?
- **Note:** a build+test workflow is CI-safe — `npm run test -w @lms/api` is plain `jest` (unit, mocked); Testcontainers integration tests run only under the separate `test:e2e` config, so no Docker/Postgres service is required in CI.

---

## 9. Final Verdict

**CONDITIONAL.**

The deploy-blocking CRITICAL (duplicate Flyway version) is **fixed**. Every domain is positive — SECURE, SOLID, GO, COMPLIANT, COMPLIANT — with **zero skeleton components** and the full 2233-test suite green. Infra remains **CONDITIONAL** on two HIGH items that are deliberately surfaced for a decision (autonomous retention sweep; CI/CD) plus the expected `project.config.yaml` pre-deploy TODOs, and a short MEDIUM/LOW polish backlog. None of the remaining items block the application from building, running, or being deployed manually.
