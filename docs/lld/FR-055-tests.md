# FR-055 Test Specification: Lead Approval (pre-hand-off gate)

**Tier: 2**
**Source LLD:** `docs/lld/FR-055.md`

---

## Test Cases

Minimum required for Tier 2 Standard: 6 cases. This specification provides 14.

| # | Name | Layer | Tool | Scenario | Input | Expected outcome |
|---|---|---|---|---|---|---|
| T01 | Happy path — BM approves lead in pending_approval | API | Jest + supertest | BM with `approve_lead` (scope B) approves a lead in their branch that is in `pending_approval` stage | `POST /leads/{id}/approval` `{ decision: "approve" }` as BM | 200; `data.stage = "ready_for_handoff"`, `data.approvalStatus = "approved"`, `data.decision = "approve"`, `data.decidedBy = bm.userId`; DB: `leads.stage = "ready_for_handoff"`, `leads.approval_status = "approved"`, `leads.version` incremented; 1 row in `lead_approvals` with `decision='approved'`, `reason IS NULL`; 1 row in `stage_history` (`from_stage='pending_approval'`, `to_stage='ready_for_handoff'`); 1 row in `event_outbox` with `event_code='LEAD_APPROVED'`; 1 row in `audit_logs` with `action='stage_transition'` |
| T02 | Happy path — SM approves lead in team scope | API | Jest + supertest | SM with `approve_lead` (scope T) approves a lead belonging to their team | Same as T01, SM actor | 200; all four writes committed; `data.stage = "ready_for_handoff"` |
| T03 | Happy path — HEAD approves lead (scope A) | API | Jest + supertest | HEAD approves any lead across all branches | `{ decision: "approve" }` as HEAD | 200; stage → `ready_for_handoff`; all invariants satisfied |
| T04 | Happy path — BM rejects lead with valid reason | API | Jest + supertest | BM rejects a `pending_approval` lead; reason string 5–500 chars | `{ decision: "reject", reason: "Insufficient income documentation" }` as BM | 200; `data.stage = "rejected"`, `data.approvalStatus = "rejected"`; DB: `leads.stage = "rejected"`, `leads.approval_status = "rejected"`; 1 `lead_approvals` row with `decision='rejected'`, `reason = "Insufficient income documentation"`; 1 `stage_history` row (`from='pending_approval'`, `to='rejected'`); 1 `event_outbox` row `event_code='LEAD_REJECTED'`; 1 `audit_logs` row |
| T05 | Validation — reject without reason → 400 | API | Jest + supertest | Caller sends `decision: "reject"` but omits `reason` | `{ decision: "reject" }` | 400; `error.code = VALIDATION_ERROR`; `error.detail.fields` contains `reason`; NO writes to `lead_approvals`, `leads`, `stage_history`, `event_outbox` |
| T06 | Validation — reject with reason too short → 400 | API | Jest + supertest | Caller sends `decision: "reject"` and `reason` of 3 chars (below min 5) | `{ decision: "reject", reason: "bad" }` | 400; `error.code = VALIDATION_ERROR`; `error.detail.fields` contains `reason`; no DB writes |
| T07 | Validation — invalid decision enum value → 400 | API | Jest + supertest | `decision` field is not `"approve"` or `"reject"` | `{ decision: "maybe" }` | 400; `error.code = VALIDATION_ERROR`; `error.detail.fields` contains `decision` |
| T08 | Conflict — lead not in pending_approval → 409 | API | Jest + supertest | Lead exists but is in `assigned` stage (not `pending_approval`) | `{ decision: "approve" }` as BM against an `assigned` lead | 409; `error.code = CONFLICT`; no writes to `lead_approvals` or `leads`; all writes rolled back |
| T09 | Conflict — lead already approved (ready_for_handoff) → 409 | API | Jest + supertest | Lead was already approved and is now in `ready_for_handoff` | Second `POST /leads/{id}/approval` on the same lead | 409; `error.code = CONFLICT` |
| T10 | Auth — missing JWT → 401 | API | Jest + supertest | Request with no Authorization header | No JWT | 401; `error.code = AUTH_REQUIRED` |
| T11 | Authz — RM role lacks approve_lead capability → 403 | API | Jest + supertest | RM user calls the approval endpoint | Valid RM JWT | 403; `error.code = FORBIDDEN`; no DB writes |
| T12 | Authz — BM cannot approve a lead from another branch → 403 | API | Jest + supertest | BM of branch-A attempts to approve a lead with `branch_id = branch-B` | Valid BM-A JWT; lead in branch-B | 403; `error.code = FORBIDDEN`; no DB writes |
| T13 | Not found — lead does not exist → 404 | API | Jest + supertest | UUID in path does not match any lead | Non-existent UUID as BM | 404; `error.code = NOT_FOUND` |
| T14 | Transaction rollback — forced DB failure after lead_approvals INSERT | Unit | Jest (mocked DB) | Simulate `leads` UPDATE throwing after `lead_approvals` INSERT succeeds | Force DB error on `UPDATE leads` | No commit; `lead_approvals` unchanged (0 rows inserted); `leads.stage` unchanged; 0 rows in `stage_history`; 0 rows in `event_outbox` |

---

## Unit Test Cases (Jest — service and guard logic)

| # | Name | Unit under test | Scenario | Expected |
|---|---|---|---|---|
| U01 | Service — approve decision maps to ready_for_handoff | `ApprovalService.decide()` | Mock lead in `pending_approval`; `dto.decision = 'approve'` | `LeadService.recordApprovalDecision` called with `toStage = READY_FOR_HANDOFF`, `approvalStatus = 'approved'` |
| U02 | Service — reject decision maps to rejected | `ApprovalService.decide()` | Mock lead in `pending_approval`; `dto.decision = 'reject'`; reason provided | `LeadService.recordApprovalDecision` called with `toStage = REJECTED`, `approvalStatus = 'rejected'` |
| U03 | Service — CONFLICT when stage !== pending_approval | `ApprovalService.decide()` | Mock lead stage = `assigned` | Throws `ConflictException` mapping to CONFLICT 409 |
| U04 | DTO — superRefine rejects missing reason on reject | `ApprovalDto` Zod schema | Parse `{ decision: 'reject' }` | Zod parse fails with path `reason`, code `custom` |
| U05 | DTO — approve without reason is valid | `ApprovalDto` Zod schema | Parse `{ decision: 'approve' }` | Zod parse succeeds; `reason` is undefined |
| U06 | StageGuard — PENDING_APPROVAL in ACTIVE_STAGES | `StageGuardService` | Assert `ACTIVE_STAGES.has(LeadStage.PENDING_APPROVAL)` | Returns true |
| U07 | StageGuard — eligibility_requested → pending_approval is valid | `StageGuardService.evaluate()` | `fromStage = ELIGIBILITY_REQUESTED`, `toStage = PENDING_APPROVAL`; guards met | Returns `{ failed: [] }` |
| U08 | StageGuard — eligibility_requested → ready_for_handoff is no longer valid | `StageGuardService.evaluate()` | `fromStage = ELIGIBILITY_REQUESTED`, `toStage = READY_FOR_HANDOFF` | Returns `{ failed: ['<guard>'] }` (transition removed) |

---

## SQL Invariant Queries

Run after any `POST /leads/{id}/approval` call. All queries must return 0 rows.

```sql
-- INV-01: Every lead_approvals row must reference an existing lead.
SELECT approval_id
FROM lead_approvals la
WHERE NOT EXISTS (
  SELECT 1 FROM leads l WHERE l.lead_id = la.lead_id
);
-- Expect: 0 rows

-- INV-02: For every rejected lead_approvals row, reason must be non-null and non-empty.
SELECT approval_id
FROM lead_approvals
WHERE decision = 'rejected'
  AND (reason IS NULL OR LENGTH(TRIM(reason)) = 0);
-- Expect: 0 rows (enforced by CHECK constraint + Zod; verify belt-and-suspenders)

-- INV-03: After any approval decision, leads.approval_status must agree with the
-- most recent lead_approvals.decision for that lead.
SELECT l.lead_id, l.approval_status, la.decision
FROM leads l
JOIN LATERAL (
  SELECT decision
  FROM lead_approvals
  WHERE lead_id = l.lead_id
  ORDER BY decided_at DESC
  LIMIT 1
) la ON true
WHERE
  (la.decision = 'approved'  AND l.approval_status <> 'approved')
  OR (la.decision = 'rejected' AND l.approval_status <> 'rejected')
  AND l.deleted_at IS NULL;
-- Expect: 0 rows

-- INV-04: Every approval decision must have a matching stage_history row
-- (from_stage = 'pending_approval') written in the same transaction (within 1s).
SELECT la.approval_id
FROM lead_approvals la
WHERE NOT EXISTS (
  SELECT 1 FROM stage_history sh
  WHERE sh.lead_id = la.lead_id
    AND sh.from_stage = 'pending_approval'
    AND sh.occurred_at BETWEEN la.decided_at - INTERVAL '1 second'
                           AND la.decided_at + INTERVAL '1 second'
)
ORDER BY la.decided_at DESC
LIMIT 10;
-- Expect: 0 rows (all approval decisions have a matching stage_history row)

-- INV-05: Every approval decision must have a matching event_outbox row.
SELECT la.approval_id
FROM lead_approvals la
WHERE NOT EXISTS (
  SELECT 1 FROM event_outbox eo
  WHERE eo.aggregate_id = la.lead_id
    AND eo.event_code IN ('LEAD_APPROVED', 'LEAD_REJECTED')
    AND eo.created_at BETWEEN la.decided_at - INTERVAL '1 second'
                          AND la.decided_at + INTERVAL '1 second'
)
ORDER BY la.decided_at DESC
LIMIT 10;
-- Expect: 0 rows (every lead_approvals row has a matching outbox event)

-- INV-06: Every approval decision must have a matching audit_log row.
SELECT la.approval_id
FROM lead_approvals la
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs al
  WHERE al.lead_id = la.lead_id
    AND al.action = 'stage_transition'
    AND al.created_at BETWEEN la.decided_at - INTERVAL '1 second'
                          AND la.decided_at + INTERVAL '1 second'
)
ORDER BY la.decided_at DESC
LIMIT 10;
-- Expect: 0 rows

-- INV-07: A lead with stage = 'ready_for_handoff' or 'rejected' due to approval
-- must have approval_status = 'approved' or 'rejected' respectively
-- (not 'not_required' or 'pending') if a lead_approvals row exists.
SELECT l.lead_id, l.stage, l.approval_status
FROM leads l
WHERE EXISTS (
  SELECT 1 FROM lead_approvals la WHERE la.lead_id = l.lead_id
)
  AND l.approval_status IN ('not_required', 'pending')
  AND l.deleted_at IS NULL;
-- Expect: 0 rows
```

---

## UI Test Scenarios (Playwright E2E)

| # | Name | File | Steps | Assertions |
|---|---|---|---|---|
| E01 | BM approves a lead from Approvals page | `apps/web/e2e/approvals.spec.ts` | 1. Login as BM. 2. Navigate to `/approvals`. 3. Locate a lead row in `pending_approval`. 4. Click **Approve**. 5. Confirm dialog / wait for API. | Lead row disappears from the approvals table. Toast shows "Lead approved". Network request `POST /leads/{id}/approval` returns 200 with `stage = "ready_for_handoff"`. |
| E02 | BM rejects a lead with reason from Approvals page | `apps/web/e2e/approvals.spec.ts` | 1. Login as BM. 2. Navigate to `/approvals`. 3. Click **Reject** on a lead row. 4. Enter reason "Customer does not meet income norms". 5. Confirm. | Lead row disappears. Toast shows "Lead rejected". Network request returns 200 with `stage = "rejected"`. |
| E03 | Reject button disabled / form invalid without reason | `apps/web/e2e/approvals.spec.ts` | 1. Login as BM. 2. Click **Reject** on a lead. 3. Leave reason field empty. 4. Attempt to submit. | Submit button is disabled or inline error "Reason is required" is visible. Network request is NOT sent. |
| E04 | RM sees no Approvals nav item | `apps/web/e2e/approvals.spec.ts` | 1. Login as RM. 2. Observe nav sidebar. | `Approvals` nav item is absent. Direct navigation to `/approvals` returns a 403 or redirects to home. |
| E05 | Lead360 shows Approve/Reject panel for BM on pending_approval lead | `apps/web/e2e/approvals.spec.ts` | 1. Login as BM. 2. Open a lead in `pending_approval` via Lead360. | Approve / Reject panel is visible with `data-testid="approval-panel"`. |
| E06 | Lead360 Approve/Reject panel hidden for RM | `apps/web/e2e/approvals.spec.ts` | 1. Login as RM. 2. Open a lead in `pending_approval` via Lead360. | Approval panel (`data-testid="approval-panel"`) is absent from the DOM. |
| E07 | Empty state on Approvals page with no pending leads | `apps/web/e2e/approvals.spec.ts` | 1. Login as SM with no pending_approval leads in scope. 2. Navigate to `/approvals`. | EmptyState component renders with appropriate message ("No leads awaiting approval"). |

---

## Coverage Checklist

| Item | Covered | Test ID(s) |
|---|---|---|
| Happy path — BM approve | Yes | T01, E01 |
| Happy path — SM approve | Yes | T02 |
| Happy path — HEAD approve | Yes | T03 |
| Happy path — reject with valid reason | Yes | T04, E02 |
| Every error code: `AUTH_REQUIRED` (401) | Yes | T10 |
| Every error code: `FORBIDDEN` (403) — no capability | Yes | T11 |
| Every error code: `FORBIDDEN` (403) — out of scope | Yes | T12 |
| Every error code: `NOT_FOUND` (404) | Yes | T13 |
| Every error code: `VALIDATION_ERROR` (400) — reason absent on reject | Yes | T05, U04, E03 |
| Every error code: `VALIDATION_ERROR` (400) — reason too short | Yes | T06 |
| Every error code: `VALIDATION_ERROR` (400) — bad enum | Yes | T07 |
| Every error code: `CONFLICT` (409) — wrong stage | Yes | T08, U03 |
| Every error code: `CONFLICT` (409) — already decided | Yes | T09 |
| Data integrity — lead_approvals row written | Yes | T01, T04, INV-01 |
| Data integrity — approval_status column set | Yes | T01, T04, INV-03 |
| Data integrity — stage moved correctly | Yes | T01, T04, INV-03 |
| Data integrity — stage_history row written | Yes | T01, T04, INV-04 |
| Data integrity — event_outbox row written (LEAD_APPROVED) | Yes | T01, INV-05 |
| Data integrity — event_outbox row written (LEAD_REJECTED) | Yes | T04, INV-05 |
| Data integrity — audit_log row written | Yes | T01, T04, INV-06 |
| Data integrity — all-or-nothing on DB failure | Yes | T14 |
| CHECK constraint — rejected row always has reason | Yes | INV-02 |
| StageGuard — pending_approval in ACTIVE_STAGES | Yes | U06 |
| StageGuard — eligibility→pending_approval valid | Yes | U07 |
| StageGuard — eligibility→ready_for_handoff removed | Yes | U08 |
| UI — nav item absent for RM | Yes | E04 |
| UI — Lead360 panel visible for BM | Yes | E05 |
| UI — Lead360 panel hidden for RM | Yes | E06 |
| UI — empty state on zero pending leads | Yes | E07 |
| `INTERNAL_ERROR` (500) | Covered by global exception filter tests (cross-FR) |
| Rate limiting | Covered by global `ThrottlerGuard` tests (cross-FR) |
