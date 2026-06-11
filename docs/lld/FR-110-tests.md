# FR-110: Purpose-wise Consent Ledger — Test Specification

**Tier: 2** | Source LLD: `docs/lld/FR-110.md`

---

## Test Cases

| # | Layer | Test name | Scenario | Expected result |
|---|---|---|---|---|
| T01 | API | `POST /leads/{id}/consents creates granted record and returns 201` | RM posts valid `{ purpose: "lead_contact", state: "granted", notice_version: "v1.0", consent_text_version: "v1.0" }` for their own lead | 201; `consent_id` returned; `consent_records` row exists with `state = 'granted'`, `actor = 'rm'`; `leads.consent_status` re-derived and updated; `audit_logs` row with `action = 'CONSENT_CAPTURED'` exists |
| T02 | API | `POST /leads/{id}/consents creates withdrawn record and emits outbox event` | RM posts `{ purpose: "lead_contact", state: "withdrawn", notice_version: "v1.0", consent_text_version: "v1.0" }` after a prior `granted` row exists | 201; new `consent_records` row with `state = 'withdrawn'`; `event_outbox` row with `event_code = 'CONSENT_WITHDRAWN'` and `payload.purpose = 'lead_contact'` inserted in same transaction; `leads.consent_status` re-derived to `'withdrawn'` |
| T03 | API | `POST /leads/{id}/consents supersedes prior granted record` | Two sequential POSTs for same `(lead_id, purpose: "kyc")` both with `state: "granted"` | After second POST: first `consent_records` row has `superseded_by = second_consent_id`; second row has `superseded_by = null`; `leads.consent_status` reflects most recent derivation |
| T04 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when purpose is not a valid enum value` | Payload contains `purpose: "invalid_purpose"` | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "purpose" }`; no `consent_records` row inserted |
| T05 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when notice_version is absent` | Payload omits `notice_version` | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "notice_version" }`; no row inserted |
| T06 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when consent_text_version is absent` | Payload omits `consent_text_version` | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "consent_text_version" }`; no row inserted |
| T07 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when state is expired` | Payload contains `state: "expired"` | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "state" }`; message includes "expired"; no row inserted |
| T08 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when state is superseded` | Payload contains `state: "superseded"` | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "state" }`; no row inserted |
| T09 | API | `POST /leads/{id}/consents returns VALIDATION_ERROR when withdrawing a purpose never granted` | Payload `{ purpose: "los_handoff", state: "withdrawn" }`; no prior `granted` row for `(lead_id, "los_handoff")` | 400 `VALIDATION_ERROR`; message includes "Cannot withdraw consent that was never granted"; no row inserted |
| T10 | API | `POST /leads/{id}/consents returns FORBIDDEN when RM posts for another RM's lead` | RM-A calls POST with `lead_id` owned by RM-B (different `owner_id`) | 403 `FORBIDDEN`; no row inserted |
| T11 | API | `POST /leads/{id}/consents returns FORBIDDEN when PARTNER posts for another partner's lead` | PARTNER-A calls POST for a lead attributed to PARTNER-B | 403 `FORBIDDEN`; no row inserted |
| T12 | API | `POST /leads/{id}/consents returns NOT_FOUND for unknown lead_id` | Valid UUID with no matching lead in the org | 404 `NOT_FOUND`; no row inserted |
| T13 | API | `POST /leads/{id}/consents returns AUTH_REQUIRED with no JWT` | Request made without `Authorization` header | 401 `AUTH_REQUIRED` |
| T14 | API | `GET /leads/{id}/consents returns paginated consent history` | Lead has 30 `consent_records` rows; RM calls GET with no filters | 200; `data` array length 25 (default page size); `meta.pagination.total = 30`; records ordered by `created_at` asc |
| T15 | API | `GET /leads/{id}/consents filters by purpose` | Lead has records for `lead_contact` and `kyc`; query `?purpose=kyc` | 200; only `kyc` purpose rows returned |
| T16 | API | `GET /leads/{id}/consents filters by state` | Lead has `granted` and `withdrawn` records; query `?state=withdrawn` | 200; only `state = 'withdrawn'` rows returned |
| T17 | API | `GET /leads/{id}/consents returns FORBIDDEN for out-of-scope RM` | RM-A calls GET for a lead owned by RM-B | 403 `FORBIDDEN` |
| T18 | API | `GET /leads/{id}/consents masks ip_device for non-DPO roles` | RM calls GET; consent record has `ip_device` set | 200; `ip_device` field is `null` in response for RM; DPO calling same endpoint sees the actual `ip_device` object |
| T19 | API | `POST /c/{token}/consent customer grants consent via valid token` | `CustomerLinkGuard` resolves active token; customer POSTs `{ purpose: "lead_contact", state: "granted", notice_version: "v1.0", consent_text_version: "v1.0" }` | 201; `consent_records` row with `actor = 'customer'`, `channel` derived from `customer_links.channel`, `ip_device` populated from headers; `leads.consent_status` re-derived |
| T20 | API | `POST /c/{token}/consent returns NOT_FOUND for expired token` | Token exists in `customer_links` but `expires_at` is in the past | 404 `NOT_FOUND` (existence hidden) |
| T21 | API | `POST /c/{token}/consent returns NOT_FOUND for revoked token` | Token exists with `status = 'revoked'` | 404 `NOT_FOUND` |
| T22 | API | `POST /c/{token}/consent returns VALIDATION_ERROR when state is withdrawn` | Customer POSTs `{ state: "withdrawn" }` via micro-site token | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "state" }`; message includes "granted or denied" |
| T23 | API | `POST /c/{token}/consent returns VALIDATION_ERROR when purpose is partner_sharing` | Customer POSTs `{ purpose: "partner_sharing" }` via token path | 400 `VALIDATION_ERROR`; `error.fields` contains `{ field: "purpose" }`; purpose not customer-capturable |
| T24 | API | `POST /c/{token}/consent is rate-limited after threshold` | More than 10 requests per minute from the same IP to the token consent endpoint | 429 `RATE_LIMITED`; `Retry-After` header present |
| T25 | Unit | `ConsentService.deriveConsentStatus returns captured when all required purposes granted` | `latestPerPurpose` map has `lead_contact`, `product_eligibility`, `kyc`, `document_processing`, `los_handoff` all with `state = 'granted'` | Returns `'captured'` |
| T26 | Unit | `ConsentService.deriveConsentStatus returns partial when some required purposes granted` | Map has `lead_contact` and `kyc` granted; `los_handoff` not present | Returns `'partial'` |
| T27 | Unit | `ConsentService.deriveConsentStatus returns withdrawn when any purpose is withdrawn` | Map has all five required purposes granted except `lead_contact` is `withdrawn` | Returns `'withdrawn'` |
| T28 | Unit | `ConsentService.deriveConsentStatus returns pending when no purposes granted` | Map is empty or all purposes have `state = 'denied'` | Returns `'pending'` |
| T29 | Unit | `ConsentService rejects UPDATE on consent_records with FORBIDDEN` | Any code path that calls a repository method for UPDATE on `consent_records` (e.g., calling an imaginary `updateConsent(id, …)`) | Throws `FORBIDDEN` (403) at service layer; never reaches the Kysely query builder |
| T30 | Unit | `UnitOfWork rolls back all writes when LeadService.setConsentStatus throws` | `LeadService.setConsentStatus` is mocked to throw after `ConsentRepository.insert` succeeds | `consent_records` row not present in DB; `event_outbox` row not inserted; `leads.consent_status` unchanged; error propagates as `INTERNAL_ERROR` (500) |
| T31 | Unit | `UnitOfWork rolls back all writes when OutboxService.emit throws on withdrawal` | `OutboxService.emit` mocked to throw after consent insert | `consent_records` row not present; `leads.consent_status` unchanged; entire tx rolled back |
| T32 | Unit | `AuditAppender.emit called once per consent capture with correct action` | RM captures a consent | `AuditAppender.emit` called exactly once with `{ action: 'CONSENT_CAPTURED', entity: 'consent_records', entity_id: <new_id> }`; `detail.purpose` and `detail.state` present; no PII in `detail` |
| T33 | Unit | `ConsentService.capture does not call OutboxService.emit for granted state` | RM captures a `granted` consent | `OutboxService.emit` is NOT called; only audit intent emitted |
| T34 | Unit | `ConsentService.capture calls OutboxService.emit exactly once for withdrawn state` | RM captures a `withdrawn` consent (prior grant exists) | `OutboxService.emit` called once with `event_code = 'CONSENT_WITHDRAWN'`; `payload` contains `lead_id` and `purpose`; no raw PII in payload |

---

## SQL Invariant Queries

Run after each write test; all must return 0 rows.

```sql
-- INV-01: consent_records must never be updated (state column immutable)
-- Test by issuing an UPDATE via the API or service; then assert no row changed.
-- Canary: verify no consent_records row was modified after test T29 ran.
SELECT consent_id
FROM consent_records
WHERE state IN ('expired', 'superseded')
  AND updated_at = created_at;
-- Should be 0 for system-managed states inserted via API (they are rejected before insert).

-- INV-02: No consent_records row may be deleted
-- Verify by attempting DELETE and checking count is unchanged.
-- Invariant SQL form:
SELECT COUNT(*) AS total_before FROM consent_records;
-- Re-query after any test that attempts a delete — count must be equal or greater.

-- INV-03: superseded_by must point to a row in the same org and same lead
SELECT cr1.consent_id AS stale_id
FROM consent_records cr1
INNER JOIN consent_records cr2 ON cr2.consent_id = cr1.superseded_by
WHERE cr1.lead_id   <> cr2.lead_id
   OR cr1.org_id    <> cr2.org_id;

-- INV-04: superseded_by must point to a row with the same purpose
SELECT cr1.consent_id
FROM consent_records cr1
INNER JOIN consent_records cr2 ON cr2.consent_id = cr1.superseded_by
WHERE cr1.purpose <> cr2.purpose;

-- INV-05: For every withdrawn consent_records row, a prior granted row must exist
-- for the same (lead_id, purpose)
SELECT w.consent_id AS withdrawn_without_prior_grant
FROM consent_records w
WHERE w.state = 'withdrawn'
  AND NOT EXISTS (
    SELECT 1
    FROM consent_records g
    WHERE g.lead_id  = w.lead_id
      AND g.purpose  = w.purpose
      AND g.state    = 'granted'
      AND g.created_at < w.created_at
  );

-- INV-06: leads.consent_status must never be set to 'captured' when any
-- non-superseded consent_records row for that lead has state = 'withdrawn'
SELECT l.lead_id
FROM leads l
WHERE l.consent_status = 'captured'
  AND EXISTS (
    SELECT 1
    FROM consent_records cr
    WHERE cr.lead_id       = l.lead_id
      AND cr.org_id        = l.org_id
      AND cr.state         = 'withdrawn'
      AND cr.superseded_by IS NULL
  );

-- INV-07: Every consent_records row must have a corresponding audit_log entry
SELECT cr.consent_id
FROM consent_records cr
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs al
  WHERE al.detail->>'entity_id' = cr.consent_id::text
    AND al.action = 'CONSENT_CAPTURED'
);

-- INV-08: event_outbox must contain exactly one CONSENT_WITHDRAWN event per
-- withdrawn consent_records row
SELECT cr.consent_id
FROM consent_records cr
WHERE cr.state = 'withdrawn'
  AND (
    SELECT COUNT(*) FROM event_outbox eo
    WHERE eo.event_code = 'CONSENT_WITHDRAWN'
      AND eo.payload->>'lead_id' = cr.lead_id::text
      AND eo.payload->>'purpose' = cr.purpose::text
  ) <> 1;
```

---

## UI Test Scenarios

Implemented with **Playwright** in `apps/web/e2e/compliance/consent.spec.ts`.

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| UI-01 | RM records a granted consent from Lead 360 | Log in as RM; navigate to `/leads/{id}`; scroll to "Consent Status" card; click "Record Consent"; select `purpose = lead_contact`, `state = granted`; fill notice/text versions; click "Record" | Toast "Consent recorded"; `StatusChip` on card updates to reflect new `consent_status`; new row appears in consent history table with `state = granted` and `StatusChip` in green |
| UI-02 | RM records a withdrawal; consent_status updates | Lead has prior granted `lead_contact`; RM opens Drawer, selects `state = withdrawn`; submits | Toast success; consent history table shows new `withdrawn` row; status chip updates to `withdrawn` (red/orange); old row remains (append-only) |
| UI-03 | DPO views ip_device in Compliance Console | Log in as DPO; navigate to `/compliance/consents`; filter by lead_code | `ip_device` column is visible and populated; column is absent / null for RM viewing the same record on Lead 360 |
| UI-04 | RM cannot access Compliance Console ledger page | Log in as RM; navigate directly to `/compliance/consents` | Redirected to 403 / Access Denied page; no consent data exposed |
| UI-05 | Consent capture form shows field errors when notice_version is blank | RM opens Drawer; clears `notice_version`; clicks "Record" | Inline error appears under `notice_version` field with `role="alert"`; form does not submit |
| UI-06 | Customer grants consent via micro-site tokenised link | Open `/c/{token}` (active token + OTP completed); navigate to consent step; select `purpose = lead_contact`, `state = granted`; submit | 201 response; UI shows confirmation message; consent row appears in RM's Lead 360 consent history |
| UI-07 | Consent history DataTable is paginated server-side | Lead has 30 consent records; RM views consent panel | Page 1 shows 25 rows; pagination controls show total 30; navigating to page 2 shows remaining 5 rows |

---

## Coverage Checklist

- [x] Happy path: staff grant (T01)
- [x] Happy path: staff withdrawal + outbox event (T02)
- [x] Happy path: supersede prior grant (T03)
- [x] Happy path: list with pagination (T14)
- [x] Happy path: filter by purpose (T15)
- [x] Happy path: filter by state (T16)
- [x] Happy path: customer self-service grant (T19)
- [x] `VALIDATION_ERROR` — invalid purpose enum (T04)
- [x] `VALIDATION_ERROR` — missing notice_version (T05)
- [x] `VALIDATION_ERROR` — missing consent_text_version (T06)
- [x] `VALIDATION_ERROR` — state = expired (T07)
- [x] `VALIDATION_ERROR` — state = superseded (T08)
- [x] `VALIDATION_ERROR` — withdraw never-granted purpose (T09)
- [x] `VALIDATION_ERROR` — customer uses withdrawn state (T22)
- [x] `VALIDATION_ERROR` — customer uses non-customer purpose (T23)
- [x] `FORBIDDEN` — RM out-of-scope (own leads only) (T10)
- [x] `FORBIDDEN` — PARTNER out-of-scope (own submissions only) (T11)
- [x] `FORBIDDEN` — attempt UPDATE/DELETE on consent_records (T29)
- [x] `NOT_FOUND` — unknown lead_id (T12)
- [x] `NOT_FOUND` — expired customer token (T20)
- [x] `NOT_FOUND` — revoked customer token (T21)
- [x] `AUTH_REQUIRED` — no JWT on staff endpoint (T13)
- [x] `RATE_LIMITED` — customer consent endpoint (T24)
- [x] Masking: ip_device masked for non-DPO roles (T18)
- [x] Consent status derivation — all required granted → captured (T25)
- [x] Consent status derivation — partial grant → partial (T26)
- [x] Consent status derivation — any withdrawn → withdrawn (T27)
- [x] Consent status derivation — none granted → pending (T28)
- [x] Append-only: consent_records never deleted (INV-02)
- [x] Append-only: state column never mutated on existing row (T29, INV-01)
- [x] Transaction rollback: setConsentStatus failure rolls back insert (T30)
- [x] Transaction rollback: OutboxService failure rolls back insert (T31)
- [x] Audit: AuditAppender called once per capture with no PII in detail (T32)
- [x] No outbox event for granted state (T33)
- [x] Exactly one outbox event for withdrawn state (T34)
- [x] SQL invariants: superseded_by referential integrity (INV-03, INV-04)
- [x] SQL invariant: no withdrawn without prior granted (INV-05)
- [x] SQL invariant: consent_status=captured never coexists with withdrawn record (INV-06)
- [x] SQL invariant: every consent row has audit entry (INV-07)
- [x] SQL invariant: one outbox event per withdrawal (INV-08)
- [x] UI: staff grant + status chip update (UI-01)
- [x] UI: staff withdrawal + history append-only (UI-02)
- [x] UI: DPO sees ip_device; RM does not (UI-03)
- [x] UI: RM cannot access DPO ledger page (UI-04)
- [x] UI: field-level validation on form submit (UI-05)
- [x] UI: customer micro-site consent grant (UI-06)
- [x] UI: server-side pagination in consent history (UI-07)
