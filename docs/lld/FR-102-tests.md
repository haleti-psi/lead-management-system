# FR-102: Telephony & Visit Logging — Test Specification

**Tier: 2** | Source LLD: `docs/lld/FR-102.md`

---

## Test Cases

Minimum required for Tier 2: 5 cases covering happy path + each error code the FR raises +
authz both ways + validation + state transitions. This specification provides 12 cases.

| # | Layer | Name | Scenario | Input | Expected outcome |
|---|-------|------|----------|-------|-----------------|
| TC-01 | API | Happy path — call disposition | RM logs `connected` disposition on own `call` task in `open` status | `PATCH /tasks/{id}` with `{disposition:"connected", result_note:"Spoke with customer."}` | 200 OK; `data.status="done"`, `data.disposition="connected"`; `tasks` row updated; `communication_logs` row inserted (`channel="in_app", status="sent"`); `audit_logs` row inserted (`action="lead_update", entity_type="tasks"`); `event_outbox` row inserted (`event_code="LEAD_STAGE_CHANGED"`); transaction committed atomically |
| TC-02 | API | Happy path — visit disposition with geo | RM logs `visited` on own `visit` task with valid geo payload | `PATCH /tasks/{id}` with `{disposition:"visited", geo:{lat:19.076,lng:72.877,accuracy_m:10}}` | 200 OK; `data.geo.lat=19.076`; `tasks.geo` JSONB stored; other side-effects same as TC-01 |
| TC-03 | API | Geo omitted — location permission denied | RM submits visit disposition without `geo` field | `PATCH /tasks/{id}` with `{disposition:"visited"}` (no geo) | 200 OK; `data.geo` is null; task updated; no validation error (geo is optional) |
| TC-04 | API | Auth required — no JWT | Request without Authorization header | `PATCH /tasks/{id}` (no token) | 401 `AUTH_REQUIRED`; `{data:null,error:{code:"AUTH_REQUIRED"}}` |
| TC-05 | API | FORBIDDEN — RM accesses another RM's task | RM-A attempts to log disposition on task owned by RM-B (different `owner_id`) | `PATCH /tasks/{id-owned-by-rm-b}` with RM-A credentials | 403 `FORBIDDEN`; no DB writes occur |
| TC-06 | API | FORBIDDEN — BM out of branch scope | BM of branch-X attempts to disposition a task whose lead is in branch-Y | `PATCH /tasks/{id-branch-y}` with BM-branch-X credentials | 403 `FORBIDDEN`; no DB writes |
| TC-07 | API | NOT_FOUND — task does not exist | Valid JWT; non-existent task UUID | `PATCH /tasks/00000000-0000-0000-0000-000000000099` | 404 `NOT_FOUND` |
| TC-08 | API | CONFLICT — task already done | Task is already in `done` status | `PATCH /tasks/{id-done}` with valid disposition | 409 `CONFLICT`; task row unchanged; no duplicate `communication_logs` row |
| TC-09 | API | VALIDATION_ERROR — invalid disposition value | Body contains a disposition string not in enum | `{disposition:"left_voicemail"}` | 400 `VALIDATION_ERROR`; `error.fields[0].field="disposition"` |
| TC-10 | API | VALIDATION_ERROR — next_action_at missing for rescheduled | `disposition="rescheduled"` without `next_action_at` | `{disposition:"rescheduled"}` | 400 `VALIDATION_ERROR`; `error.fields[0].field="next_action_at"` |
| TC-11 | API | VALIDATION_ERROR — geo on non-visit/call task | Task `type="doc_request"`; body includes `geo` | `{disposition:"connected", geo:{lat:19,lng:72,accuracy_m:5}}` | 400 `VALIDATION_ERROR`; `error.fields[0].field="geo"` |
| TC-12 | API | RATE_LIMITED — mutation rate limit | Same user fires 61 PATCH requests within 60 seconds | 61st request | 429 `RATE_LIMITED`; `Retry-After` header present |

---

## Extended Test Cases (important boundaries and invariants)

| # | Layer | Name | Scenario | Expected outcome |
|---|-------|------|----------|-----------------|
| TC-13 | Unit | `TaskService.logDisposition` — transaction rollback | Force `OutboxService.emit` to throw after task UPDATE and comm_log INSERT | Both the `tasks` UPDATE and the `communication_logs` INSERT are rolled back; `tasks.status` remains unchanged; `communication_logs` has no new row |
| TC-14 | Unit | `TaskService.logDisposition` — overdue task can be dispositioned | Task in `overdue` status | Disposition accepted; `tasks.status` transitions to `done`; no CONFLICT |
| TC-15 | API (Phase 1.5) | CTI port failure — manual record committed | `CTI_ENABLED=true`; TelephonyMockAdapter configured to throw | 503 `UPSTREAM_UNAVAILABLE`; but `tasks` disposition row IS committed (CTI call is post-commit); `integration_logs` row has `status="failed"` |
| TC-16 | API | BM happy path — branch-scoped | BM logs disposition on a task whose lead is in their branch (but owned by an RM) | 200 OK; full side-effects |
| TC-17 | E2E | Mobile visit log — geo capture and submit | Playwright with mocked `navigator.geolocation`; RM on `/visits/{taskId}` taps "Capture Location" then "Submit" | Network request contains `geo` object; success toast displayed; task card updates disposition label |
| TC-18 | E2E | Mobile visit log — geo permission denied | Playwright geolocation mocked to reject; RM on `/visits/{taskId}` | StatusChip shows "Location unavailable"; "Submit" still enabled; request sent without `geo`; 200 OK |

---

## SQL Invariant Queries

Run after each test case; expect 0 rows.

### INV-01: No partial writes — task done without communication_log

```sql
SELECT t.task_id
FROM tasks t
WHERE t.status = 'done'
  AND t.disposition IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM communication_logs cl
    WHERE cl.lead_id = t.lead_id
      AND cl.channel = 'in_app'
      AND cl.status = 'sent'
      AND cl.created_at >= t.updated_at - INTERVAL '1 second'
  );
-- Expect: 0 rows
```

### INV-02: No partial writes — task done without audit log

```sql
SELECT t.task_id
FROM tasks t
WHERE t.status = 'done'
  AND t.disposition IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.entity_type = 'tasks'
      AND al.entity_id = t.task_id
      AND al.action = 'lead_update'
  );
-- Expect: 0 rows
```

### INV-03: No geo stored on non-call/visit tasks

```sql
SELECT task_id, type, geo
FROM tasks
WHERE geo IS NOT NULL
  AND type NOT IN ('call', 'visit');
-- Expect: 0 rows
```

### INV-04: Audit logs are append-only (no UPDATE or DELETE issued by app)

```sql
-- This is validated by the REVOKE UPDATE/DELETE grant on audit_logs enforced at DB level.
-- Invariant query: confirm no audit log for a task has been modified (updated_at = created_at).
SELECT audit_id
FROM audit_logs
WHERE entity_type = 'tasks'
  AND updated_at <> created_at;
-- Expect: 0 rows (audit_logs has no set_updated_at trigger; any difference signals a violation)
```

### INV-05: communication_logs row for internal activity never has a template_id

```sql
SELECT communication_log_id
FROM communication_logs
WHERE channel = 'in_app'
  AND status = 'sent'
  AND template_id IS NOT NULL;
-- Expect: 0 rows (FR-102 internal activity logs have no template)
```

### INV-06: No event_outbox rows with NULL aggregate_id for task disposition events

```sql
SELECT event_id
FROM event_outbox
WHERE aggregate_type = 'tasks'
  AND aggregate_id IS NULL;
-- Expect: 0 rows
```

---

## UI Test Scenarios (Vitest / Testing-Library)

| # | Component | Scenario | Assert |
|---|-----------|----------|--------|
| UI-01 | `DispositionForm` | Renders disposition Select with all enum options | All 8 `disposition` enum values present in the dropdown |
| UI-02 | `DispositionForm` | `next_action_at` field appears when `rescheduled` selected | After selecting "rescheduled", DateTimePicker renders; not rendered for "connected" |
| UI-03 | `DispositionForm` | Submit disabled until disposition selected | Button `disabled` attribute set when `disposition` is unset |
| UI-04 | `GeoCapture` | Success state renders lat/lng preview | After `getCurrentPosition` resolves, preview text contains lat/lng values |
| UI-05 | `GeoCapture` | Permission denied renders StatusChip message | After `getCurrentPosition` rejects with PERMISSION_DENIED, StatusChip text contains "Location unavailable" |
| UI-06 | `DispositionForm` | API VALIDATION_ERROR maps to inline field error | When API returns `{error:{code:"VALIDATION_ERROR",fields:[{field:"disposition",issue:"..."}]}}`, error text appears beneath the Select |
| UI-07 | `DispositionForm` | Success toast shown after 200 OK | `Toast` "Outcome logged" appears after successful PATCH |

---

## Coverage Checklist

| Requirement | Covered by |
|-------------|------------|
| Happy path (call, no geo) | TC-01 |
| Happy path (visit, with geo) | TC-02 |
| Geo omitted — no error | TC-03 |
| `AUTH_REQUIRED` (401) | TC-04 |
| `FORBIDDEN` — out-of-scope RM | TC-05 |
| `FORBIDDEN` — BM cross-branch | TC-06 |
| `NOT_FOUND` (404) | TC-07 |
| `CONFLICT` — already done (409) | TC-08 |
| `VALIDATION_ERROR` — bad disposition enum | TC-09 |
| `VALIDATION_ERROR` — next_action_at required | TC-10 |
| `VALIDATION_ERROR` — geo on wrong task type | TC-11 |
| `RATE_LIMITED` (429) | TC-12 |
| Transaction rollback on partial failure | TC-13 |
| Overdue task can be dispositioned | TC-14 |
| `UPSTREAM_UNAVAILABLE` — CTI port failure (Phase 1.5) | TC-15 |
| BM branch-scoped authz positive | TC-16 |
| E2E — mobile geo capture and submit | TC-17 |
| E2E — mobile geo permission denied, graceful degradation | TC-18 |
| Append-only audit_logs invariant | INV-04 |
| No partial writes (task+comm_log atomicity) | INV-01, INV-02, TC-13 |
| Masking — no PII fields in this entity; masking interceptor runs globally | (global interceptor coverage) |
| Idempotency — duplicate call prevented by `WHERE status != 'done'` guard | TC-08 |
| CTI idempotency key deduplication (Phase 1.5) | TC-15 (IntegrationGateway contract) |
