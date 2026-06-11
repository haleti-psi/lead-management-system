# FR-140 Test Specification: Integration Framework

**Tier: 3** | Source LLD: `docs/lld/FR-140.md`

---

## Test Cases

| # | Layer | Name | Setup | Action | Expected | Error Code / Assertion |
|---|---|---|---|---|---|---|
| T01 | Unit | IntegrationGateway returns cached result on idempotency-key replay | Redis key `idem:gw:KEY1` set to `status=success` + serialised prior response | `gateway.call(port, req, { idempotencyKey: 'KEY1' })` | Returns the cached response; adapter `.call()` never invoked; `integration_logs` unchanged | Result has `idempotent=true`; adapter spy: 0 calls |
| T02 | Unit | IntegrationGateway writes `integration_logs` row with status=`pending` before adapter call | Clean Redis + empty DB | `gateway.call(LosPort, handoffReq, { idempotencyKey: 'NEW1' })` (mock adapter throws so we can assert pre-call state) | Row inserted with `status='pending'`, `retry_count=0`, `idempotency_key='NEW1'` before adapter is invoked | DB: `SELECT status FROM integration_logs WHERE idempotency_key='NEW1'` = `'pending'` (captured before adapter resolves) |
| T03 | Unit | IntegrationGateway updates log to `success` after 2xx provider response | Pending log row; mock adapter returns HTTP 201 | `gateway.call(port, req, opts)` | `integration_logs.status='success'`, `http_status=201`, `completed_at` NOT NULL; Redis idempotency key set to `success` | DB row updated; Redis `idem:gw:KEY` = `success` |
| T04 | Unit | IntegrationGateway sets log to `retrying` and enqueues Cloud Tasks on provider 5xx (retry_count < 3) | Mock adapter throws `UpstreamError(503)`, `retry_count=0` | `gateway.call(port, req, opts)` | Log status = `retrying`, `retry_count=1`; Cloud Tasks `createTask` spy called once | Cloud Tasks mock: `createTask` called with correct queue name + exponential delay payload |
| T05 | Unit | IntegrationGateway sets log to `failed` (final) and enqueues dead-letter on max retries | Mock adapter throws, `retry_count=3` | `gateway.call(port, req, opts)` | Log status = `failed`; Cloud Tasks retry NOT called; dead-letter task enqueued | Throws `UPSTREAM_UNAVAILABLE` (503); Cloud Tasks retry spy: 0 calls; dead-letter spy: 1 call |
| T06 | Unit | Circuit breaker opens after threshold consecutive failures | `cb:los_handoff:failures` counter at `CIRCUIT_BREAKER_THRESHOLD - 1` in Redis; mock adapter throws on next call | `gateway.call(LosPort, req)` | Redis `cb:los_handoff` set to `open` with `opens_at`; log written with `status=failed` | Redis key present; subsequent call to same integration fast-fails without adapter call |
| T07 | Unit | Open circuit returns 503 fast-fail without calling adapter | `cb:los_handoff` = `open` in Redis with future `opens_at` | `gateway.call(LosPort, req, opts)` | Throws `UPSTREAM_UNAVAILABLE` (503); `integration_logs` row inserted with `status='failed'`, `error_code='CB_OPEN'`, no `http_status` | Adapter `.call()` spy: 0 calls |
| T08 | Unit | Circuit breaker resets failure counter on successful half-open probe | `cb:los_handoff:failures=3`, `cb:los_handoff=half_open`; mock adapter returns 200 | `gateway.call(LosPort, req)` | `cb:los_handoff:failures` deleted / reset to 0; `cb:los_handoff` state cleared; log status = `success` | Redis assertions on both keys |
| T09 | Unit | LosWebhookGuard rejects inbound webhook with wrong HMAC signature | `LOS_WEBHOOK_HMAC_SECRET='test-secret'`; request body `'{"foo":"bar"}'`; `x-los-signature` = incorrect hex | Guard `canActivate()` called | Returns false / throws `ForbiddenException`; `error.code='FORBIDDEN'` | No downstream handler invoked |
| T10 | Unit | LosWebhookGuard accepts inbound webhook with correct HMAC signature | Correct HMAC computed from body + `'test-secret'`; `x-los-signature` = correct hex | Guard `canActivate()` called | Returns true; no exception thrown | Guard passes |
| T11 | Unit | CreateWebhookDto rejects `targetUrl` without `https://` prefix | — | Validate `{ eventCode: 'LEAD_HANDED_OFF', targetUrl: 'http://example.com', secretRef: 'projects/x/secrets/y/versions/1' }` via Zod | `ZodError`; `issues[0].path = ['targetUrl']`; message contains "Must begin with https://" | Zod parse fails |
| T12 | Unit | CreateWebhookDto rejects unknown `eventCode` | — | Validate `{ eventCode: 'UNKNOWN_CODE', targetUrl: 'https://ok.com', secretRef: 'projects/x/secrets/y/versions/1' }` | `ZodError` on `eventCode` field | |
| T13 | Unit | CreateWebhookDto rejects `secretRef` not starting with `projects/` | — | Validate `{ eventCode: 'LEAD_CREATED', targetUrl: 'https://ok.com', secretRef: 'sm://wrong/path' }` | `ZodError`; issue on `secretRef` "Must be a valid Secret Manager resource name" | |
| T14 | Unit | IntegrationMonitorQueryDto defaults page=1, limit=25, sort=`-created_at` | — | Parse empty query object `{}` | `page=1`, `limit=25`, `sort='-created_at'` | Zod default values applied |
| T15 | Unit | IntegrationMonitorQueryDto rejects limit > 100 | — | Parse `{ limit: 150 }` | `ZodError` on `limit` field | |
| T16 | API | GET /admin/integrations — ADMIN returns paginated logs | Seed 3 `integration_logs` rows via factory | `GET /api/v1/admin/integrations` with ADMIN JWT | HTTP 200; `data.length = 3`; `meta.pagination.total = 3`; `error = null` | |
| T17 | API | GET /admin/integrations — filter by `status=failed` returns only failed rows | Seed 2 `success` + 2 `failed` rows | `GET /api/v1/admin/integrations?filter[status]=failed` | HTTP 200; `data.length = 2`; every row has `status='failed'` | |
| T18 | API | GET /admin/integrations — unauthenticated returns 401 | — | `GET /api/v1/admin/integrations` with no Authorization header | HTTP 401; `error.code='AUTH_REQUIRED'` | `AUTH_REQUIRED` |
| T19 | API | GET /admin/integrations — RM role returns 403 | RM JWT (scope O, no `configuration`) | `GET /api/v1/admin/integrations` | HTTP 403; `error.code='FORBIDDEN'` | `FORBIDDEN` |
| T20 | API | GET /admin/integrations — BM role returns 403 (scope B insufficient for all-org monitor) | BM JWT (configuration scope B) | `GET /api/v1/admin/integrations` | HTTP 403; `error.code='FORBIDDEN'` | `FORBIDDEN` |
| T21 | API | GET /admin/webhooks — ADMIN returns list without `secret_ref` | 2 webhook_subscriptions rows in DB | `GET /api/v1/admin/webhooks` with ADMIN JWT | HTTP 200; `data[0]` does NOT contain `secretRef` or `secret_ref` keys | `Object.keys(data[0])` must not include `secretRef` or `secret_ref` |
| T22 | API | GET /admin/webhooks — default pagination returns max 25 rows | Seed 30 webhook rows | `GET /api/v1/admin/webhooks` (no limit param) | `data.length = 25`; `meta.pagination.total = 30` | LIMIT 25 enforced |
| T23 | API | POST /admin/webhooks — ADMIN creates webhook subscription successfully | Empty DB | `POST /api/v1/admin/webhooks` with valid body `{ eventCode, targetUrl, secretRef }` | HTTP 201; `data.webhookSubscriptionId` is a UUID; `secretRef` absent from response; DB has 1 row | DB: `SELECT count(*) FROM webhook_subscriptions WHERE target_url = 'https://…'` = 1 |
| T24 | API | POST /admin/webhooks — validation rejects `http://` targetUrl | — | `POST /api/v1/admin/webhooks` body `{ …, targetUrl: 'http://bad.example.com' }` | HTTP 400; `error.code='VALIDATION_ERROR'`; `error.fields[0].field='targetUrl'` | `VALIDATION_ERROR` |
| T25 | API | POST /admin/webhooks — idempotent replay returns original response, no duplicate DB row | First request succeeded; same `Idempotency-Key` cached in Redis | Second `POST /api/v1/admin/webhooks` with same `Idempotency-Key` | HTTP 200; `data` = original created row; `error.detail.reason='IDEMPOTENT_REPLAY'`; DB row count unchanged at 1 | DB: `SELECT count(*) FROM webhook_subscriptions WHERE event_code=… AND target_url=…` = 1 |
| T26 | API | POST /admin/webhooks — unauthenticated returns 401 | — | `POST /api/v1/admin/webhooks` with no JWT | HTTP 401; `error.code='AUTH_REQUIRED'` | `AUTH_REQUIRED` |
| T27 | API | POST /admin/webhooks — PARTNER role returns 403 | PARTNER JWT | `POST /api/v1/admin/webhooks` | HTTP 403; `error.code='FORBIDDEN'` | `FORBIDDEN` |
| T28 | API | POST /admin/webhooks — rate limit enforced (60 mutations/min) | — | Send 61 mutation requests within 1 min from same authenticated user | 61st request: HTTP 429; `error.code='RATE_LIMITED'` | `RATE_LIMITED` |
| T29 | API | IntegrationGateway — provider down returns UPSTREAM_UNAVAILABLE to caller | Mock LosPort throws timeout; `retry_count=0` in log | Trigger action that calls gateway (e.g. LOS eligibility stub endpoint) | HTTP 503 to original caller; `error.code='UPSTREAM_UNAVAILABLE'`; `integration_logs.status='retrying'` | `UPSTREAM_UNAVAILABLE` |
| T30 | API | POST /admin/webhooks — transaction rollback on DB failure, no partial state | Force unique-PK collision via DB mock | `POST /api/v1/admin/webhooks` | HTTP 500 `INTERNAL_ERROR`; no partial row in `webhook_subscriptions`; no orphaned audit entry for this call | INV-03 returns 0 rows |
| T31 | API | GET /admin/integrations — limit=100 returns at most 100 rows | Seed 150 `integration_logs` rows | `GET /api/v1/admin/integrations?limit=100` | `data.length = 100`; `meta.pagination.total = 150` | Max 100 enforced; LIMIT hard-coded in query |
| T32 | API | GET /admin/integrations — sort by `-retry_count` descending | 3 rows with retry_count 0, 1, 2 | `GET /api/v1/admin/integrations?sort=-retry_count` | First row has highest `retryCount`; order is 2, 1, 0 | Sort applied correctly |

---

## SQL Invariant Queries

Run via Testcontainers-Postgres after each relevant test. Every query must return **0 rows**.

```sql
-- INV-01: No integration_logs row may share a non-null idempotency_key with another row.
-- (Verifies partial unique index uq_integration_idempotency is respected at the DB level.)
SELECT idempotency_key, COUNT(*) AS cnt
FROM integration_logs
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
-- EXPECT: 0 rows

-- INV-02: No webhook_subscription may have a non-https target_url.
-- (Verifies CHECK constraint ck_webhook_https cannot be bypassed by the app layer.)
SELECT webhook_subscription_id
FROM webhook_subscriptions
WHERE target_url NOT LIKE 'https://%';
-- EXPECT: 0 rows

-- INV-03: After a rolled-back webhook creation, no orphaned audit_logs row exists for
-- the rolled-back subscription. (audit_logs are written by AuditChainConsumer post-commit;
-- a rollback must not produce an intent that the consumer later writes.)
SELECT a.audit_log_id
FROM audit_logs a
WHERE a.action = 'webhook_subscription_created'
  AND a.target_id NOT IN (
    SELECT webhook_subscription_id::text FROM webhook_subscriptions
  );
-- EXPECT: 0 rows

-- INV-04: integration_logs.retry_count must be between 0 and MAX_RETRIES (3) inclusive.
SELECT integration_log_id
FROM integration_logs
WHERE retry_count < 0 OR retry_count > 3;
-- EXPECT: 0 rows

-- INV-05: integration_logs rows with status='success' must have completed_at set.
SELECT integration_log_id
FROM integration_logs
WHERE status = 'success' AND completed_at IS NULL;
-- EXPECT: 0 rows

-- INV-06: integration_logs rows with status='retrying' must have retry_count >= 1.
SELECT integration_log_id
FROM integration_logs
WHERE status = 'retrying' AND retry_count < 1;
-- EXPECT: 0 rows

-- INV-07: Append-only enforcement on audit_logs — UPDATE/DELETE must fail.
-- Tested by attempting:
--   UPDATE audit_logs SET action = 'tampered' WHERE audit_log_id = '<any uuid>';
-- EXPECT: PostgresError "permission denied for table audit_logs"
-- (The DB role used by the app is granted INSERT only on audit_logs; no UPDATE/DELETE.)
-- This is a negative test; no SELECT invariant query needed — the permission error IS the assertion.
```

---

## UI Test Scenarios

### Playwright E2E (`apps/web/e2e/admin-integrations.spec.ts`)

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| UI-01 | ADMIN views integration monitor page | Log in as ADMIN; navigate to `/admin/integrations` | Page renders with DataTable showing columns: Integration, Direction, Status, HTTP Status, Retry Count, Created At; pagination controls visible |
| UI-02 | Filter by status=`failed` shows only failed rows | On integration monitor, select `failed` in Status filter dropdown | DataTable updates; all visible rows show StatusChip variant for `failed`; no `success` rows visible |
| UI-03 | Navigate to webhooks page and create a new webhook | Navigate to `/admin/webhooks`; click "Add Webhook"; fill valid `eventCode`, `targetUrl` (https://), `secretRef`; click "Create" | Drawer closes; Toast "Webhook created" appears; new row appears in DataTable; row does NOT show secretRef |
| UI-04 | Create webhook — inline validation error for http:// URL | Open "Add Webhook" drawer; set `targetUrl = 'http://notSecure.example.com'`; click "Create" | EntityForm shows inline error "Must begin with https://" on targetUrl field; drawer remains open; no API call |
| UI-05 | Non-ADMIN role cannot access integration monitor | Log in as RM; navigate directly to `/admin/integrations` | Route is not in AppShell nav; direct navigation redirects to 403/unauthorized page |
| UI-06 | Keyboard navigation through Add Webhook form | Open drawer; Tab through all form fields; activate submit with Enter | All inputs focusable in order; form submits on Enter from last field; no mouse required |

---

## Coverage Checklist

### Error codes FR-140 raises

- [x] `AUTH_REQUIRED` (401) — T18, T26
- [x] `FORBIDDEN` (403) — T19, T20, T27; T09 (inbound HMAC mismatch in LosWebhookGuard)
- [x] `VALIDATION_ERROR` (400) — T11, T12, T13, T24
- [x] `RATE_LIMITED` (429) — T28
- [x] `INTERNAL_ERROR` (500) — T30
- [x] `UPSTREAM_UNAVAILABLE` (503) — T04, T05, T06, T07, T29
- [x] `IDEMPOTENT_REPLAY` sub-reason (HTTP 200) — T01, T25

### Mandatory coverage per `docs/contracts/testing-contract.md`

- [x] Happy paths — T03, T10, T16, T21, T23
- [x] Every named error code raised by FR — see list above
- [x] Authorization negatives (out-of-scope role denied) — T18, T19, T20, T26, T27, UI-05
- [x] Idempotency — replay returns original result; no duplicate DB row — T01, T25
- [x] Transaction rollback (no partial state on failure) — T30 + INV-03
- [x] LIMIT enforced on list queries — T22, T31
- [x] Append-only audit_logs cannot be modified (UPDATE rejected) — INV-07
- [x] State machine transitions: pending→success, pending→failed, failed→retrying, retrying→failed — T02, T03, T04, T05
- [x] Circuit breaker open / fast-fail / reset — T06, T07, T08
- [x] Inbound HMAC signature verification (good and bad) — T09, T10
- [x] `secret_ref` never returned in API response — T21, T23
- [x] Pagination default (25) and max (100) enforcement — T22, T31
- [x] Sort parameter applied correctly — T32
- [x] UI inline validation and keyboard navigation — UI-04, UI-06
- [x] Non-ADMIN UI route guard — UI-05

### Not applicable for FR-140

- Optimistic lock (`expectedVersion` on `leads`) — FR-140 does not write `leads`; `LeadService` is not called
- Consent gate — integration framework is infrastructure; no consent purpose is required to call the gateway
- Masking — `integration_logs` contains no PII fields (`request_ref` is a GCS path reference, not raw payload); `webhook_subscriptions` contains no PII
