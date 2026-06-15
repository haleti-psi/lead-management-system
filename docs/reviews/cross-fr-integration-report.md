# Cross-FR Integration Review
*Date: 2026-06-15 | Scope: ~35 FRs built across 15 modules | Branch: feature/FR-092 (chain off master)*

---

## ⟳ REFRESH — 2026-06-15 (Stage 9, all 49 FRs merged · API 1814 / web 269)

**Verdict: PASS** (0 CRITICAL, 0 HIGH). This full re-run across all 49 FRs on `master` supersedes the interim pass below (~35 FRs). The Dev-3 bucket (M9 LOS, M11 engagement, M12 compliance, M13 reporting) introduced four new owner-writes findings; all are resolved:

| Finding | Severity | Resolution |
|---|---|---|
| C1 — `RetentionEngine` wrote `leads` directly | CRITICAL | **Fixed** — routed via new `LeadService.softDeleteForRetention` (version bump; §11.2). |
| H3 — `RetentionEngine` writes 6 PII tables it doesn't own | HIGH | **Sanctioned exemption** — documented as a privileged DPDP-erasure writer (architecture §11.6), like the §11.4 `AuditChainConsumer`: pure PII-nulling, single scheduled actor, atomic per-lead tx, hold/DRR/grievance-excluded. |
| H4 — `communication_templates` dual-writer (FR-131 generic master + FR-101) | HIGH | **Fixed** — removed `communication-templates` from `MASTER_SLUGS`/`MASTER_DESCRIPTORS`; M11 `TemplateService` is sole writer. |
| H5 — `retention_policies` dual-writer (FR-131 + FR-115) | HIGH | **Fixed** — removed `retention-policies` from the generic master; M12 `RetentionPolicyController` is sole writer. |
| M5 — `grievances` two INSERT paths (M7 intake + M12 lifecycle) | MEDIUM | **Accepted seam** — the self-service intake INSERT is complete (code-gen + SLA + outbox + audit in one UoW); M12 owns every lifecycle UPDATE. Documented like `consent_records`. |
| M7 — `data_sharing_logs` written by M8 KYC + M12 | MEDIUM | **Accepted seam** — the KYC share-log INSERT requires a mandatory `consent_id` (consent linkage structurally enforced); M12 `DataSharingService` owns the general path. |
| M8 — grievance-escalation job `@Public()` without app-layer guard | MEDIUM | **Fixed** — added `@UseGuards(InternalTaskGuard)` + `@SkipThrottle()` (matches every other internal job). |
| M10 — `TASK_OVERDUE` event undeliverable (enum missing) | MEDIUM | **Fixed** — added `TASK_OVERDUE` to the `event_code` enum (migration V5 + `@shared` + generated types) and wired the overdue-sweep outbox emit. |

The owner-writes matrix is otherwise clean (`leads` sole-writer + optimistic lock intact; `audit_logs`/`event_outbox` single-writer; M9 `los_application_mirrors`/`eligibility_snapshots` and M13 `export_jobs` single-writer). State machines, auth-guard coverage, outbox-in-tx, and port-based external I/O all hold. No FR is left only-specced; §14.7 integration/e2e coverage is mapped for the deferred test wave (Phase 2).

The carried MEDIUM seams (M1 sla_policies activator, M2 consent_records 3-writer, M3 tasks) remain documented/accepted. Detailed analysis retained below for the audit trail.

---

> **Interim review.** The strict trigger ("all FRs `merged`") is **not** met — the project is mid-Stage-7. Wave 1 (foundation) is on `master`; Waves 2–5 are partially built and chained on `feature/FR-092`. This pass covers every FR with generated code present in the working tree. Re-run after the remaining FRs and the deferred integration-test wave land.

> **Update 2026-06-15 — H1 and H2 resolved.** Both HIGH findings have been fixed and verified (API `tsc` clean; 1083 tests pass). H1: `partners` removed from the FR-131 master registry — `PartnerService` (FR-090) is now the sole writer. H2: `lead_identities` enrichment moved to the capture-owned `LeadIdentityRepository.enrich()`, called by KYC through the `@Global` CaptureModule seam. Details in the findings below and `AMBIGUITY.md › XFR-H1/H2`. **Effective verdict now: PASS** (0 CRITICAL, 0 HIGH; 4 MEDIUM tracked).

## Executive Summary

**Verdict: CONDITIONAL** at first pass → **PASS after the H1/H2 fixes (2026-06-15).** Zero CRITICAL conflicts. The architecture's two load-bearing safety mechanisms are present and working as designed:

- **Single-writer + optimistic concurrency on `leads`.** Only `LeadService` writes `leads`; every mutator takes `expectedVersion` and updates `... WHERE version = $expected` (`apps/api/src/modules/capture/lead.service.ts:356,408,…`), throwing `CONFLICT` on a stale read. The classic "two FRs race a status transition and both succeed on a stale read" failure mode is eliminated structurally — no `SELECT FOR UPDATE` gaps because there is exactly one writer and a version guard.
- **Uniform auth.** Every controller carries `@Requires(capability, scope)` or an explicit `@Public()` with a documented alternate guard (token/OTP/internal-signature). No route reaches a handler unguarded.

The findings below are all **owner-writes seams** — tables written by more than one module. None is a runtime race; each is a known boundary where a second module reaches into another's table. Two are HIGH (should be resolved before release), the rest are documented technical debt already tracked in `manifest.json` / `AMBIGUITY.md`.

## Inventory Matrix

### Tables written by 2+ modules (the cross-FR surface)
| Table | Writers (module / file) | Assessment |
|-------|--------------------------|------------|
| `leads` | **capture/lead.service.ts only** | ✅ Clean — sole writer + optimistic lock |
| `partners` | admin/master/descriptors.ts (FR-131) · partner/partner.repository.ts (FR-090) · partner/partner-quality.repository.ts (FR-092) | ⚠️ **H1** |
| `lead_identities` | capture/lead-identity.repository.ts (create) · kyc/kyc-verification.repository.ts:259 (update) | ⚠️ **H2** |
| `sla_policies` | engagement/sla-policy.repository.ts (FR-104, owner) · admin/activators/sla-policy.activator.ts (FR-132, `is_active` toggle) | ▫️ **M1** (documented seam) |
| `consent_records` | capture/capture.service.ts:313 (initial, append-only) · compliance/consent.repository.ts (lifecycle) | ▫️ **M2** (append-only) |
| `configuration_versions` | admin/config-governance · admin/master/admin-master · product-config · engagement/sla-policy | ✅ By design — append-only governance ledger, each config owner inserts its own version row |
| `users` | admin/user.repository.ts (profile) · identity/auth.repository.ts (login fields) | ✅ Column-partitioned, no overlap |
| `tasks` | self-service/status.repository.ts:99 (FR-062) only | ▫️ **M3** (no formal owner module yet) |

### State machines → FRs that transition them
| Entity | Transitioning FRs | Assessment |
|--------|-------------------|------------|
| `lead.stage` | capture (create→captured), allocation (→assigned), dedupe, kyc, workspace bulk-action | ✅ All funnel through `LeadService` mutators with version guard + `StageGuardService` |
| `customer_links.status` | self-service/customer-link.repository.ts only | ✅ Single writer |
| `kyc_verifications.status` / `documents.status` | kyc module only | ✅ Single writer |
| `configuration_versions.status` | governance (approve/rollback) + per-owner activators | ✅ Maker-checker, serialized in governance tx |

### External services → FRs that call them
All external I/O is funnelled through `core/integration` (`IntegrationGateway` + ports: `LosPort`, KYC, `gcs.port`, `virus-scan.port`, captcha, cloud-tasks). No module calls an external SDK directly; rate-limit/error-handling policy is centralized in the gateway and its adapters. ✅ No divergent retry/timeout behaviour, no shared-credential clobbering.

## Conflicts Found

### CRITICAL — must fix before merge to main
None.

### HIGH — should fix before release

> **Both HIGH items below were RESOLVED on 2026-06-15** (see the ✅ note under each). Original analysis retained for the audit trail.

**H1 — `partners` is written by three modules with potentially divergent rules.**
- FR-131 generic master admin: `apps/api/src/modules/admin/master/descriptors.ts:550` (insert), `:576` (update)
- FR-090 dedicated partner CRUD: `apps/api/src/modules/partner/partner.repository.ts:114` (insert), `:147` (update)
- FR-092 quality cache: `apps/api/src/modules/partner/partner-quality.repository.ts:149` (update `quality_score`)
- **Risk:** `POST/PATCH /admin/partners/...` (generic master) and `POST/PATCH /partners` (FR-090) can both create/mutate a partner with independent validation and status-transition logic. They can diverge (e.g. FR-090's `PARTNER_STATUS_TRANSITIONS` guard is not applied by the generic master path), allowing a partner to reach a state FR-090 forbids. The FR-092 `quality_score` write is a narrow, non-conflicting single-column cache and is fine.
- **Fix:** Designate one owner. Either (a) remove `partners` from the FR-131 master registry and route all partner writes through `PartnerService`, or (b) make the FR-131 descriptor delegate to `PartnerService` so the status-transition guard and validation run once. Record the decision in `AMBIGUITY.md` and the partner LLD. *(Already flagged in `manifest.json › stage7.cross_fr_review_items`.)*
- **✅ RESOLVED 2026-06-15 (option a):** Removed `partners` from `MASTER_SLUGS` + `MASTER_DESCRIPTORS` (`master.constants.ts`, `descriptors.ts`) and deleted the dead `PartnerDescriptor`/`toPartnerView`/`dto/partner.dto.ts`. `PartnerService` (FR-090) is the sole writer; all partner writes now run the status-transition machine + ADMIN/HEAD gate. Verified: tsc clean, 1083 tests pass. See `AMBIGUITY.md › XFR-H1`.

**H2 — `lead_identities` is written cross-module (owner-writes deviation).**
- Created by capture: `apps/api/src/modules/capture/lead-identity.repository.ts:28`
- Updated by KYC: `apps/api/src/modules/kyc/kyc-verification.repository.ts:259` (`updateLeadIdentity`, sets verified flags during KYC)
- **Risk:** `lead_identities` is a capture-owned entity; the KYC module mutating it directly violates the owner-writes non-negotiable (only the owning module's service writes its entity). It is correctly inside the KYC verification transaction (atomic), so there is no integrity race — the issue is architectural ownership, not concurrency.
- **Fix:** Expose a `LeadIdentityService.markVerified(...)` mutator on the capture module and have KYC call it through that seam (mirrors how FR-091 reuses `CaptureService.createLead` and how FR-132 plans to delegate `sla_policies`). If the KYC LLD (FR-072) explicitly sanctions the direct write, downgrade to MEDIUM and record the exemption in the LLD.
- **✅ RESOLVED 2026-06-15:** Added `LeadIdentityRepository.enrich(...)` to capture (M2) and exported it from the `@Global` `CaptureModule`; `KycService` now injects it and calls `identities.enrich(...)` inside the existing KYC transaction (same pattern as `LeadService.setKycStatus`). Removed `updateLeadIdentity`/`LeadIdentityPatch` from the KYC repo. Atomicity and behaviour unchanged. Verified: tsc clean, 1083 tests pass. See `AMBIGUITY.md › XFR-H2`.

### MEDIUM — technical debt, fix in next sprint

**M1 — `sla_policies` toggled by the FR-132 activator, not its M11 owner.** `apps/api/src/modules/admin/activators/sla-policy.activator.ts:52` flips `is_active` because FR-104 exposes no owner mutator yet. The seam is explicitly documented in that file's header ("when M11 later exposes an owner mutator this class is the one place to delegate it"). Atomic within the governance tx. Resolve when M11 grows an `activate`/`deactivate` API.

**M2 — `consent_records` written by capture and compliance.** Capture inserts the *initial* consent rows at lead creation (`capture.service.ts:313`, append-only, comment: "FR-110 owns the later lifecycle"); compliance owns the ongoing ledger. Append-only on both sides → no update conflict. Confirm FR-110's lifecycle writes never UPDATE rows capture inserted in a way that re-derives state; otherwise leave as-is.

**M3 — `tasks` has no formal owner module.** FR-062 (`self-service/status.repository.ts:99`) is the de-facto sole writer. Fine while it stays the only writer; assign ownership before a second FR (e.g. an engagement task module) starts writing it. *(Tracked in `AMBIGUITY.md`.)*

**M4 — error-code construction style inconsistency (cosmetic).** A few sites pass string literals instead of the `ERROR_CODES.*` const: `core/outbox/outbox.service.ts` (`'INTERNAL_ERROR'`), `core/integration/adapters/cloud-tasks-retry-queue.adapter.ts` (`'UPSTREAM_UNAVAILABLE'`). Both codes are valid taxonomy entries, so this is **not** error-code drift — just a consistency nit. Optionally normalize to the const.

## Clean Checks (audit trail)

- ✅ **`leads` owner-writes:** sole writer is `LeadService`; verified no `insertInto('leads')`/`updateTable('leads')` outside `capture/lead.service.ts`.
- ✅ **Optimistic concurrency:** lead mutators guard on `version = expectedVersion` and throw `CONFLICT` — eliminates lost-update/stale-transition races without table locks.
- ✅ **Auth coverage:** every `@Controller` route has `@Requires(...)` or `@Public()`; all `@Public()` controllers (`auth`, `public/leads`, `c/:token*` customer, `internal/sla`, `internal/documents`) pair with a documented token/OTP/internal-signature guard. No unguarded handlers.
- ✅ **Error-code taxonomy:** all `DomainException` codes used resolve to entries in `docs/contracts/error-taxonomy.md` (VALIDATION_ERROR, FORBIDDEN, NOT_FOUND, CONFLICT, AUTH_REQUIRED, RATE_LIMITED, INTERNAL_ERROR, UPSTREAM_UNAVAILABLE, UNSUPPORTED_MEDIA, PAYLOAD_TOO_LARGE, plus the domain detail-codes). No invented codes.
- ✅ **External-service centralization:** no direct external SDK calls outside `core/integration`; single retry/timeout/error policy via the gateway and adapters.
- ✅ **`configuration_versions` multi-writer:** intentional append-only governance ledger; each config owner inserts its own version row, status changes serialized through maker-checker.

## Verdict

**PASS (after the 2026-06-15 fixes)** — zero CRITICAL, zero HIGH (H1 and H2 both resolved and verified), 4 MEDIUM remaining as known, tracked debt. *(First-pass verdict was CONDITIONAL with 2 HIGH.)* Re-run this review (strict mode) once all FRs are `merged` and the deferred Testcontainers integration/e2e wave has run, since several cross-FR scenarios (capture↔dedupe↔allocation↔KYC end-to-end) need the DB harness to exercise the transaction boundaries this static pass can only inspect.
