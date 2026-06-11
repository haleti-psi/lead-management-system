# FR-060: Secure Customer Action Link — Test Specification

**Tier: 3** (Complex)
**Source LLD:** `docs/lld/FR-060.md`

---

## Test Cases

| # | Name | Layer | Type | Description | Input / Setup | Expected Outcome |
|---|---|---|---|---|---|---|
| T-01 | Happy path — staff creates customer link | API integration | Happy path | RM creates a link for their own lead; link row inserted, old active link revoked, `DOC_REQUEST` outbox event emitted, `link_create` audit appended, dispatch queued post-commit | Authenticated RM; valid lead owned by RM; `POST /leads/{id}/customer-link` with `{ purpose:['upload','consent'], channel:'whatsapp', expires_in_days:7 }` | 201; `data.status='active'`; `data.customer_link_id` present; raw token absent from response; `customer_links` row with `status='active'`; previous active link for same lead now `status='revoked'`; one `audit_logs` row with `action='link_create'`; one `event_outbox` row with `event_code='DOC_REQUEST'` |
| T-02 | Resend revokes previous link | API integration | State machine | Calling create a second time for the same lead revokes the first link and issues a new one | First link exists with `status='active'`; call create again | Old link `status='revoked'`, `revoked_by = actorUserId`; new link `status='active'`; exactly one active link per lead after each create |
| T-03 | Staff out of scope — FORBIDDEN | API integration | Authz negative | RM tries to create a link for a lead they do not own | Lead owned by a different RM | 403 `FORBIDDEN` |
| T-04 | BM creates link for branch lead | API integration | Authz positive | BM with branch scope can create links for leads in their branch | Authenticated BM; lead in same branch | 201; link created |
| T-05 | Lead not found | API integration | NOT_FOUND | Non-existent lead ID in path | Random UUID `id` | 404 `NOT_FOUND` |
| T-06 | Validation error — empty purpose array | API integration | Validation | `purpose: []` rejected | `{ purpose: [], channel: 'sms' }` | 400 `VALIDATION_ERROR`; `fields` includes `purpose` |
| T-07 | Validation error — invalid channel | API integration | Validation | Unknown channel value | `{ purpose: ['upload'], channel: 'telegram' }` | 400 `VALIDATION_ERROR`; `fields` includes `channel` |
| T-08 | Token lifecycle — open valid link | API integration | Happy path | Customer opens the link; `opened_at` is set; landing data returned with no PII beyond product/status label | Valid `active` link; `GET /c/{rawToken}` | 200; `data.otp_verified=false`; `data.purpose` present; `data.lead_display` contains only `product_display_name` and `status_label`; no `lead_code`, `lead_id`, RM details |
| T-09 | Token not found | API integration | NOT_FOUND | Invalid / never-issued token | `GET /c/nonexistenttoken` | 404 `NOT_FOUND` |
| T-10 | Expired token returns NOT_FOUND and marks expired | API integration | State machine | Link whose `expires_at` is in the past | Link with `expires_at = now() - 1 second`; `GET /c/{token}` | 404 `NOT_FOUND`; `customer_links.status` updated to `'expired'` in DB |
| T-11 | Revoked token returns NOT_FOUND | API integration | NOT_FOUND | Previously revoked link | Link with `status='revoked'` | 404 `NOT_FOUND` |
| T-12 | OTP happy path — verify and set session | API integration | Happy path | Customer submits correct 6-digit OTP; session key set in Redis; `otp_verified_at` updated in DB | Valid active link; OTP stored in Redis; `POST /c/{token}/otp` with correct OTP | 200; `data.otp_verified=true`; Redis `clsession:{id}` key exists; Redis OTP key deleted; `customer_links.otp_verified_at IS NOT NULL` |
| T-13 | OTP wrong value — AUTH_REQUIRED | API integration | Auth negative | Incorrect OTP submitted | Valid link; wrong OTP | 401 `AUTH_REQUIRED` |
| T-14 | OTP rate limit — RATE_LIMITED | API integration | Rate limit | More than 10 OTP attempts within 10 minutes | Valid link; 10 wrong OTPs submitted | 429 `RATE_LIMITED`; `Retry-After` header present |
| T-15 | OTP invalid format — VALIDATION_ERROR | API integration | Validation | 5-digit OTP, letters in OTP | `{ otp: '12345' }` | 400 `VALIDATION_ERROR`; `fields` includes `otp` |
| T-16 | Document upload happy path | API integration | Happy path | OTP-verified customer uploads a clean-MIME PDF; document row inserted with `status='uploaded'`, `virus_scan_status='pending'`, `uploaded_via='customer_link'` | Valid active link; OTP session present; `POST /c/{token}/documents` multipart with valid PDF under 10 MB | 201; `data.status='uploaded'`; `data.virus_scan_status='pending'`; DB: `documents` row inserted; `audit_logs` row `action='doc_upload'`; `event_outbox` row `event_code='DOC_UPLOADED'` |
| T-17 | Upload without OTP — AUTH_REQUIRED | API integration | Auth negative | Customer skips OTP step and attempts upload | No Redis `clsession` key; `POST /c/{token}/documents` | 401 `AUTH_REQUIRED` |
| T-18 | Upload not in purpose — FORBIDDEN | API integration | Auth negative | Link purpose does not include 'upload' | Link with `purpose=['status','consent']`; upload attempted | 403 `FORBIDDEN` |
| T-19 | File too large — PAYLOAD_TOO_LARGE | API integration | Boundary | File exceeds configured maximum (10 MB) | Multipart with `file.size = 10.1 MB` | 413 `PAYLOAD_TOO_LARGE` |
| T-20 | Disallowed MIME type — UNSUPPORTED_MEDIA | API integration | Validation | Executable file uploaded | Multipart with `.exe` MIME content | 415 `UNSUPPORTED_MEDIA`; no GCS write |
| T-21 | Infected file — rejected post-scan | Unit (VirusScanWorker) | External service failure | Virus-scan worker reports infected file | `document_id` with `virus_scan_status='pending'`; scan callback returns `INFECTED` | `documents.virus_scan_status='infected'`; `documents.deleted_at IS NOT NULL`; file NOT in clean GCS bucket; `DOC_MISMATCH` outbox event emitted |
| T-22 | Consent grant happy path | API integration | Happy path | OTP-verified customer grants consent; `consent_records` appended | Valid active link with `'consent' in purpose`; OTP session present; `POST /c/{token}/consent` with valid payload | 201; DB: `consent_records` row with `state='granted'`, `actor='customer'`; `audit_logs` row `action='consent_grant'` |
| T-23 | Consent without OTP — AUTH_REQUIRED | API integration | Auth negative | OTP session missing for consent endpoint | No `clsession` in Redis | 401 `AUTH_REQUIRED` |
| T-24 | Consent not in purpose — FORBIDDEN | API integration | Auth negative | Link purpose does not include 'consent' | Link with `purpose=['upload']`; consent attempted | 403 `FORBIDDEN` |
| T-25 | Transaction rollback — mid-write failure on upload | API integration | Transaction integrity | DB error injected after documents INSERT but before outbox INSERT | Force outbox INSERT to throw | Transaction rolled back; `documents` row absent from DB; no `audit_logs` row; GCS staging file may exist (orphan cleanup job responsibility) |
| T-26 | Transaction rollback — link create mid-write failure | API integration | Transaction integrity | DB error injected after customer_links INSERT but before audit_logs INSERT | Force audit INSERT to throw | No `customer_links` row committed; no `audit_logs` row |
| T-27 | Notification dispatch failure does not roll back link | API integration | External service failure | `NotificationChannelPort` throws after link tx commits | Mock channel adapter throws UPSTREAM_UNAVAILABLE | Link row present in DB with `status='active'`; response 201 returned (or 503 on synchronous path — see AMB-1 in LLD); Cloud Tasks retry queued |
| T-28 | Append-only invariant — no UPDATE on consent_records | Unit | Append-only | Confirm `ConsentService` never issues UPDATE on `consent_records` | Inspect all Kysely calls in `ConsentService` | Zero `updateTable('consent_records')` calls in the service |
| T-29 | Append-only invariant — no UPDATE on audit_logs | Unit | Append-only | `AuditAppender` never issues UPDATE | Inspect Kysely calls | Zero `updateTable('audit_logs')` calls |
| T-30 | Masking — internal fields hidden from customer response | API integration | Masking | Customer micro-site response must not contain RM name, score, lead_code, or raw lead_id | `GET /c/{token}` with valid link | Response body contains no `lead_code`, no `owner_id`, no `score`, no RM fields |
| T-31 | Idempotent open — opened_at set only once | API integration | Idempotency | Calling `GET /c/{token}` twice does not create two audit rows for `link_open` | Two successive GET requests with same token | Exactly one `audit_logs` row with `action='link_open'` for this link |
| T-32 | Unauthenticated staff call — AUTH_REQUIRED | API integration | Auth negative | `POST /leads/{id}/customer-link` without JWT | No Authorization header / cookie | 401 `AUTH_REQUIRED` |
| T-33 | CUSTOMER role cannot call staff endpoint | API integration | Authz negative | A user with CUSTOMER role calls `POST /leads/{id}/customer-link` | JWT with CUSTOMER role | 403 `FORBIDDEN` (no `customer_comm` capability for staff endpoint) |
| T-34 | OTP generation and dispatch called at link creation | Unit | External service | `NotificationChannelPort` is called with correct args after link creation | Spy on `NotificationChannelPort`; create a link | Port called once; recipient masked in comms log; raw token never appears in any log line |
| T-35 | Expired link not accessible even with valid OTP session | API integration | State machine | If a link has `status='expired'` the guard returns 404 regardless of Redis session | Manually set link to expired; valid session present | 404 `NOT_FOUND` |

---

## SQL Invariant Queries

These queries run after each relevant test and must return **0 rows** (verified via `expect(rows).toHaveLength(0)`).

```sql
-- INV-1: No active customer_links with expires_at in the past
SELECT customer_link_id FROM customer_links
WHERE status = 'active' AND expires_at < now();

-- INV-2: No two active links for the same lead
SELECT lead_id, COUNT(*) FROM customer_links
WHERE status = 'active'
GROUP BY lead_id
HAVING COUNT(*) > 1;

-- INV-3: No document row with virus_scan_status='clean' AND status='uploaded'
-- (once clean, status must be 'under_review')
SELECT document_id FROM documents
WHERE virus_scan_status = 'clean' AND status = 'uploaded';

-- INV-4: No document with virus_scan_status='infected' that lacks deleted_at
SELECT document_id FROM documents
WHERE virus_scan_status = 'infected' AND deleted_at IS NULL;

-- INV-5: No consent_records row with state NOT IN allowed values
SELECT consent_id FROM consent_records
WHERE state NOT IN ('granted','denied','withdrawn','expired','superseded');

-- INV-6: No audit_log row for customer-link actions without a lead_id
SELECT audit_id FROM audit_logs
WHERE action IN ('link_create','link_open','link_revoke','doc_upload','consent_grant')
  AND lead_id IS NULL;

-- INV-7: No customer_links row where token_hash is NULL or empty
SELECT customer_link_id FROM customer_links
WHERE token_hash IS NULL OR token_hash = '';

-- INV-8: No document uploaded via customer_link without a corresponding customer_links row for that lead
SELECT d.document_id FROM documents d
WHERE d.uploaded_via = 'customer_link'
  AND NOT EXISTS (
    SELECT 1 FROM customer_links cl WHERE cl.lead_id = d.lead_id
  );
```

---

## UI Test Scenarios (Playwright — `apps/web/e2e/`)

| # | Scenario | Steps | Assertions |
|---|---|---|---|
| UI-01 | Customer link full upload flow | (1) Staff creates link for a lead; (2) copy URL from dispatch mock; (3) navigate to `/c/{token}`; (4) enter OTP; (5) select doc_type, upload PDF; (6) observe scan status badge | OTP gate clears; upload progress appears; `ScanStatusBadge` shows "Pending" then "Under Review" after scan mock resolves; no RM name/score visible anywhere |
| UI-02 | Expired link shows re-request page | Navigate to a link whose `expires_at` is past | `ExpiredLinkPage` rendered; "Contact your RM" message; no upload/consent tabs |
| UI-03 | Consent grant flow | Open valid link, verify OTP, switch to Consent tab, tick all purposes, press Grant | Success `Toast` shown; consent tab shows "Granted" status; no extra navigation to internal screens |
| UI-04 | Rate-limited OTP shows banner | Enter wrong OTP 11 times | `RateLimitBanner` visible with `RATE_LIMITED` user-message; OTP input disabled; `Retry-After` value shown |
| UI-05 | File too large — client-side validation | Select a file > 10 MB | Error message shown before upload; network request not made (client-side gate) |
| UI-06 | Accessibility — OTP input keyboard navigation | Tab to OTP input; enter digits; Tab to submit button; Enter | Flow completes without mouse; focus-visible rings present; no keyboard trap |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path — create link | T-01 |
| Happy path — open link | T-08 |
| Happy path — OTP verify | T-12 |
| Happy path — document upload | T-16 |
| Happy path — consent grant | T-22 |
| Resend revokes old link | T-02 |
| `NOT_FOUND` — invalid token | T-09 |
| `NOT_FOUND` — expired token + auto-expiry | T-10 |
| `NOT_FOUND` — revoked token | T-11 |
| `NOT_FOUND` — lead not found (staff) | T-05 |
| `FORBIDDEN` — out-of-scope staff | T-03 |
| `FORBIDDEN` — action not in purpose | T-18, T-24 |
| `AUTH_REQUIRED` — missing JWT (staff) | T-32 |
| `AUTH_REQUIRED` — no OTP session (upload) | T-17 |
| `AUTH_REQUIRED` — no OTP session (consent) | T-23 |
| `AUTH_REQUIRED` — wrong OTP | T-13 |
| `RATE_LIMITED` — OTP attempts | T-14 |
| `VALIDATION_ERROR` — bad dto (purpose, channel) | T-06, T-07 |
| `VALIDATION_ERROR` — bad OTP format | T-15 |
| `PAYLOAD_TOO_LARGE` — file too large | T-19 |
| `UNSUPPORTED_MEDIA` — bad MIME | T-20 |
| `UPSTREAM_UNAVAILABLE` — notification failure | T-27 |
| Virus scan — infected file path | T-21 |
| Transaction rollback — upload mid-write | T-25 |
| Transaction rollback — link create mid-write | T-26 |
| Append-only — consent_records | T-28 |
| Append-only — audit_logs | T-29 |
| Masking — internal fields hidden | T-30 |
| Idempotency — opened_at single write | T-31 |
| Authz negative — CUSTOMER role on staff endpoint | T-33 |
| OTP dispatch and PII masking in logs | T-34 |
| State machine — expired link no access with session | T-35 |
| SQL invariants | INV-1 through INV-8 |
| UI — full upload E2E | UI-01 |
| UI — expired link UX | UI-02 |
| UI — consent flow | UI-03 |
| UI — rate limit UX | UI-04 |
| UI — client-side file size gate | UI-05 |
| UI — accessibility keyboard nav | UI-06 |
