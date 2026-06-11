# FR-030 Tests — Rules-Based Allocation

**Tier: 3**
**Source LLD:** `docs/lld/FR-030.md`

---

## Test Cases

| # | Layer | Scenario | Expected Result |
|---|-------|----------|-----------------|
| T01 | Unit | `AllocationService.allocate`: single matching rule (round_robin), two eligible RMs with equal load — picks RM with lower `created_at` as deterministic tie-break | Returns the earlier-created RM's `user_id` as `ownerId` |
| T02 | Unit | `AllocationService.allocate`: first rule matches on `product_code + source` but all RMs in pool are at capacity (`capacity_limit=2`, both have 2 active leads); second rule has no capacity check — falls through to second rule | Returns RM resolved by second rule; first rule skipped |
| T03 | Unit | `AllocationService.allocate`: `method='capacity'` — RM A has 5 active leads, RM B has 2; capacity_limit is 10 | Returns RM B (lowest count) |
| T04 | Unit | `AllocationService.allocate`: `method='specialist'` — filters pool to RMs whose `users.product_skills` contains the lead's `product_code`; remaining RM selected | Returns the specialist RM's id |
| T05 | Unit | `AllocationService.allocate`: `method='partner'` — lead source is DSA with a specific `partner_id`; rule target has matching `partner_id`; pool resolved from partner-assigned users | Returns partner-dedicated RM |
| T06 | Unit | `AllocationService.allocate`: `method='escalation'` — pool resolves to team manager (`reporting_manager_id` of team) | Returns team manager's user_id |
| T07 | Unit | `AllocationService.allocate`: no rule matches any criteria — falls to unassigned pool path; `owner_id=null` returned; pino `warn` logged | `ownerId` is null; `reason='no_rule_match'` in returned allocation result |
| T08 | Unit | `AllocationService.allocate`: rules evaluated in strict `priority_order ASC`; a lower-priority rule that would match is NOT selected when a higher-priority rule matches first | Returns RM from highest-priority (lowest number) matching rule |
| T09 | Unit | `LeadService.assignOwner`: optimistic lock — UPDATE returns 0 rows (version mismatch) | Throws `ConflictException` with code `CONFLICT` |
| T10 | Unit | `AllocationService.reassign` with `override_capacity=true` and caller role = SM | Throws `ForbiddenException`; SM is not permitted to override capacity |
| T11 | API | `POST /leads/{id}/reassign` — happy path: BM reassigns within their branch, reason provided, `new_owner_id` active and in scope, capacity available | HTTP 200; response envelope contains `owner_id = new_owner_id`; `stage = 'assigned'`; `version` incremented |
| T12 | API | `POST /leads/{id}/reassign` — missing `reason` field | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = 'reason'` |
| T13 | API | `POST /leads/{id}/reassign` — `reason` less than 5 characters | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = 'reason'` |
| T14 | API | `POST /leads/{id}/reassign` — `new_owner_id` is not a valid UUID | HTTP 400 `VALIDATION_ERROR`; `fields[0].field = 'new_owner_id'` |
| T15 | API | `POST /leads/{id}/reassign` — unauthenticated (no JWT) | HTTP 401 `AUTH_REQUIRED` |
| T16 | API | `POST /leads/{id}/reassign` — authenticated as RM (no `allocate` capability) | HTTP 403 `FORBIDDEN` |
| T17 | API | `POST /leads/{id}/reassign` — BM attempts to reassign a lead belonging to a different branch (out of scope) | HTTP 403 `FORBIDDEN` |
| T18 | API | `POST /leads/{id}/reassign` — SM attempts to reassign with `override_capacity=true` | HTTP 403 `FORBIDDEN` |
| T19 | API | `POST /leads/{id}/reassign` — lead not found (random UUID) | HTTP 404 `NOT_FOUND` |
| T20 | API | `POST /leads/{id}/reassign` — lead is in `handed_off` stage (terminal) | HTTP 409 `CONFLICT` |
| T21 | API | `POST /leads/{id}/reassign` — concurrent request sends stale `leads.version` (simulate by updating the lead between load and save) | HTTP 409 `CONFLICT` |
| T22 | API | `POST /leads/{id}/reassign` — `new_owner_id` is at capacity and `override_capacity=false` | HTTP 409 `CONFLICT` |
| T23 | API | `POST /leads/{id}/reassign` — BM uses `override_capacity=true` when RM is at capacity | HTTP 200; reassignment succeeds; audit log has `detail.override_capacity=true` |
| T24 | API | `POST /leads/{id}/reassign` — verify `stage_history` row inserted with `to_stage='assigned'` and `actor_id` = caller's `user_id` | DB query: `SELECT COUNT(*) FROM stage_history WHERE lead_id=? AND to_stage='assigned'` returns ≥ 1 |
| T25 | API | `POST /leads/{id}/reassign` — verify `audit_logs` row inserted with `action='reassign'` and `lead_id` correct | DB query: `SELECT COUNT(*) FROM audit_logs WHERE lead_id=? AND action='reassign'` returns 1 |
| T26 | API | `POST /leads/{id}/reassign` — verify `event_outbox` row inserted with `event_code='LEAD_ASSIGNED'` and `aggregate_id=lead_id` | DB query: `SELECT COUNT(*) FROM event_outbox WHERE aggregate_id=? AND event_code='LEAD_ASSIGNED'` returns 1 |
| T27 | API | `POST /leads/{id}/reassign` — forced mid-transaction failure (mock AuditAppender to throw after leads update) — verify full rollback | DB: lead retains old `owner_id`; no `stage_history` row; no `event_outbox` row (transaction rollback test) |
| T28 | API | `GET /admin/allocation-rules` — BM authenticated, 3 active rules exist | HTTP 200; `data` array length 3; `meta.pagination.total = 3` |
| T29 | API | `GET /admin/allocation-rules` — authenticated as RM (no `allocate` capability) | HTTP 403 `FORBIDDEN` |
| T30 | API | `GET /admin/allocation-rules` — unauthenticated | HTTP 401 `AUTH_REQUIRED` |
| T31 | API | `POST /admin/allocation-rules` — BM creates valid `branch` method rule | HTTP 201; `allocation_rule_id` returned; rule queryable via GET |
| T32 | API | `POST /admin/allocation-rules` — `priority_order` conflicts with existing rule for same org | HTTP 409 `CONFLICT` (unique constraint `uq_allocation_rules_order`) |
| T33 | API | `POST /admin/allocation-rules` — `method` not in enum | HTTP 400 `VALIDATION_ERROR` |
| T34 | API | Automatic allocation triggered on lead create — verify `captured → assigned` transition: `leads.stage='assigned'`, `leads.owner_id` set, `sla_first_contact_due_at` non-null | DB assertions post-creation |
| T35 | API | Automatic allocation — no matching rule — lead remains with `owner_id=null`; `event_outbox` has `LEAD_ASSIGNED` with `owner_id=null`; log contains `allocation.no_match` warning | DB + log assertions |

---

## SQL Invariant Queries
*Each query must return 0 rows for a correctly operating system.*

```sql
-- INV-01: No lead in 'assigned' stage has a null owner_id
-- (Unassigned pool leads have owner_id=null but stage='captured', not 'assigned')
SELECT lead_id FROM leads
WHERE stage = 'assigned'
  AND owner_id IS NULL
  AND deleted_at IS NULL;

-- INV-02: No allocation creates a stage_history row with from_stage = to_stage
-- (A real transition must change the stage)
SELECT stage_history_id FROM stage_history
WHERE from_stage = to_stage
  AND to_stage = 'assigned';

-- INV-03: No UPDATE or DELETE on stage_history (append-only invariant)
-- Verified by checking updated_at always equals created_at for stage_history
SELECT stage_history_id FROM stage_history
WHERE updated_at != created_at;

-- INV-04: No UPDATE or DELETE on audit_logs (append-only; hash-chain integrity)
SELECT audit_id FROM audit_logs
WHERE updated_at != created_at;

-- INV-05: Every 'assigned' stage lead has sla_first_contact_due_at set
SELECT lead_id FROM leads
WHERE stage = 'assigned'
  AND sla_first_contact_due_at IS NULL
  AND deleted_at IS NULL;

-- INV-06: No allocation_rule has a duplicate priority_order within the same org
SELECT org_id, priority_order, COUNT(*) AS cnt
FROM allocation_rules
GROUP BY org_id, priority_order
HAVING COUNT(*) > 1;

-- INV-07: For every LEAD_ASSIGNED event_outbox row, the referenced lead exists
SELECT eo.event_id FROM event_outbox eo
LEFT JOIN leads l ON l.lead_id = eo.aggregate_id
WHERE eo.event_code = 'LEAD_ASSIGNED'
  AND l.lead_id IS NULL;

-- INV-08: No reassign audit_log row exists without a corresponding stage_history row for the same lead
-- (Both must be written in the same transaction)
SELECT al.audit_id FROM audit_logs al
LEFT JOIN stage_history sh ON sh.lead_id = al.lead_id
  AND sh.to_stage = 'assigned'
  AND sh.occurred_at BETWEEN al.created_at - INTERVAL '1 second' AND al.created_at + INTERVAL '1 second'
WHERE al.action IN ('allocate', 'reassign')
  AND sh.stage_history_id IS NULL;
```

---

## UI Test Scenarios (Playwright)

| # | Scenario | Steps | Assertion |
|---|----------|-------|-----------|
| UI-01 | BM opens lead 360, clicks "Reassign", selects new RM, enters reason, submits | Login as BM → open lead → open Reassign Drawer → select RM from dropdown → fill reason → click Confirm | Toast "Lead reassigned to {name}" shown; lead header shows new owner name |
| UI-02 | Reassign modal shows capacity warning when target RM is near limit (90%+) | Select an RM with `active_count >= capacity_limit * 0.9` | Warning indicator shown in RM option; override capacity switch appears for BM |
| UI-03 | BM navigates to /admin/allocation-rules, creates a new round_robin rule | Login as BM → /admin/allocation-rules → "New Rule" → fill form → Save | New rule appears in DataTable with correct priority_order and method chip |
| UI-04 | RM navigates to /admin/allocation-rules | Login as RM → attempt to navigate to /admin/allocation-rules | 403 page or redirect shown; no rule data visible |
| UI-05 | Reassign form blocks submission when reason is empty | Open Reassign Drawer → select RM → leave reason blank → click Confirm | Inline validation error "Reason is required" on the reason field; form does not submit |

---

## Coverage Checklist

- [x] Happy path — automatic allocation (captured → assigned, single matching rule)
- [x] Happy path — manual reassign (BM within branch scope, reason provided)
- [x] Happy path — allocation rule admin CRUD (GET list, POST create)
- [x] Every error code the FR raises:
  - [x] `AUTH_REQUIRED` (401) — T15, T30
  - [x] `FORBIDDEN` (403) — T16, T17, T18, T29
  - [x] `NOT_FOUND` (404) — T19
  - [x] `VALIDATION_ERROR` (400) — T12, T13, T14, T33
  - [x] `CONFLICT` (409) — T20, T21, T22, T32
  - [x] `INTERNAL_ERROR` (500) — covered by global exception filter test (cross-FR); forced by T27 rollback
- [x] Authz negatives — RM denied `allocate`; BM denied cross-branch; SM denied capacity override
- [x] Optimistic lock / `CONFLICT` on stale version — T21
- [x] Capacity enforcement + BM override path — T22, T23
- [x] No-match fallback (unassigned pool) — T07, T35
- [x] Rule priority ordering (first-match wins) — T08
- [x] Transaction rollback (partial write prevention) — T27
- [x] Append-only invariants (`stage_history`, `audit_logs`) — INV-03, INV-04, T24, T25
- [x] Outbox emission (`LEAD_ASSIGNED`) — T26, INV-07
- [x] SLA timer set on allocation — T34, INV-05
- [x] Terminal stage block (`handed_off`) — T20
- [x] All allocation methods (round_robin T01, capacity T03, specialist T04, partner T05, escalation T06)
- [x] Tie-break determinism — T01
- [x] UI: reassign modal interaction and validation — UI-01, UI-02, UI-05
- [x] UI: allocation rules admin page — UI-03, UI-04
- [x] PII masking: no PII fields appear in allocation rule admin responses; RM names are staff identifiers, not customer PII — verified by response shape assertions in T28, T31
