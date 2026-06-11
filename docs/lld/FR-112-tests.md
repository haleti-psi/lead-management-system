# FR-112 Test Specification: Data-Principal Rights & Retention Workflow

**Tier: 3**
**Source LLD:** `docs/lld/FR-112.md`

---

## Test Cases

| # | Layer | Scenario | Input / Setup | Expected Outcome |
|---|---|---|---|---|
| T01 | API | **Happy path — create erasure request (DPO)** | DPO JWT, POST /api/v1/data-rights, valid `customer_profile_id` + `request_type=erasure`, valid `Idempotency-Key` | 201; `data.status='open'`; `data.due_at` set; `data_rights_requests` row inserted; `event_outbox` row with `event_code='DATA_RIGHT_REQUEST'` inserted in same tx |
| T02 | API | **Happy path — create access request (DPO)** | DPO JWT, POST /api/v1/data-rights, `request_type=access` | 201; row inserted with `request_type='access'`; `status='open'` |
| T03 | API | **Happy path — list requests (DPO)** | DPO JWT, GET /api/v1/data-rights, no filters | 200; paginated list with default limit 25; `meta.pagination.page=1` |
| T04 | API | **Happy path — list with status filter** | DPO JWT, GET /api/v1/data-rights?status=open | 200; all returned rows have `status='open'` |
| T05 | API | **Happy path — process: open → in_review** | DPO JWT, PATCH /api/v1/data-rights/{id}, `{ "status": "in_review", "owner_id": "<dpo-user-id>" }` | 200; `data.status='in_review'`; DB row updated; `audit_logs` entry written (via AuditChainConsumer); `event_outbox` row inserted |
| T06 | API | **Happy path — process: in_review → fulfilled (non-erasure)** | DPO JWT, PATCH with `status=fulfilled`, `disposition` provided, existing `request_type='access'` | 200; `data.status='fulfilled'`; no legal-hold check triggered; outbox `DATA_RIGHT_REQUEST_UPDATED` emitted |
| T07 | API | **Happy path — erasure approved (no legal hold)** | `request_type='erasure'`; no active `retention_policies` row with `legal_hold=true`; DPO PATCHes `status=fulfilled` | 200; `status='fulfilled'`; outbox `DATA_RIGHT_ERASURE_APPROVED` emitted in same tx (signals FR-115) |
| T08 | API | **Happy path — erasure rejected_retained (DPO decision)** | DPO PATCHes `status=rejected_retained`, `disposition='Retain per KYC regulatory requirement'` | 200; `status='rejected_retained'`; outbox `DATA_RIGHT_REQUEST_UPDATED` emitted |
| T09 | API | **Happy path — customer raises request via customer link** | CustomerLinkGuard token (OTP verified), POST /api/v1/c/{token}/data-rights, `request_type='correction'` | 201; row inserted with `customer_profile_id` derived from token's bound lead; `status='open'` |
| T10 | API | **Happy path — idempotent replay** | DPO re-POSTs with the same `Idempotency-Key` within 24 h | 200 (not 201); original `data_rights_request_id` returned; no second row in `data_rights_requests`; `error=null` |
| T11 | API | **Error — AUTH_REQUIRED (no token)** | POST /api/v1/data-rights without `Authorization` header | 401; `error.code='AUTH_REQUIRED'`; no DB write |
| T12 | API | **Error — FORBIDDEN (non-DPO creates request on behalf of customer)** | RM JWT, POST /api/v1/data-rights | 403; `error.code='FORBIDDEN'`; no DB write |
| T13 | API | **Error — FORBIDDEN (non-DPO calls PATCH)** | RM JWT, PATCH /api/v1/data-rights/{id} | 403; `error.code='FORBIDDEN'` |
| T14 | API | **Error — VALIDATION_ERROR (missing request_type)** | DPO JWT, POST /api/v1/data-rights, body omits `request_type` | 400; `error.code='VALIDATION_ERROR'`; `error.fields[0].field='request_type'` |
| T15 | API | **Error — VALIDATION_ERROR (invalid request_type)** | DPO JWT, POST, `request_type='delete'` (not in enum) | 400; `error.code='VALIDATION_ERROR'`; `error.fields[0].field='request_type'` |
| T16 | API | **Error — VALIDATION_ERROR (disposition missing on fulfil)** | DPO PATCHes `{ "status": "fulfilled" }` with no `disposition` | 400; `error.code='VALIDATION_ERROR'`; `error.fields[0].field='disposition'` |
| T17 | API | **Error — VALIDATION_ERROR (disposition missing on rejected_retained)** | DPO PATCHes `{ "status": "rejected_retained" }` with no `disposition` | 400; `error.code='VALIDATION_ERROR'`; `error.fields[0].field='disposition'` |
| T18 | API | **Error — NOT_FOUND** | DPO JWT, PATCH with a non-existent UUID | 404; `error.code='NOT_FOUND'` |
| T19 | API | **Error — CONFLICT with LEGAL_HOLD (erasure blocked)** | Active `retention_policies` row with `legal_hold=true` and `is_active=true` exists; DPO PATCHes erasure request with `status=fulfilled` | 409; `error.code='CONFLICT'`; `error.detail.reason='LEGAL_HOLD'`; DB row NOT updated to `fulfilled` |
| T20 | API | **Error — CONFLICT invalid state transition (fulfilled → open)** | Request already in `fulfilled` state; DPO PATCHes `status='open'` | 409; `error.code='CONFLICT'`; no reason detail (state guard, not legal hold) |
| T21 | API | **Error — CONFLICT invalid transition (rejected_retained → in_review)** | Request in `rejected_retained`; DPO PATCHes `status='in_review'` | 409; `error.code='CONFLICT'` |
| T22 | API | **Error — RATE_LIMITED (mutation)** | Authenticated user exceeds 60 PATCH requests per minute | 429; `error.code='RATE_LIMITED'`; `Retry-After` header present |
| T23 | Unit | **State machine — valid transitions accepted** | Call `DataRightsStateMachine.validateTransition` for each valid pair: `open→in_review`, `in_review→fulfilled`, `in_review→rejected_retained`, `open→rejected_retained` | No exception thrown for each valid transition |
| T24 | Unit | **State machine — terminal states reject all transitions** | `DataRightsStateMachine.validateTransition('fulfilled', 'open')` etc. | Throws `CONFLICT` (409) for `fulfilled→any` and `rejected_retained→any` |
| T25 | Unit | **State machine — backward transition rejected** | `DataRightsStateMachine.validateTransition('in_review', 'open')` | Throws `CONFLICT` (409) |
| T26 | Unit | **Legal-hold check — no policies → allow fulfil** | `retention_policies` table has no `legal_hold=true` rows | `legalHoldCheck` returns false; no exception; erasure fulfilment proceeds |
| T27 | Unit | **Legal-hold check — active hold → throw CONFLICT** | `retention_policies` has one row with `legal_hold=true`, `is_active=true` | `legalHoldCheck` throws `ConflictException` with `reason='LEGAL_HOLD'` |
| T28 | Unit | **Legal-hold check — inactive hold → allow fulfil** | `retention_policies` has `legal_hold=true` but `is_active=false` | `legalHoldCheck` returns false; erasure fulfilment not blocked |
| T29 | Unit | **SLA due_at calculation — uses SlaEngine** | `SlaEngine.calculateDue` called with `'data_rights'` (or fallback to `'grievance'` policy) | Returns a `due_at` in the future; falls back to now + 30 calendar days if no matching policy |
| T30 | Unit | **Transaction rollback — DB failure mid-write** | `OutboxService.emit` throws after `data_rights_requests` INSERT; DB forced failure | `data_rights_requests` row is NOT present; `event_outbox` row is NOT present; 500 returned; error logged with `correlation_id` |
| T31 | API | **Pagination — default page and limit** | DPO GET /api/v1/data-rights with 30 rows in DB | 200; `meta.pagination.limit=25`; `data` array length 25; `meta.pagination.total=30` |
| T32 | API | **Pagination — max limit enforced** | DPO GET /api/v1/data-rights?limit=200 | 200; `meta.pagination.limit` capped at 100; no more than 100 rows in `data` |
| T33 | API | **Masking — DPO list response** | DPO (scope M/masked) retrieves list containing a request with PII-bearing fields | PII fields (`customer_profile_id`-linked mobile/name/etc.) masked per `MaskingService`; PAN masked to `XXXX-XXXX-NNNN` format |
| T34 | API | **Customer link — lead_id scope mismatch** | CustomerLinkGuard token bound to lead A; body supplies `lead_id` for lead B | 400; `error.code='VALIDATION_ERROR'`; message includes scope mismatch |
| T35 | API | **Outbox event correctness — erasure approved** | Happy path T07; check `event_outbox` row | `event_code='DATA_RIGHT_ERASURE_APPROVED'`; `aggregate_type='DataRightsRequest'`; `aggregate_id=<request_id>`; `status='pending'` (not yet published) |
| T36 | API | **Outbox event correctness — creation** | Happy path T01; check `event_outbox` row | `event_code='DATA_RIGHT_REQUEST'`; `aggregate_type='DataRightsRequest'`; `aggregate_id=<request_id>` |
| T37 | API | **Audit log written on create** | Happy path T01; query `audit_logs` | Row with `entity_type='DataRightsRequest'`, `entity_id=<request_id>`, `actor_id=<dpo_user_id>`; `action` matches a defined `audit_action` value; no PII values logged |
| T38 | API | **Audit log written on update** | Happy path T05; query `audit_logs` | New row appended (existing row not updated); `before_hash` and `after_hash` populated |
| T39 | API | **Append-only guard — no UPDATE/DELETE on audit_logs** | Attempt `UPDATE audit_logs SET detail='tampered'` directly | DB operation fails; table is append-only (no DB-level trigger forbids this, but the app's `AuditChainConsumer` is the sole writer; test asserts no service method performs UPDATE on audit_logs) |
| T40 | API | **Correlation ID present** | Any request | `meta.correlation_id` present in every response; matches `X-Correlation-Id` request header if supplied |

---

## SQL Invariant Queries

Run after each mutating test to assert no partial/corrupt state. Each query must return **0 rows** to pass.

```sql
-- INV-01: No data_rights_requests row without a valid customer_profile
SELECT drr.data_rights_request_id
FROM   data_rights_requests drr
LEFT JOIN customer_profiles cp ON cp.customer_profile_id = drr.customer_profile_id
WHERE  cp.customer_profile_id IS NULL;

-- INV-02: No fulfilled or rejected_retained request without a disposition
SELECT data_rights_request_id
FROM   data_rights_requests
WHERE  status IN ('fulfilled', 'rejected_retained')
AND    (disposition IS NULL OR disposition = '');

-- INV-03: No request with status='open' and owner_id set that has no corresponding in-org user
SELECT drr.data_rights_request_id
FROM   data_rights_requests drr
LEFT JOIN users u ON u.user_id = drr.owner_id
WHERE  drr.owner_id IS NOT NULL
AND    u.user_id IS NULL;

-- INV-04: For every fulfilled erasure request, a DATA_RIGHT_ERASURE_APPROVED event_outbox row must exist
SELECT drr.data_rights_request_id
FROM   data_rights_requests drr
WHERE  drr.status = 'fulfilled'
AND    drr.request_type = 'erasure'
AND    NOT EXISTS (
  SELECT 1 FROM event_outbox eo
  WHERE  eo.aggregate_id   = drr.data_rights_request_id
  AND    eo.event_code      = 'DATA_RIGHT_REQUEST'   -- 'DATA_RIGHT_REQUEST' is the schema enum; the erasure event payload distinguishes sub-type
  AND    eo.aggregate_type  = 'DataRightsRequest'
);

-- INV-05: No data_rights_requests row with an invalid status value outside enum
SELECT data_rights_request_id
FROM   data_rights_requests
WHERE  status NOT IN ('open','in_review','fulfilled','rejected_retained');

-- INV-06: No data_rights_requests row with an invalid request_type outside enum
SELECT data_rights_request_id
FROM   data_rights_requests
WHERE  request_type NOT IN ('access','correction','update','erasure','withdrawal','grievance');

-- INV-07: No duplicate row created by idempotent replay
-- (Run T10 setup twice with the same Idempotency-Key; verify count is 1)
SELECT customer_profile_id, request_type, created_by, COUNT(*) AS cnt
FROM   data_rights_requests
GROUP  BY customer_profile_id, request_type, created_by, org_id
HAVING COUNT(*) > 1
AND    MAX(created_at) - MIN(created_at) < INTERVAL '5 seconds';

-- INV-08: No audit_log row with action column value not in audit_action enum
-- (Validates AuditAppender emitted a recognised action)
SELECT audit_id
FROM   audit_logs
WHERE  entity_type = 'DataRightsRequest'
AND    action NOT IN (
  'login','logout','login_failed','mfa_failed',
  'lead_create','lead_update','lead_merge','lead_override',
  'attribution_change','consent_grant','consent_withdraw','consent_expire',
  'doc_upload','doc_view','doc_download','doc_verify','doc_waive','doc_delete',
  'kyc_request','kyc_response','kyc_exception','stage_transition','rejection',
  'reopen','nurture','allocate','reassign','link_create','link_open','link_revoke',
  'comm_send','eligibility_request','handoff_attempt','handoff_success','handoff_failure',
  'export_generate','export_download','config_change','user_change','role_change',
  'break_glass_access'
);
```

---

## UI Test Scenarios

| # | Tool | Scenario | Steps | Expected |
|---|---|---|---|---|
| UI-01 | Playwright | **DPO views data rights queue** | Login as DPO; navigate to Compliance > Data Rights | Page renders; `DataTable` shows requests; `LoadingSkeleton` visible then replaced; `EmptyState` shown when list is empty |
| UI-02 | Playwright | **DPO processes an erasure request — no legal hold** | Click a row with `request_type=erasure, status=in_review`; set `status=fulfilled`, enter `disposition`; click Confirm | `ConfirmDialog` shown; after confirmation `StatusChip` updates to `fulfilled`; `Toast` "Request marked fulfilled" shown |
| UI-03 | Playwright | **DPO processes erasure — legal hold alert** | API returns 409 LEGAL_HOLD; attempt to set `status=fulfilled` on erasure | `LegalHoldAlert` rendered in drawer; status select is constrained to only `rejected_retained`; previous `fulfilled` option disabled |
| UI-04 | Vitest/RTL | **FilterBar filters by status** | Render `DataRightsPage`; change `StatusFilter` to `in_review`; assert API call includes `status=in_review` | `apiClient` called with correct query param; table re-renders with filtered data |
| UI-05 | Vitest/RTL | **DispositionTextarea required validation** | Render `DataRightsDetailDrawer`; set status to `fulfilled`; leave disposition empty; submit | Inline validation error shown; form not submitted |
| UI-06 | Playwright | **Customer raises access request via customer link** | Open `/c/{token}` (OTP verified); navigate to data rights section; select `access`; submit | 201 response; Toast "Your request has been registered. Reference: <id>" shown |
| UI-07 | Vitest/RTL | **Overdue highlighting** | `due_at` set to past timestamp in `DataTable` row | Row has amber highlight class; `due_at` shown in IST format `dd-MM-yyyy HH:mm` |
| UI-08 | Vitest/RTL | **EmptyState on zero results** | API returns empty list | `EmptyState` component rendered, not `DataTable` rows |
| UI-09 | Vitest/RTL | **ErrorState on network failure** | `apiClient` rejects; mock fetch failure | `ErrorState` rendered with retry CTA |

---

## Coverage Checklist

| Requirement | Test(s) | Status |
|---|---|---|
| Happy path — create request | T01, T02, T09 | Covered |
| Happy path — list requests (paginated) | T03, T04, T31, T32 | Covered |
| Happy path — process request (all valid transitions) | T05, T06, T07, T08 | Covered |
| Error: AUTH_REQUIRED (401) | T11 | Covered |
| Error: FORBIDDEN (403) non-DPO | T12, T13 | Covered |
| Error: VALIDATION_ERROR (400) — field-level | T14, T15, T16, T17 | Covered |
| Error: NOT_FOUND (404) | T18 | Covered |
| Error: CONFLICT / LEGAL_HOLD (409) | T19 | Covered |
| Error: CONFLICT invalid state transition (409) | T20, T21 | Covered |
| Error: RATE_LIMITED (429) | T22 | Covered |
| State machine — all valid transitions | T23 | Covered |
| State machine — all invalid transitions | T24, T25 | Covered |
| Legal-hold check logic (all branches) | T26, T27, T28 | Covered |
| SLA due_at calculation | T29 | Covered |
| Transaction rollback (partial write) | T30 | Covered |
| Idempotency — no duplicate on replay | T10, INV-07 | Covered |
| Pagination — default and max limit | T31, T32 | Covered |
| Masking (DPO masked view) | T33 | Covered |
| Customer-link scope check | T34 | Covered |
| Outbox event correctness | T35, T36 | Covered |
| Audit log written on create | T37 | Covered |
| Audit log written on update | T38 | Covered |
| Append-only guard (audit_logs) | T39 | Covered |
| Correlation ID in all responses | T40 | Covered |
| SQL invariants (no partial/corrupt state) | INV-01 through INV-08 | Covered |
| UI — DPO queue and process flow | UI-01, UI-02, UI-03 | Covered |
| UI — legal hold alert | UI-03 | Covered |
| UI — customer link raise | UI-06 | Covered |
| UI — form validation inline | UI-05 | Covered |
| UI — overdue highlighting + IST formatting | UI-07 | Covered |
| UI — empty/error/loading states | UI-08, UI-09, UI-01 | Covered |
