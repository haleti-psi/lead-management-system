# FR-115: Data Retention, Purge & Anonymisation Engine — Test Specification

**Tier: 3**
**Source LLD:** `docs/lld/FR-115.md`

---

## Test Cases

| # | Layer | Description | Inputs | Expected outcome |
|---|---|---|---|---|
| T01 | Unit | `RetentionEngine.dryRun` counts eligible leads correctly | 5 leads past cutoff; 1 within window | `preview.eligible_leads = 5`; lead within window not counted |
| T02 | Unit | Legal-hold policy blocks all leads for that category | `retention_policy.legal_hold = true` for `identity`; 3 identity-category candidates | `preview.blocked_by_legal_hold = 3`; `eligible_leads = 0` for identity |
| T03 | Unit | Open `DataRightsRequest` blocks specific lead | 10 candidates; 2 have `data_rights_requests.status = 'open'` | Those 2 excluded from eligible set; `preview.blocked_by_open_request = 2` |
| T04 | Unit | Open `Grievance` blocks specific lead | Lead has `grievances.status = 'in_progress'` | Lead excluded from eligible set |
| T05 | Unit | Anonymisation of `identity` category zeroes PII fields | Eligible lead with `lead_identities.name = 'John Doe'`, `mobile = '9876543210'` | After apply: `name = 'ANONYMISED'`, `mobile = '0000000000'`, `email = NULL`, `pan_token = NULL`, `dob = NULL`, `aadhaar_ref_token = NULL` |
| T06 | Unit | Purge of `kyc_doc` category sets `documents.deleted_at` and nullifies `storage_ref` | Lead with 2 documents having `storage_ref` set | Both documents have `deleted_at IS NOT NULL`, `storage_ref IS NULL` after purge |
| T07 | Unit | `consent_records` are never touched by any retention action | Lead with `consent_records` rows; policy `action=anonymise` over all categories | `consent_records` row count and content unchanged |
| T08 | Unit | `audit_logs` rows for the lead are never modified or deleted | Lead with 5 existing `audit_logs` rows | Count remains 5; no field values changed |
| T09 | Unit | A mid-batch DB failure rolls back only that lead's transaction | Forced DB error on 3rd of 5 leads in batch | Leads 1, 2 committed; lead 3 rolled back (no partial state); leads 4, 5 committed; error logged with `correlation_id` |
| T10 | Unit | Dry-run produces no DB writes | `mode = 'dry_run'` with 10 eligible leads | Zero rows changed in any table; preview counts returned |
| T11 | API | `GET /admin/retention-policies` — DPO sees all policies paginated | DPO JWT; 7 policies seeded | 200; `data.length ≤ 25`; `meta.total = 7` |
| T12 | API | `GET /admin/retention-policies` — RM receives 403 | RM JWT | 403, `error.code = FORBIDDEN` |
| T13 | API | `GET /admin/retention-policies` — unauthenticated receives 401 | No Authorization header | 401, `error.code = AUTH_REQUIRED` |
| T14 | API | `POST /admin/retention-policies` — ADMIN creates valid policy | ADMIN JWT; `{ data_category: "identity", retain_days: 365, action: "anonymise" }` | 201; response body contains `retention_policy_id`, `is_active: true` |
| T15 | API | `POST /admin/retention-policies` — DPO is forbidden from creating | DPO JWT; valid body | 403, `error.code = FORBIDDEN` |
| T16 | API | `POST /admin/retention-policies` — `retain_days < 0` fails validation | ADMIN JWT; `{ retain_days: -1, data_category: "identity", action: "purge" }` | 400, `error.code = VALIDATION_ERROR`; `error.fields` contains `retain_days` |
| T17 | API | `POST /admin/retention-policies` — invalid `data_category` fails validation | ADMIN JWT; `{ data_category: "PII", retain_days: 30, action: "purge" }` | 400, `error.code = VALIDATION_ERROR`; `error.fields` contains `data_category` |
| T18 | API | `POST /admin/retention-policies` — consent category rejected | ADMIN JWT; `{ data_category: "consent", retain_days: 0, action: "purge" }` | 400, `error.code = VALIDATION_ERROR`; error message references consent exemption |
| T19 | API | `POST /admin/retention/run` dry-run — DPO succeeds | DPO JWT; `{ mode: "dry_run" }` | 202; `data.mode = "dry_run"`; `data.preview.eligible_leads >= 0` |
| T20 | API | `POST /admin/retention/run` apply — DPO is forbidden | DPO JWT; `{ mode: "apply" }` | 403, `error.code = FORBIDDEN` |
| T21 | API | `POST /admin/retention/run` apply — ADMIN succeeds and enqueues job | ADMIN JWT; `{ mode: "apply" }` | 202; `data.run_id` is a UUID; `data.status = "queued"` |
| T22 | API | `POST /admin/retention/run` — invalid mode fails | ADMIN JWT; `{ mode: "live" }` | 400, `error.code = VALIDATION_ERROR`; `error.fields` contains `mode` |
| T23 | API | `POST /admin/retention/run` dry-run scoped to category | ADMIN JWT; `{ mode: "dry_run", data_category: "kyc_doc" }` | 202; `data.preview.by_category` contains only `kyc_doc` entries |
| T24 | Integration | Full apply-run: eligible `identity` lead anonymised and audit logged | Testcontainers Postgres; 1 eligible lead (rejected > 365 days ago); 1 active `identity/anonymise` policy | `lead_identities.name = 'ANONYMISED'`; `audit_logs` has 1 new row with `detail.action_taken = 'anonymise'` and `lead_id` matching; `consent_records` unchanged |
| T25 | Integration | Apply-run skips lead with open DRR; processes eligible sibling | 2 leads past cutoff; 1 has `data_rights_requests.status = 'open'` | Sibling anonymised; DRR lead untouched; audit logs 1 new row (sibling only) |
| T26 | Integration | Apply-run skips lead with open Grievance | Lead has `grievances.status = 'open'` | Lead's PII fields unchanged after run |
| T27 | Integration | Apply-run never deletes or modifies `audit_logs` rows | Lead with 3 pre-existing `audit_logs` rows; `kyc_doc/purge` policy applied | Pre-existing `audit_logs` rows intact (count = 3 + new retention audit row) |
| T28 | Integration | Apply-run never modifies `consent_records` (append-only invariant) | Lead with 2 `consent_records`; any policy applied | `consent_records` row count = 2; no UPDATE executed on the table |
| T29 | Integration | Rate limit applies to mutation endpoints | ADMIN; 61 `POST /admin/retention-policies` requests in 1 minute | 61st request → 429, `error.code = RATE_LIMITED` |
| T30 | E2E | DPO opens Retention Admin page, runs dry-run, sees preview | DPO login; policies seeded; dry-run triggered | Preview panel shows counts; no data modified |

---

## SQL Invariant Queries

Run after every apply-mode test. Each must return **0 rows**.

```sql
-- INV-01: consent_records must never be modified (compare count before and after; always net-append-only)
-- This is enforced by the append-only DB REVOKE; if any UPDATE was issued on consent_records, the tx would fail.
-- Additional check: no consent_record row has updated_at > created_at (no trigger sets updated_at on append-only tables)
SELECT consent_id FROM consent_records WHERE updated_at > created_at;

-- INV-02: audit_logs must never be modified or deleted
-- (checked via DB REVOKE; additional application-level check below)
-- Verify: every audit_log row for a retention-processed lead still exists
SELECT al.audit_id
FROM audit_logs al
WHERE al.lead_id IN (/* set of processed lead_ids */)
  AND al.created_at < NOW() - INTERVAL '1 second'  -- pre-existing rows
  AND al.detail->>'action_taken' IS DISTINCT FROM 'anonymise'
  AND al.detail->>'action_taken' IS DISTINCT FROM 'purge'
-- Expect: pre-existing audit rows for the lead are untouched (only new rows added)
;

-- INV-03: stage_history must never be modified
SELECT sh.stage_history_id
FROM stage_history sh
JOIN leads l ON l.lead_id = sh.lead_id
WHERE l.deleted_at IS NOT NULL  -- processed lead
  AND sh.updated_at > sh.created_at
;

-- INV-04: no partial anonymisation — if lead_identities.name = 'ANONYMISED' then pan_token must also be NULL
SELECT li.lead_identity_id
FROM lead_identities li
WHERE li.name = 'ANONYMISED'
  AND (li.pan_token IS NOT NULL OR li.aadhaar_ref_token IS NOT NULL OR li.dob IS NOT NULL)
;

-- INV-05: legal-hold leads never anonymised/purged
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE li.name = 'ANONYMISED'
  AND EXISTS (
    SELECT 1 FROM retention_policies rp
    WHERE rp.legal_hold = true AND rp.is_active = true
  )
;

-- INV-06: leads with open DataRightsRequests never anonymised
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE li.name = 'ANONYMISED'
  AND EXISTS (
    SELECT 1 FROM data_rights_requests drr
    WHERE drr.lead_id = l.lead_id AND drr.status IN ('open', 'in_review')
  )
;

-- INV-07: leads with open Grievances never anonymised
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE li.name = 'ANONYMISED'
  AND EXISTS (
    SELECT 1 FROM grievances g
    WHERE g.lead_id = l.lead_id AND g.status IN ('open', 'in_progress', 'escalated')
  )
;

-- INV-08: every anonymisation has a corresponding audit_log entry
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE li.name = 'ANONYMISED'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.lead_id = l.lead_id
      AND al.detail->>'action_taken' IN ('anonymise', 'purge')
  )
;
```

---

## UI Test Scenarios (Playwright)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| UI-01 | DPO can navigate to Retention Admin page | Log in as DPO; click Compliance > Retention in nav | Page loads; DataTable with policy rows visible |
| UI-02 | RM cannot access Retention Admin page | Log in as RM; navigate to `/compliance/retention` | Redirected to 403 / access-denied page |
| UI-03 | DPO can trigger dry-run and see preview | Click "Trigger Run"; select `mode=dry_run`; submit | DryRunPreviewPanel appears with `eligible_leads`, `blocked_by_legal_hold`, `blocked_by_open_request` counts; no Toast error |
| UI-04 | ADMIN can create a new policy | Log in as ADMIN; click "+ New Policy"; fill form (identity, rejected, 365, anonymise); confirm dialog; submit | New row appears in DataTable; Toast success shown |
| UI-05 | Consent category is rejected in form | ADMIN; open New Policy drawer; select `data_category = consent`; submit | Inline validation error on `data_category` field; form does not submit |
| UI-06 | DPO sees disabled apply button in Trigger Run modal | DPO; open Trigger Run modal; select `mode=apply` | Apply button is disabled or absent for DPO role |

---

## Coverage Checklist

- [x] Happy path — policy list paginated (T11)
- [x] Happy path — policy creation (T14)
- [x] Happy path — dry-run with preview (T19)
- [x] Happy path — apply-run enqueues job (T21)
- [x] Happy path — full anonymisation and audit (T24)
- [x] `VALIDATION_ERROR` 400 — `retain_days < 0` (T16)
- [x] `VALIDATION_ERROR` 400 — invalid `data_category` (T17)
- [x] `VALIDATION_ERROR` 400 — consent category (T18)
- [x] `VALIDATION_ERROR` 400 — invalid mode (T22)
- [x] `FORBIDDEN` 403 — RM on list (T12)
- [x] `FORBIDDEN` 403 — DPO on create (T15)
- [x] `FORBIDDEN` 403 — DPO on apply (T20)
- [x] `AUTH_REQUIRED` 401 — unauthenticated (T13)
- [x] `RATE_LIMITED` 429 — mutation rate limit (T29)
- [x] Legal-hold exclusion (T02, T05, INV-05)
- [x] Open DataRightsRequest exclusion (T03, T25, INV-06)
- [x] Open Grievance exclusion (T04, T26, INV-07)
- [x] consent_records never touched — append-only (T07, T28, INV-01)
- [x] audit_logs never modified — append-only (T08, T27, INV-02)
- [x] stage_history never modified — append-only (INV-03)
- [x] Transaction rollback on mid-batch failure (T09)
- [x] Dry-run zero writes (T10)
- [x] Audit log written for every processed lead (INV-08)
- [x] No partial anonymisation state (INV-04)
- [x] Authz negative — out-of-role reads denied (T12, T13, UI-02)
- [x] Scoped dry-run by category (T23)
- [x] UI dry-run preview rendered (UI-03, T30)
- [x] UI consent category form validation (UI-05)
- [x] UI DPO cannot access apply (UI-06)
