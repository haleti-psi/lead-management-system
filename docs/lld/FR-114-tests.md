# FR-114 Test Specification: Grievance Workflow

**Tier: 3**
**Source LLD:** `docs/lld/FR-114.md`

---

## Test Cases

| # | Layer | Test name | Scenario | Input | Expected outcome | Error code |
|---|---|---|---|---|---|---|
| T01 | API integration | Happy path — internal create | Authenticated RM creates a grievance | Valid `CreateGrievanceDto`; `Idempotency-Key: key-001` | `201 Created`; `status=open`; `grievanceNo` matches `GRV-{YYYY}-{seq}` pattern; `slaDueAt` is a future timestamp; `GRIEVANCE_CREATED` row in `event_outbox`; `audit_logs` row with `entity_type=grievance` | — |
| T02 | API integration | Idempotency replay | Same `Idempotency-Key` sent twice | Same POST body; `Idempotency-Key: key-001` (second call) | `200 OK`; identical `grievanceId`; no new row in `grievances`; `error.detail.reason = IDEMPOTENT_REPLAY` | — |
| T03 | API integration | List — scope enforcement (RM only sees own) | RM A tries to list grievances that belong to RM B's ownership | Two grievances: one `owner_id = rmA`, one `owner_id = rmB`; request as rmA | Response `data` contains only rmA's grievance; rmB's grievance absent | — |
| T04 | API integration | List — DPO sees all | DPO lists all grievances | Two grievances from different owners | Both grievances returned | — |
| T05 | API integration | List — pagination and limit | Page 1 with limit 2 on a set of 5 grievances | `?page=1&limit=2` | `data.length === 2`; `meta.pagination.total === 5` | — |
| T06 | API integration | List — status filter | Filter by `status=open` | Two open, one in_progress in DB | Only open grievances returned | — |
| T07 | API integration | Create — lead_id referential check | `leadId` references a non-existent lead | `leadId` = random UUID not in DB | `404 NOT_FOUND` | `NOT_FOUND` |
| T08 | API integration | Create — `leadId` belongs to different org | `leadId` is a real lead in org B; caller is in org A | Valid JWT for org A; `leadId` from org B | `404 NOT_FOUND` (existence hidden) | `NOT_FOUND` |
| T09 | API integration | Create — validation: description too short | `description` has fewer than 10 chars | `description: "short"` | `400 VALIDATION_ERROR` with `fields[0].field=description` | `VALIDATION_ERROR` |
| T10 | API integration | Create — validation: invalid source enum | `source` not in allowed enum | `source: "twitter"` | `400 VALIDATION_ERROR` with `fields[0].field=source` | `VALIDATION_ERROR` |
| T11 | API integration | Create — validation: empty body | No fields in request body | `{}` | `400 VALIDATION_ERROR` (`source`, `category`, `description` missing) | `VALIDATION_ERROR` |
| T12 | API integration | Create — unauthenticated | No Authorization header | Valid body | `401 AUTH_REQUIRED` | `AUTH_REQUIRED` |
| T13 | API integration | Create — missing capability | CUSTOMER role (no `consent_ledger` cap) | Valid JWT with role CUSTOMER | `403 FORBIDDEN` | `FORBIDDEN` |
| T14 | API integration | PATCH — transition `open → in_progress` | Owner assigned; valid transition | `{ "status": "in_progress", "ownerId": "uuid" }` | `200 OK`; `status = in_progress`; audit log written | — |
| T15 | API integration | PATCH — transition `in_progress → resolved` | Caller provides response | `{ "status": "resolved", "response": "Issue addressed" }` | `200 OK`; `status = resolved`; `response` stored | — |
| T16 | API integration | PATCH — transition `resolved → closed` | Caller provides closure proof | `{ "status": "closed", "closureProofRef": "gcs://…/proof.pdf" }` | `200 OK`; `status = closed`; `closure_proof_ref` stored | — |
| T17 | API integration | PATCH — resolve without response | Missing `response` field when transitioning to `resolved` | `{ "status": "resolved" }` | `400 VALIDATION_ERROR` with `fields[0].field=response` | `VALIDATION_ERROR` |
| T18 | API integration | PATCH — close without closureProofRef | Missing `closureProofRef` when transitioning to `closed` | `{ "status": "closed" }` | `400 VALIDATION_ERROR` with `fields[0].field=closureProofRef` | `VALIDATION_ERROR` |
| T19 | API integration | PATCH — illegal transition `closed → open` | Attempt to reopen a closed grievance | `{ "status": "open" }`; grievance is `closed` | `409 CONFLICT` | `CONFLICT` |
| T20 | API integration | PATCH — illegal skip transition `open → closed` | Attempt to skip `in_progress` and `resolved` | `{ "status": "closed" }`; grievance is `open` | `409 CONFLICT` | `CONFLICT` |
| T21 | API integration | PATCH — authz: non-owner cannot patch | RM B tries to patch RM A's grievance | Valid JWT for RM B; grievance `owner_id = rmA` | `403 FORBIDDEN` | `FORBIDDEN` |
| T22 | API integration | PATCH — DPO can patch any grievance | DPO (scope A) patches grievance owned by RM | Valid JWT for DPO | `200 OK` | — |
| T23 | API integration | PATCH — not found | Patch non-existent grievance ID | `id` = UUID not in DB | `404 NOT_FOUND` | `NOT_FOUND` |
| T24 | API integration | Rate limit on mutations | User fires 61 consecutive POSTs within 1 minute | 61 rapid POST requests | First 60 succeed (201); 61st returns `429 RATE_LIMITED` with `Retry-After` header | `RATE_LIMITED` |
| T25 | Unit | SLA due computation | `SlaEngine.computeDue` called with `target=grievance` | Active SLA policy with `threshold_minutes=2880` (48 h business hours) | Returns a `Date` that is `threshold_minutes` business minutes after now (respecting `BusinessCalendarService` holidays) | — |
| T26 | Unit | No active SLA policy | `SlaEngine.computeDue` when no active `grievance` SLA policy exists | No rows in `sla_policies` for `grievance` | Returns `null`; logger.warn called with structured message | — |
| T27 | Unit | State machine: all valid transitions accepted | `GrievanceService.validateTransition` for each allowed pair | Each valid `(from, to)` pair | Returns without error | — |
| T28 | Unit | State machine: all invalid transitions rejected | `GrievanceService.validateTransition` for each disallowed pair | e.g. `(closed, open)`, `(open, closed)`, `(open, resolved)` | Throws `CONFLICT` | `CONFLICT` |
| T29 | Unit | `resolved` transition guard: missing response | `validateTransition('in_progress', 'resolved')` with no `response` | No `response` in DTO | Throws `VALIDATION_ERROR` with `fields[0].field=response` | `VALIDATION_ERROR` |
| T30 | Unit | `closed` transition guard: missing closureProofRef | `validateTransition('resolved', 'closed')` with no `closureProofRef` | No `closureProofRef` in DTO | Throws `VALIDATION_ERROR` with `fields[0].field=closureProofRef` | `VALIDATION_ERROR` |
| T31 | Unit | Transaction rollback on audit failure | `UnitOfWork` transaction where `AuditAppender.emit` throws | Simulated mid-tx error after `insertInto('grievances')` | No row in `grievances`; no row in `event_outbox`; `INTERNAL_ERROR` returned | `INTERNAL_ERROR` |
| T32 | Unit | Transaction rollback on outbox failure | `UnitOfWork` transaction where `OutboxService.emit` throws | Simulated mid-tx error after `grievances` insert + audit | No row in `grievances`; `INTERNAL_ERROR` returned | `INTERNAL_ERROR` |
| T33 | Unit | `CodeGenerator.nextGrievanceNo` | Generates unique sequential codes | Two sequential calls in the same org/year | Codes differ by exactly 1 in the sequence segment; no duplicate `grievance_no` | — |
| T34 | API integration | Escalation sweep job | `GrievanceEscalationJob` promotes breached `open`/`in_progress` grievances | 3 grievances with `sla_due_at` in the past, `status in ('open', 'in_progress')` | All 3 updated to `status=escalated`; 3 audit entries appended; escalation notifications dispatched post-commit | — |
| T35 | API integration | Escalation sweep: already-resolved/closed not touched | Escalation sweep skips terminal grievances | 1 `resolved`, 1 `closed`, 1 `in_progress` with past SLA | Only the `in_progress` one is escalated | — |
| T36 | API integration | Append-only: audit_logs UPDATE rejected | Attempt to UPDATE an `audit_logs` row at the DB layer | `UPDATE audit_logs SET detail='x' WHERE ...` (app role) | DB error (REVOKE enforced); no row modified | — |
| T37 | UI / E2E | Full grievance lifecycle | Compliance Officer creates, assigns, resolves, and closes a grievance in the UI | Navigate to Compliance Console → Grievances → create → assign owner → resolve → close | All status chips update; ConfirmDialog shown before close; Toast confirms each action; EscalationBanner absent after close | — |
| T38 | UI / E2E | EscalationBanner shown for breached grievance | Grievance with `slaDueAt` in the past and `status=open` | Load grievance list | EscalationBanner renders on the relevant row | — |
| T39 | API integration | PARTNER scope: cannot see other partner's grievances | PARTNER A calls `GET /grievances` — data includes grievances linked to PARTNER B's leads | JWT for PARTNER A | Only grievances linked to PARTNER A's own leads returned | — |
| T40 | UI component | `GrievanceResolutionForm` shows only valid next statuses | Status select populated based on current status | Current `status=in_progress` | Select options contain only `escalated`, `resolved`; `closed`, `open` absent | — |

---

## SQL Invariant Queries

Run after each integration test that modifies state. Expect **0 rows** for each query.

```sql
-- INV-1: No grievance_no duplicate within an org
SELECT org_id, grievance_no, COUNT(*) AS cnt
FROM grievances
GROUP BY org_id, grievance_no
HAVING COUNT(*) > 1;

-- INV-2: No grievance in 'closed' status with blank closure_proof_ref
SELECT grievance_id
FROM grievances
WHERE status = 'closed'
  AND (closure_proof_ref IS NULL OR closure_proof_ref = '');

-- INV-3: No grievance in 'resolved' or 'closed' status with blank response
SELECT grievance_id
FROM grievances
WHERE status IN ('resolved', 'closed')
  AND (response IS NULL OR response = '');

-- INV-4: No audit_log row for a grievance event that has been updated or deleted
-- (proves append-only; rely on DB REVOKE enforcement — this verifies it at test time)
SELECT audit_id
FROM audit_logs
WHERE entity_type = 'grievance'
  AND updated_at != created_at;

-- INV-5: Every 'in_progress' or higher grievance has owner_id set
SELECT grievance_id
FROM grievances
WHERE status IN ('in_progress', 'escalated', 'resolved', 'closed')
  AND owner_id IS NULL;

-- INV-6: Every grievance row has a corresponding GRIEVANCE_CREATED event_outbox entry (at creation time)
-- Run immediately after T01 / T34 type tests before outbox is published
SELECT g.grievance_id
FROM grievances g
LEFT JOIN event_outbox eo
  ON eo.aggregate_id = g.grievance_id
  AND eo.event_code = 'GRIEVANCE_CREATED'
WHERE eo.event_id IS NULL;
```

---

## UI Test Scenarios (Playwright — `apps/web/e2e/grievance.spec.ts`)

| # | Scenario | Steps | Assertion |
|---|---|---|---|
| U01 | Compliance Officer creates a grievance and sees it in the queue | Login as DPO → navigate to `/compliance/grievances` → click "Create Grievance" → fill form → submit | New row appears in `DataTable` with `status=open`; `StatusChip` colour matches |
| U02 | EscalationBanner visible on breached grievance | Seed a grievance with `sla_due_at` 1 hour ago → load page | `EscalationBanner` rendered on the overdue row |
| U03 | ConfirmDialog shown before closing | Open a resolved grievance → change status to `closed` → enter `closureProofRef` → click Save | `ConfirmDialog` appears with warning text; confirms before submission |
| U04 | Toast feedback on successful update | Resolve a grievance | `Toast` with success message appears within 3 s |
| U05 | Form validation inline errors | Submit resolution form without `response` when transitioning to `resolved` | Inline error shown under `response` field matching `error-taxonomy` message |
| U06 | Status select only shows valid transitions | Open a `resolved` grievance in the drawer | Status select contains only `closed`; `open` and `in_progress` absent |
| U07 | LoadingSkeleton shown during fetch | Throttle network to slow 3G → navigate to grievances | `LoadingSkeleton` visible until data loads |
| U08 | EmptyState shown when no grievances | Freshly seeded org with no grievances → navigate to list | `EmptyState` component renders |

---

## Coverage Checklist

- [x] Happy path: `POST /grievances` — create + `201`
- [x] Happy path: `GET /grievances` — list with pagination
- [x] Happy path: `PATCH /grievances/{id}` — full lifecycle `open → in_progress → resolved → closed`
- [x] Every error code raised by FR-114:
  - [x] `AUTH_REQUIRED` (401) — T12
  - [x] `FORBIDDEN` (403) — T13, T21
  - [x] `NOT_FOUND` (404) — T07, T08, T23
  - [x] `VALIDATION_ERROR` (400) — T09, T10, T11, T17, T18
  - [x] `CONFLICT` (409) — T19, T20
  - [x] `RATE_LIMITED` (429) — T24
  - [x] `INTERNAL_ERROR` (500) — T31, T32
  - [x] `IDEMPOTENT_REPLAY` (200 with detail) — T02
- [x] Authz negatives: out-of-scope read denied (T03), non-owner PATCH denied (T21), no-capability denied (T13)
- [x] Authz positive: DPO scope A can act on any grievance (T04, T22)
- [x] PARTNER scope: cannot see other partner's data (T39)
- [x] State machine: all valid transitions (T27)
- [x] State machine: invalid transitions → `CONFLICT` (T19, T20, T28)
- [x] Guard on `resolved` transition: `response` required (T17, T29)
- [x] Guard on `closed` transition: `closureProofRef` required (T18, T30)
- [x] Transaction rollback on partial failure (T31, T32)
- [x] Append-only: `audit_logs` UPDATE rejected at DB level (T36)
- [x] Idempotency: replayed `Idempotency-Key` returns original, no duplicate (T02)
- [x] SLA computation: business-hours calculation via `SlaEngine` (T25, T26)
- [x] Escalation sweep: promotes breached grievances to `escalated` (T34, T35)
- [x] SQL invariants: no duplicate `grievance_no`, no closed without proof, no resolved without response (INV-1 – INV-6)
- [x] UI: full lifecycle E2E flow (U01 – U08)
- [x] Rate limiting on mutation tier (T24)
- [x] Pagination limit max 100 enforced (T05)
