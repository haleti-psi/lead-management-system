# FR-001 Test Specification: Secure Login, Sessions & MFA

**Tier: 2** | Source LLD: `docs/lld/FR-001.md`

---

## Overview

FR-001 owns the authentication and session lifecycle. Tests cover: happy-path token issuance, MFA challenge/verify, refresh rotation, lockout, rate-limiting, audit-log emission, and state transitions on `users.status`. All four endpoints are `@Public()` — auth-negative tests here focus on invalid tokens, locked accounts, and expired sessions rather than ABAC scope.

---

## Test Cases

| # | Layer | Scenario | Inputs | Expected outcome |
|---|---|---|---|---|
| T-001 | API | Happy path — login without MFA | Valid `username`+`password` for an `active` user with `mfa_enabled=false` and non-mandatory role (RM) | HTTP 200; `data.access_token` present; `data.mfa_required=false`; `lms_refresh` httpOnly cookie set; `audit_logs` row with `action='login'` inserted |
| T-002 | API | Happy path — login triggers MFA challenge | Valid credentials for an `active` ADMIN user (`mfa_enabled=true`, role mandates MFA) | HTTP 200; `data.mfa_required=true`; `data.mfa_challenge_token` present; no `access_token`; Redis key `mfa:challenge:<user_id>` exists; `audit_logs` row with `action='login'` **not** yet inserted (deferred until MFA step) |
| T-003 | API | Happy path — MFA verify succeeds | Valid `mfa_challenge_token` + correct 6-digit TOTP | HTTP 200; `data.access_token` present; `mfa:challenge:<user_id>` Redis key deleted; `audit_logs(action='login')` inserted; `users.last_login_at` updated |
| T-004 | API | Happy path — refresh rotates tokens | Valid `lms_refresh` cookie within idle window | HTTP 200; new `access_token` returned; old refresh token no longer valid in Redis; new `lms_refresh` cookie set |
| T-005 | API | Wrong password — does not lock yet | Valid username, wrong password, attempt count = 1 | HTTP 401 `AUTH_REQUIRED`; generic message; `audit_logs(action='login_failed')` inserted; Redis `fail:<user_id>` = 1 |
| T-006 | API | 5th wrong password — triggers lockout | Valid username, wrong password, 4 prior failures already in Redis | HTTP 401 on 5th attempt then HTTP 403 `FORBIDDEN` + `detail.reason='ACCOUNT_LOCKED'` on next attempt; `users.status='locked'`; Redis `lockout:<user_id>` exists; `audit_logs(login_failed, {reason:'lockout_triggered'})` inserted |
| T-007 | API | Login attempt on locked account | Valid credentials but `users.status='locked'` | HTTP 403 `FORBIDDEN` + `detail.reason='ACCOUNT_LOCKED'` + `retry_after_seconds`; `audit_logs(login_failed)` inserted; no password verified |
| T-008 | API | Wrong OTP in MFA step | Valid `mfa_challenge_token`, wrong 6-digit OTP | HTTP 401 `AUTH_REQUIRED`; `audit_logs(action='mfa_failed')` inserted; `mfa:challenge:<user_id>` Redis key still exists (not consumed on failure) |
| T-009 | API | Replayed MFA challenge token | Same `mfa_challenge_token` used a second time after first success | HTTP 401 `AUTH_REQUIRED` (Redis key absent); no second token issuance |
| T-010 | API | Expired refresh token | `lms_refresh` cookie value is a UUID not in Redis (expired or never issued) | HTTP 401 `AUTH_REQUIRED` |
| T-011 | API | Idle timeout on refresh | `lms_refresh` valid in Redis but `last_login_at` + `SESSION_IDLE_TIMEOUT_MINUTES` < now | HTTP 401 `AUTH_REQUIRED`; refresh token deleted from Redis |
| T-012 | API | Rate limit on login — 11th request in 1 min | 10 prior requests from same IP within 60 s | HTTP 429 `RATE_LIMITED`; `Retry-After` header present |
| T-013 | API | Rate limit on MFA — 11th request in 1 min | Same | HTTP 429 `RATE_LIMITED` |
| T-014 | API | Rate limit on password reset | 11 requests within 60 s from same IP | HTTP 429 `RATE_LIMITED` |
| T-015 | API | Password reset — valid email | `email` matching an `active` user | HTTP 200 `data: null`; Redis `pw_reset:<user_id>` key set; `NotificationChannelPort` called with `templateCode='pw_reset_link'`; response is identical whether email matches or not |
| T-016 | API | Password reset — non-existent email | `email` with no matching `users` row | HTTP 200 `data: null`; `NotificationChannelPort` **not** called; response body identical to T-015 (no enumeration) |
| T-017 | Unit | Lockout counter reset on success | Simulate 4 failures then 1 success | Redis `fail:<user_id>` key deleted after successful `argon2.verify` |
| T-018 | Unit | MFA mandatory for PARTNER role regardless of `mfa_enabled` flag | User with `role_code='PARTNER'`, `mfa_enabled=false` | `AuthService.isMfaRequired()` returns `true`; login returns `mfa_required=true` |
| T-019 | Unit | MFA not mandatory for RM with `mfa_enabled=false` | User with `role_code='RM'`, `mfa_enabled=false` | `AuthService.isMfaRequired()` returns `false` |
| T-020 | API | VALIDATION_ERROR — missing username | Request body `{ "password": "x" }` | HTTP 400 `VALIDATION_ERROR`; `error.fields` includes `username` |
| T-021 | API | VALIDATION_ERROR — OTP not 6 digits | `otp: "1234"` | HTTP 400 `VALIDATION_ERROR`; `error.fields` includes `otp` |
| T-022 | API | VALIDATION_ERROR — invalid email on reset | `email: "not-an-email"` | HTTP 400 `VALIDATION_ERROR`; `error.fields` includes `email` |
| T-023 | API | User enumeration guard — identical response | Login with non-existent username vs. existing username + wrong password | HTTP status, response body, and timing (±20 ms) identical; no difference in body |
| T-024 | API | No PII in audit log detail | Successful login triggers audit write | `audit_logs.detail` does not contain `password_hash`, raw password, JWT/refresh token value, or OTP |
| T-025 | API | Response never contains stack trace | Trigger an unhandled internal error (inject DB failure) | HTTP 500 `INTERNAL_ERROR`; response body contains no SQL, stack trace, file path, or internal ID |
| T-026 | E2E | Full login-to-dashboard flow (no MFA) | Valid RM credentials | Browser lands on `/dashboard`; `lms_refresh` cookie is httpOnly; token not in localStorage |
| T-027 | E2E | Login with MFA (ADMIN) | Valid ADMIN credentials | MFA challenge view rendered; correct TOTP → dashboard |
| T-028 | E2E | Silent refresh on 401 | Expire access token; navigate to protected route | App silently calls `/auth/refresh`; user stays on page without redirect |
| T-029 | E2E | Idle timeout UI redirect | Let idle timer expire (or mock `last_login_at`) | App redirects to `/login` on next route navigation; no flash of content |

---

## SQL Invariant Queries

These queries must return 0 rows (enforced as assertions in API integration tests using Testcontainers-Postgres).

```sql
-- INV-001: audit_logs must never be updated or deleted (append-only)
-- (verified by attempting UPDATE/DELETE in the test and catching the expected DB exception)
-- The DB revokes UPDATE/DELETE on audit_logs from the app role; this query confirms no rows were modified:
SELECT COUNT(*) FROM audit_logs
WHERE updated_at != created_at;
-- Expected: 0 rows (no row should ever have updated_at != created_at since there is no trigger on audit_logs)

-- INV-002: no auth event produces a token value in audit detail
SELECT COUNT(*) FROM audit_logs
WHERE action IN ('login','login_failed','mfa_failed')
  AND (
    detail::text LIKE '%password%'
    OR detail::text LIKE '%access_token%'
    OR detail::text LIKE '%refresh_token%'
    OR detail::text LIKE '%otp%'
  );
-- Expected: 0 rows

-- INV-003: every successful login must have a corresponding audit row
-- (Run after T-001 and T-003: count logins = count audit login rows for the test user)
SELECT COUNT(*) FROM audit_logs
WHERE actor_id = :test_user_id
  AND action = 'login'
  AND entity_type = 'users';
-- Expected: >= 1 after a successful login test

-- INV-004: locked user cannot transition directly to active via login
SELECT COUNT(*) FROM users
WHERE status = 'active'
  AND user_id IN (
    SELECT actor_id FROM audit_logs
    WHERE action = 'login_failed'
      AND detail->>'reason' = 'lockout_triggered'
      AND created_at > now() - interval '1 minute'
  );
-- Expected: 0 rows (a just-locked user cannot be active)

-- INV-005: no user with status='locked' has a login audit action without a prior lockout
SELECT u.user_id FROM users u
WHERE u.status = 'locked'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.actor_id = u.user_id
      AND al.action = 'login_failed'
  );
-- Expected: 0 rows (every locked user must have at least one login_failed audit)
```

---

## UI Test Scenarios (Playwright — `apps/web/e2e/auth.spec.ts`)

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| UI-001 | Login form renders correctly | Navigate to `/login` | Username + password inputs visible; submit button present; no placeholder-only labels; all inputs keyboard-reachable |
| UI-002 | Inline validation on empty submit | Submit empty form | Inline error messages under both fields (role="alert"); no page navigation |
| UI-003 | RATE_LIMITED toast | Mock 429 response | Toast with "Too many attempts. Please wait and try again." visible; no navigation |
| UI-004 | FORBIDDEN/ACCOUNT_LOCKED toast | Mock 403 with reason=ACCOUNT_LOCKED | Toast with lock message; no navigation |
| UI-005 | MFA view transition | Login returns `mfa_required:true` | Password form replaced by OTP input; no page reload; "Enter the 6-digit code" text visible |
| UI-006 | OTP field rejects non-numeric | Type "abc123" in OTP field | Only digits remain; inline error if submitted |
| UI-007 | Reset password success message | Submit valid email on reset page | Success message shown; no email visible in response (no enumeration) |
| UI-008 | Refresh token not in localStorage | After successful login | `localStorage.getItem('access_token')` and `sessionStorage.getItem('access_token')` are both null |
| UI-009 | Reduced motion respected | Set `prefers-reduced-motion: reduce` in browser | MFA view transition does not animate (instantaneous) |

---

## Coverage Checklist

- [ ] **Happy path** — login without MFA (T-001), login with MFA (T-002 + T-003), refresh rotation (T-004)
- [ ] **Every error code the FR raises:**
  - `VALIDATION_ERROR` (400) — T-020, T-021, T-022
  - `AUTH_REQUIRED` (401) — T-005, T-008, T-009, T-010, T-011
  - `FORBIDDEN` (403) — T-006, T-007 (ACCOUNT_LOCKED sub-reason)
  - `RATE_LIMITED` (429) — T-012, T-013, T-014
  - `INTERNAL_ERROR` (500) — T-025
- [ ] **Auth negatives** — locked account denied (T-007), expired/rotated refresh denied (T-010), replayed MFA token denied (T-009)
- [ ] **Validation** — missing fields (T-020), OTP format (T-021), email format (T-022)
- [ ] **Lockout counter logic** — increment (T-005), threshold + lock (T-006), reset on success (T-017)
- [ ] **MFA mandatory by role** — ADMIN/DPO/HEAD/PARTNER mandatory regardless of flag (T-018), RM with flag=false skips (T-019)
- [ ] **Rate limiting** — all auth endpoints (T-012, T-013, T-014)
- [ ] **No user enumeration** — identical responses for non-existent vs. wrong-password (T-023), identical on reset (T-015, T-016)
- [ ] **No PII in logs/audit** — T-024
- [ ] **No stack trace in error response** — T-025
- [ ] **Refresh token in httpOnly cookie, not localStorage** — T-026, UI-008
- [ ] **User status state machine** — active → locked (T-006), locked blocks login (T-007)
- [ ] **Append-only audit_logs** — INV-001 (UPDATE/DELETE rejected by DB)
- [ ] **Idle timeout** — T-011
- [ ] **E2E flows** — full login-to-dashboard (T-026), MFA end-to-end (T-027), silent refresh (T-028), idle redirect (T-029)
