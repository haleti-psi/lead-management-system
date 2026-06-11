# FR-103: Notification Preference & Opt-Out Centre — Test Specification

**Tier: 2**
**Source LLD:** `docs/lld/FR-103.md`

---

## Test Cases

| # | Layer | Scenario | Input | Expected Output | Notes |
|---|---|---|---|---|---|
| T01 | API integration | Happy path — internal user (BM) upserts marketing opt-out for a customer | `PUT /api/v1/preferences` with valid JWT (BM, branch B), `subject_type=customer`, valid `subject_ref`, `[{ channel: whatsapp, purpose: marketing, opted_in: false }]` | HTTP 200; `data.preferences[0].opted_in=false`; `data.preferences[0].channel=whatsapp`; row upserted in `notification_preferences`; audit row inserted | — |
| T02 | API integration | Happy path — customer upserts own preferences via customer link | `PUT /api/v1/c/{token}/preferences` with valid active token, OTP complete, `subject_type=customer`, `subject_ref` matching token's `customer_profile_id` | HTTP 200; rows upserted correctly; audit row inserted | — |
| T03 | API integration | Idempotent re-upsert — same channel/purpose sent twice in sequence | First `PUT` opts-out; second `PUT` with `opted_in=true` for same key | Both return 200; final DB row has `opted_in=true`; exactly 2 audit rows (one per request) | Last-write-wins |
| T04 | API integration | Batch request — multiple channel/purpose pairs in one call | `preferences` array with 3 distinct `(channel, purpose)` pairs | HTTP 200; all 3 rows present in DB; single audit log entry covering all 3 | Atomic: all or none |
| T05 | API integration | AUTH_REQUIRED — missing JWT on internal endpoint | `PUT /api/v1/preferences` with no `Authorization` header | HTTP 401; `error.code=AUTH_REQUIRED` | — |
| T06 | API integration | FORBIDDEN — RM tries to set preferences for a customer outside their scope | JWT (RM, scope O, lead owned by different RM); `subject_ref` = customer on another RM's lead | HTTP 403; `error.code=FORBIDDEN`; no DB row inserted | Scope enforcement |
| T07 | API integration | FORBIDDEN — customer-link token expired | `PUT /api/v1/c/{token}/preferences` with token where `expires_at` < now | HTTP 403; `error.code=FORBIDDEN` | CustomerLinkGuard |
| T08 | API integration | FORBIDDEN — `subject_ref` mismatch on customer-link | Token resolves `customer_profile_id=A`; body sends `subject_ref=B` | HTTP 403; `error.code=FORBIDDEN` | Guard ownership check |
| T09 | API integration | VALIDATION_ERROR — invalid `channel` enum value | `channel="postal"` | HTTP 400; `error.code=VALIDATION_ERROR`; `fields` array contains `{field:"preferences[0].channel"}` | — |
| T10 | API integration | VALIDATION_ERROR — invalid `purpose` enum value | `purpose="loan_fraud"` | HTTP 400; `error.code=VALIDATION_ERROR`; `fields` contains `{field:"preferences[0].purpose"}` | — |
| T11 | API integration | VALIDATION_ERROR — empty `preferences` array | `preferences=[]` | HTTP 400; `error.code=VALIDATION_ERROR`; `fields` contains `{field:"preferences"}` | — |
| T12 | API integration | VALIDATION_ERROR — `preferences` array > 50 items | 51 items | HTTP 400; `error.code=VALIDATION_ERROR` | Batch size limit |
| T13 | API integration | VALIDATION_ERROR — `subject_ref` is not a valid UUID | `subject_ref="not-a-uuid"` | HTTP 400; `error.code=VALIDATION_ERROR` | — |
| T14 | API integration | Transactional opt-out warning returned in meta | `{ channel: email, purpose: document_processing, opted_in: false }` | HTTP 200; `meta.warnings` is non-empty; warning message references document processing delay | Non-blocking |
| T15 | API integration | RATE_LIMITED — internal mutation throttle exceeded | > 60 `PUT` requests in one minute from the same user | HTTP 429; `error.code=RATE_LIMITED`; `Retry-After` header present | Redis-backed |
| T16 | API integration | RATE_LIMITED — customer-link throttle exceeded | > 10 `PUT /c/{token}/preferences` requests in one minute from same IP | HTTP 429; `error.code=RATE_LIMITED` | — |
| T17 | Unit | Default opted_in behaviour — marketing defaults false, transactional defaults true | Service called with no pre-existing rows; subject has no prior prefs | `marketing` purposes insert with `opted_in=false`; all others insert with `opted_in=true` | Service-layer default logic |
| T18 | Unit | Transaction rollback on mid-batch DB error | Simulate DB failure on second of three upsert rows (inside UnitOfWork) | All three rows absent from DB; audit row absent; `INTERNAL_ERROR` returned | Atomicity |
| T19 | Unit | Duplicate `(channel, purpose)` pairs in single request deduplicated | `preferences` contains two items both `(whatsapp, marketing)` with different `opted_in` | Last item's value persists; only one DB row; no error | Last-write-wins dedup |
| T20 | Frontend component | Preference matrix renders correct initial state from GET response | Mock GET returns one opted-out row for `(whatsapp, marketing)` | Toggle for `(whatsapp, marketing)` renders as unchecked; all other toggles checked | Vitest + Testing Library |
| T21 | Frontend component | Submit sends correct payload and shows success toast | User toggles `(sms, document_processing)` to off, submits | `PUT /preferences` called with correct body; success `Toast` rendered | Vitest + Testing Library |
| T22 | Frontend component | VALIDATION_ERROR from server shows inline field error | Server returns `VALIDATION_ERROR` with `fields: [{field:"preferences[0].channel",issue:"invalid"}]` | Inline error message visible near the relevant toggle | `EntityForm` maps fields[] |

---

## SQL Invariant Queries

Run these after test scenarios to assert correctness. All should return 0 rows in a healthy state.

### INV-01: No duplicate preference rows per unique key

```sql
SELECT subject_type, subject_ref, channel, purpose, COUNT(*) AS cnt
FROM notification_preferences
GROUP BY subject_type, subject_ref, channel, purpose
HAVING COUNT(*) > 1;
-- Expect: 0 rows (unique constraint uq_notif_pref enforces this at DB level)
```

### INV-02: Audit log always written on preference upsert

```sql
-- After a PUT /preferences request, at least one audit_logs row must exist for the actor
-- (Parameterised version used in test assertions)
SELECT COUNT(*) FROM audit_logs
WHERE actor_id = :actorUserId
  AND entity_type = 'notification_preferences'
  AND created_at > :requestStartTime;
-- Expect: >= 1
```

### INV-03: Audit logs are append-only — no updates or deletes

```sql
-- Verifies the table has no updated_at trigger and no rows have been modified
-- (This is a DDL-level invariant; test by attempting an UPDATE and expecting DB REVOKE / no trigger)
SELECT COUNT(*) FROM audit_logs WHERE updated_at != created_at;
-- Expect: 0 (audit_logs has no updated_at trigger per schema.sql §5.6.3)
```

### INV-04: No notification_preference rows with unknown org_id

```sql
SELECT COUNT(*) FROM notification_preferences np
WHERE NOT EXISTS (SELECT 1 FROM orgs o WHERE o.id = np.org_id);
-- Expect: 0
```

### INV-05: Customer subject_ref always maps to an existing customer_profile_id

```sql
SELECT COUNT(*) FROM notification_preferences np
WHERE np.subject_type = 'customer'
  AND NOT EXISTS (
    SELECT 1 FROM customer_profiles cp
    WHERE cp.customer_profile_id = np.subject_ref
  );
-- Expect: 0 (no FK enforced in schema for subject_ref, but invariant must hold)
```

### INV-06: User subject_ref always maps to an existing user_id

```sql
SELECT COUNT(*) FROM notification_preferences np
WHERE np.subject_type = 'user'
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.user_id = np.subject_ref
  );
-- Expect: 0
```

---

## UI Test Scenarios (Playwright)

### E2E-01: RM opts customer out of WhatsApp marketing

1. Log in as RM with an assigned lead.
2. Navigate to the lead's 360 view → Preferences tab.
3. Verify the `(whatsapp, marketing)` toggle is checked (default in).
4. Toggle it off.
5. Click "Save Changes".
6. Assert success toast appears.
7. Reload the page; assert the toggle is still off.
8. Assert DB row has `opted_in=false`.

### E2E-02: Customer opts out via link (mobile viewport)

1. Generate a customer link and complete OTP step-up.
2. Navigate to the preferences panel in the micro-site.
3. Toggle off `(sms, marketing)`.
4. Save.
5. Assert confirmation message visible.
6. Assert DB row `opted_in=false`.

### E2E-03: Transactional opt-out warning is visible but save succeeds

1. Log in as BM.
2. Open preference centre for a customer.
3. Toggle off `(email, document_processing)`.
4. Assert warning message appears before or after save.
5. Click save; assert HTTP 200 and `meta.warnings` non-empty.
6. Assert row saved with `opted_in=false`.

---

## Coverage Checklist

| Requirement | Covered By |
|---|---|
| Happy path — internal upsert | T01, T04, E2E-01 |
| Happy path — customer-link upsert | T02, E2E-02 |
| Idempotent / last-write-wins re-upsert | T03, T19 |
| Batch atomicity (all-or-none) | T04, T18 |
| `AUTH_REQUIRED` (401) | T05 |
| `FORBIDDEN` — scope violation | T06 |
| `FORBIDDEN` — expired token | T07 |
| `FORBIDDEN` — subject_ref mismatch | T08 |
| `VALIDATION_ERROR` — invalid channel | T09 |
| `VALIDATION_ERROR` — invalid purpose | T10 |
| `VALIDATION_ERROR` — empty array | T11 |
| `VALIDATION_ERROR` — oversized array | T12 |
| `VALIDATION_ERROR` — bad UUID | T13 |
| Transactional opt-out warning | T14, E2E-03 |
| `RATE_LIMITED` — internal (60/min) | T15 |
| `RATE_LIMITED` — customer link (10/min) | T16 |
| Default opted_in values (marketing=false, others=true) | T17 |
| Transaction rollback on failure | T18 |
| Audit log written on every write | T18 (absence), T01+INV-02 (presence) |
| Audit log append-only | INV-03 |
| SQL unique invariant | INV-01 |
| UI renders current state | T20, E2E-01 |
| UI maps server validation errors to fields | T22 |
| UI success feedback (Toast) | T21, E2E-01 |
