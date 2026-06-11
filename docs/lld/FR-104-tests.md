# Test Specification: FR-104 — SLA Configuration & Escalation Engine
*Tier: 3 | Source LLD: docs/lld/FR-104.md*

Every scenario must have a passing test before FR-104 can be merged. Codes are from `docs/contracts/error-taxonomy.md` (VALIDATION_ERROR=400, FORBIDDEN=403, CONFLICT=409, AUTH_REQUIRED=401). Stack per `testing-contract.md`: Jest+supertest (API), Jest (unit), Vitest+Testing-Library (UI), Playwright (e2e), Testcontainers-Postgres.

## Test Cases

| TC | Scenario | Type | Input | Expected Outcome |
|----|----------|------|-------|------------------|
| TC-001 | Happy — ADMIN creates SLA policy | Integration | Valid `CreateSlaPolicyDto`, ADMIN token | 201; `sla_policies` row with `is_active=false`; `configuration_versions` row `status='pending'`, `config_type='sla_policy'`, `maker_id=actor`; `audit_logs(config_change)` written; envelope `{data,meta,error:null}` |
| TC-002 | Happy — list policies (scope A) | Integration | GET, HEAD token, `?applies_to=first_contact&page=1&limit=25` | 200; only active+matching rows for org; pagination meta; `limit` capped at 100 |
| TC-003 | List scoped to branch (scope B) | Integration | GET, BM token | 200; results filtered to BM's org/branch scope; no cross-org rows |
| TC-004 | Unauthenticated | Integration | POST, no Authorization header/cookie | 401 `AUTH_REQUIRED`; generic message; no row written |
| TC-005 | No `configuration` capability | Integration | POST, RM token | 403 `FORBIDDEN`; `EntitlementService.can` returns false |
| TC-006 | Insufficient scope for create | Integration | POST, BM/KYC/DPO token (scope B, not A) | 403 `FORBIDDEN` (service-layer `scope==='A'` check) |
| TC-007 | Validation — non-positive threshold | Integration | `threshold_minutes: 0` | 400 `VALIDATION_ERROR`, `fields:[{field:'threshold_minutes'}]`; no row |
| TC-008 | Validation — empty escalation chain | Integration | `escalation_chain: []` | 400 `VALIDATION_ERROR`, field `escalation_chain` |
| TC-009 | Validation — duplicate at_minutes | Integration | two steps with `at_minutes: 240` | 400 `VALIDATION_ERROR`, "Duplicate at_minutes values are not allowed." |
| TC-010 | Validation — reassign not final / duplicated | Integration | `reassign` step not highest `at_minutes`, or two reassign steps | 400 `VALIDATION_ERROR` |
| TC-011 | Validation — invalid `applies_to` / role enum | Integration | `applies_to:'foo'` or `notify_roles:['XYZ']` | 400 `VALIDATION_ERROR` |
| TC-012 | Conflict — duplicate active policy | Integration | same `name`+`applies_to` as an existing active policy | 409 `CONFLICT` |
| TC-013 | Created policy inactive until approval | Integration | create then GET | policy `is_active=false`; activated only by `POST /admin/config/{id}/approve` (FR-132) |
| TC-014 | Engine — business-hours-aware due (unit) | Unit | `SlaEngine.computeDueAt('first_contact', lead)`, now=Fri 17:00, threshold=240, Mon–Sat 09:30–18:30 cal | due = Sat ~12:00 (rolls over closing/weekend/holiday per `BusinessCalendarService.resolve`), not Fri+4h wall-clock |
| TC-015 | Engine — calendar resolution order (unit) | Unit | branch cal, region cal, org default present | resolves branch → region → default; falls back to hardcoded Mon–Sat IST + logs warn when none |
| TC-016 | Engine — setSlaDueAt via LeadService (owner-writes) | Integration | `captured→assigned` in one tx | `leads.sla_first_contact_due_at` set by `LeadService.setSlaDueAt`; `version` bumped; no direct write to `leads` outside LeadService |
| TC-017 | Engine — optimistic lock | Integration | stale `expectedVersion` on setSlaDueAt | 0 rows updated → `CONFLICT` (409) |
| TC-018 | Sweep — breach emits event + reassign | Integration | lead past `sla_first_contact_due_at`, chain has `reassign` | `event_outbox(FIRST_CONTACT_BREACH)` + `LeadService.assignOwner` reassign + `audit_logs(reassign, reason='sla_breach')` all in ONE tx |
| TC-019 | Sweep — approaching emits due | Integration | lead within 30 min of due | `event_outbox(FIRST_CONTACT_DUE)`; no reassign |
| TC-020 | Sweep — idempotent within window | Integration | run sweep twice same minute | exactly one `FIRST_CONTACT_DUE`/`FIRST_CONTACT_BREACH` per lead; no duplicate reassign (owner already target → skip) |
| TC-021 | Sweep — excludes terminal/contacted | Integration | leads in `contacted/rejected/handed_off/dormant` | not selected by approaching/breach scans |
| TC-022 | Sweep — LIMIT enforced | Integration | 250 breached leads | scan returns ≤ 100 per pass (NFR-17) |
| TC-023 | Transaction rollback | Integration | force `audit_logs` insert to fail mid-create | `sla_policies` + `configuration_versions` rolled back; no partial row; `INTERNAL_ERROR` (500) |
| TC-024 | KYC-exception due-at | Integration | `failed→exception` on a kyc_verification | `kyc_verifications.exception_sla_due_at` set by `SlaEngine.setKycExceptionDue` in the KYC tx |
| TC-025 | Grievance due-at | Integration | grievance intake | `grievances.sla_due_at` set by `SlaEngine.setGrievanceDue` |
| TC-026 | Internal sweep endpoint rejects user JWT | Integration | `POST /internal/sla/sweep` with a user JWT | rejected by `InternalTaskGuard` (requires OIDC + Cloud Tasks header), not a user-facing route |
| TC-027 | Post-commit notification failure isolated | Integration | mock `NotificationChannelPort` to fail after breach commit | breach event already committed/published; `communication_logs.status='failed'`; sweep does not roll back; `UPSTREAM_UNAVAILABLE` not surfaced to caller |
| TC-028 | Audit completeness | Integration | create + breach-reassign | `audit_logs` rows for `config_change` and `reassign` present with actor + detail |

## SQL Invariant Queries (Data Integrity)
After any write, these return 0 rows:
```sql
-- No SLA policy with a non-positive threshold (DB CHECK ck_sla_threshold backstop)
SELECT count(*) FROM sla_policies WHERE threshold_minutes <= 0;                -- 0

-- No active SLA policy lacking an approved/active configuration_versions row
SELECT count(*) FROM sla_policies sp
WHERE sp.is_active = true
  AND NOT EXISTS (SELECT 1 FROM configuration_versions cv
                  WHERE cv.config_type='sla_policy' AND cv.config_ref=sp.sla_policy_id
                    AND cv.status IN ('approved','active'));                    -- 0

-- No orphaned sla_policy config_version
SELECT count(*) FROM configuration_versions cv
WHERE cv.config_type='sla_policy'
  AND NOT EXISTS (SELECT 1 FROM sla_policies sp WHERE sp.sla_policy_id = cv.config_ref); -- 0

-- updated_at never before created_at
SELECT count(*) FROM sla_policies WHERE updated_at < created_at;                -- 0

-- No FIRST_CONTACT_* outbox event for a lead in a terminal/contacted stage
SELECT count(*) FROM event_outbox e JOIN leads l ON l.lead_id = e.aggregate_id
WHERE e.event_code IN ('FIRST_CONTACT_DUE','FIRST_CONTACT_BREACH')
  AND l.stage IN ('contacted','rejected','handed_off','dormant')
  AND e.created_at > l.updated_at;                                             -- 0 (best-effort window check)
```

## UI Test Scenarios
| TC | Page/Component | Action | Expected |
|----|----------------|--------|----------|
| TC-UI-001 | SLAPolicyListPage | Load as ADMIN | DataTable renders; StatusChip shows Active/Pending Approval; LoadingSkeleton then data |
| TC-UI-002 | SLAPolicyListPage | Load with no policies | EmptyState with "New Policy" CTA |
| TC-UI-003 | SLAPolicyFormDrawer | Submit threshold=0 | inline field error (aria-describedby), form not submitted |
| TC-UI-004 | EscalationChainEditor | Add 2 steps with same at_minutes, submit | inline duplicate error |
| TC-UI-005 | SLAPolicyFormDrawer | Submit valid | ConfirmDialog ("enters maker-checker"), then success Toast, list refetches |
| TC-UI-006 | EscalationChainEditor | Reorder steps via keyboard | arrow-key reorder works; focus visible |
| TC-UI-007 | SLAPolicyListPage | Non-ADMIN/HEAD (BM) view | read-only; no create/deactivate actions |

## Coverage Checklist
- [ ] Happy path (create + list) tested
- [ ] All named error codes tested (400, 401, 403, 409, 500)
- [ ] Auth check: capability present (ADMIN) and absent (RM); scope A vs B for POST
- [ ] Validation: required fields, threshold>0, non-empty chain, duplicate at_minutes, reassign-position
- [ ] Conflict: duplicate active policy
- [ ] Maker-checker: created policy inactive until FR-132 approval
- [ ] Engine unit: business-hours/holiday/weekend due computation; calendar resolution order + fallback
- [ ] Owner-writes: `leads` written only via `LeadService.setSlaDueAt`; optimistic-lock CONFLICT
- [ ] Sweep: approaching + breach events; reassign on breach; LIMIT≤100; terminal-stage exclusion
- [ ] Idempotency: repeat sweep produces no duplicate events/reassign
- [ ] Transaction rollback on mid-write failure (no partial state)
- [ ] Cross-target due-at: KYC exception + grievance
- [ ] Internal sweep endpoint rejects user JWT (OIDC/InternalTaskGuard)
- [ ] Post-commit notification failure does not roll back the breach
- [ ] SQL invariant queries defined
