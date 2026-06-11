# FR-020 Tests — Duplicate & Near-Duplicate Detection

**Tier: 3**
**Source LLD:** `docs/lld/FR-020.md`

---

## Test Cases

| # | Layer | Scenario | Input | Expected outcome |
|---|---|---|---|---|
| T01 | Unit | `scoreAndRank` — same PAN + same mobile → strong block | Two lead-identity rows with identical `pan_token` AND `mobile` | Returns `{ confidence: 'strong', action: 'blocked', matched_on: ['pan_token','mobile'] }` |
| T02 | Unit | `scoreAndRank` — same PAN, different mobile → strong warn | `pan_token` match; `mobile` differs | Returns `{ confidence: 'strong', action: 'warned' }` (identity-review) |
| T03 | Unit | `scoreAndRank` — same mobile, no PAN on either → medium warn | `mobile` match; both `pan_token` null | Returns `{ confidence: 'medium', action: 'warned' }` |
| T04 | Unit | `scoreAndRank` — same CKYC ID → strong block | `ckyc_id` match | Returns `{ confidence: 'strong', action: 'blocked' }` |
| T05 | Unit | `scoreAndRank` — same GSTIN + same product_code → medium warn | `gstin` + `product_code` match | Returns `{ confidence: 'medium', action: 'warned' }` |
| T06 | Unit | `scoreAndRank` — fuzzy name + same pin + same source → weak warn | Trigram-similar name, identical `pin_code` and `source` | Returns `{ confidence: 'weak', action: 'warned' }` |
| T07 | Unit | `scoreAndRank` — multiple matches → highest confidence selected | Strong PAN+mobile match + weak fuzzy match present | Action derived from strong match, not weak |
| T08 | Unit | `scoreAndRank` — matched lead has `master_lead_id` set (merged master) | Candidate has `master_lead_id = 'abc'` | Confidence points to master lead; `matched_lead_id` resolves to `master_lead_id` |
| T09 | Unit | No match on any key | Lead identity with unique mobile/PAN/name | Returns empty matches; `duplicate_status = 'none'` |
| T10 | Unit | Override action clears block | `requested_action = 'override'`, user is BM | Action resolves to `'overridden'`; no exception thrown |
| T11 | API | Happy path — no duplicate found | Fresh lead, all unique identity keys | 200; `data.duplicate_status = 'none'`; `data.matches = []`; `duplicate_matches` row NOT created |
| T12 | API | Happy path — medium warn, lead created with flagged status | Same mobile, different PAN (or no PAN) | 200; `data.action_taken = 'warned'`; `data.duplicate_status = 'flagged'`; `duplicate_matches` row inserted with `action='warned'`, `status='open'`; audit log entry exists |
| T13 | API | Strong block on explicit re-check | Lead with same PAN+mobile as existing lead; no override | 409 `CONFLICT`, `detail.reason = 'DUPLICATE_BLOCKED'`; `detail.matches[0].confidence = 'strong'`; `detail.override_allowed_by` contains `['BM','SM']`; `leads.duplicate_status` unchanged |
| T14 | API | BM override of strong block — happy path | Same PAN+mobile; `requested_action='override'`; `override_reason='Verified same customer, second product'`; actor is BM | 200; `data.action_taken = 'overridden'`; `duplicate_matches.action = 'overridden'`; audit log `action = 'lead_override'`; `audit.detail.override_reason` present |
| T15 | API | RM attempting override — forbidden | Same PAN+mobile; `requested_action='override'`; actor is RM | 403 `FORBIDDEN`; no `duplicate_matches` row written; no audit override entry |
| T16 | API | Override without `override_reason` — validation error | `requested_action='override'`; body missing `override_reason` | 400 `VALIDATION_ERROR`; `fields` contains `['override_reason']` |
| T17 | API | Out-of-scope RM cannot run check on another RM's lead | RM-A tries to check lead owned by RM-B | 403 `FORBIDDEN`; no DB writes |
| T18 | API | Unauthenticated request | No JWT cookie | 401 `AUTH_REQUIRED` |
| T19 | API | Lead not found | Non-existent UUID | 404 `NOT_FOUND` |
| T20 | API | Terminal lead (handed_off) — check rejected | Lead `stage = 'handed_off'` | 400 `VALIDATION_ERROR`; message references terminal stage |
| T21 | API | Optimistic-lock stale version | Concurrent update causes `leads.version` mismatch during status recompute | 409 `CONFLICT`; transaction fully rolled back; no partial writes in `duplicate_matches` or `audit_logs` |
| T22 | API | Transaction rollback on mid-write failure | Force DB error after `duplicate_matches` insert, before `leads` update | Full rollback; no `duplicate_matches` row persists; no `audit_logs` row persists; `leads.duplicate_status` unchanged |
| T23 | API | Idempotent re-check — same match already recorded | POST duplicate-check twice on same lead with same identity | Second call: `duplicate_matches` upserted (no new row due to `uq_dup_pair`); `duplicate_match_id` unchanged; `updated_at` refreshed; no duplicate audit row for identical action |
| T24 | API | Masking — mobile and PAN masked in response for RM | RM calls duplicate-check on own lead; match found | 200; `matches[0].mobile` is masked (`98xxxxxx10`); `matches[0].pan_masked` is masked (`ABCxxxx1F`); raw values not in response |
| T25 | API | BM scope — can check leads in own branch | BM for Branch A checks lead in Branch A | 200 |
| T26 | API | BM scope — cannot check leads in different branch | BM for Branch A checks lead in Branch B | 403 `FORBIDDEN` |
| T27 | API | Queue action by KYC role | `requested_action='queue'`; actor is KYC | 200; `data.action_taken = 'queued'`; `duplicate_matches.action = 'queued'`; `leads.duplicate_status = 'flagged'` |
| T28 | API | GSTIN + product match → medium warn | Two business leads, identical `gstin` and `product_code='SBL'` | 200; `matches[0].confidence = 'medium'`; `matched_on` contains `['gstin','product_code']` |
| T29 | API | Fuzzy name + pin + source match → weak warn | Similar names (trigram), same pin, same source | 200; `matches[0].confidence = 'weak'`; `data.duplicate_status = 'flagged'` |
| T30 | API | Internal invocation — strong block throws on lead create | `DuplicateService.match()` called from FR-010 intake; strong match found | `DuplicateBlockedException` thrown; no lead persisted; caller maps to 409 `CONFLICT` with `DUPLICATE_BLOCKED` |

---

## SQL Invariant Queries

Run after each test to assert DB consistency. Expect 0 rows unless stated.

```sql
-- INV-01: No duplicate_matches row where lead_id = matched_lead_id (constraint ck_dup_distinct)
SELECT * FROM duplicate_matches
WHERE lead_id = matched_lead_id;
-- Expect: 0 rows

-- INV-02: No orphaned duplicate_matches (lead must exist and not be deleted)
SELECT dm.* FROM duplicate_matches dm
LEFT JOIN leads l ON l.lead_id = dm.lead_id AND l.deleted_at IS NULL
WHERE l.lead_id IS NULL;
-- Expect: 0 rows

-- INV-03: No orphaned matched_lead_id references
SELECT dm.* FROM duplicate_matches dm
LEFT JOIN leads l ON l.lead_id = dm.matched_lead_id AND l.deleted_at IS NULL
WHERE l.lead_id IS NULL;
-- Expect: 0 rows

-- INV-04: leads.duplicate_status must be 'none' when no open duplicate_matches exist
SELECT l.lead_id, l.duplicate_status
FROM leads l
WHERE l.duplicate_status != 'none'
  AND NOT EXISTS (
    SELECT 1 FROM duplicate_matches dm
    WHERE dm.lead_id = l.lead_id
      AND dm.status = 'open'
  )
  AND l.deleted_at IS NULL;
-- Expect: 0 rows (after any LeadService.recomputeDuplicateStatus call)

-- INV-05: Override action must have action_by and action_reason populated
SELECT * FROM duplicate_matches
WHERE action = 'overridden'
  AND (action_by IS NULL OR action_reason IS NULL OR action_reason = '');
-- Expect: 0 rows

-- INV-06: audit_logs append-only — no UPDATE or DELETE possible (app role REVOKE check)
-- This is a schema-level invariant; verified by attempting UPDATE in test and expecting pg error.

-- INV-07: No duplicate audit entries for same lead_id + action='lead_override' + created_at within 1s
-- (Idempotent re-check must not double-write override audits)
SELECT lead_id, COUNT(*) as cnt
FROM audit_logs
WHERE action = 'lead_override'
  AND entity_type = 'lead'
  AND created_at > now() - interval '5 seconds'
GROUP BY lead_id
HAVING COUNT(*) > 1;
-- Expect: 0 rows (within single test run)

-- INV-08: event_outbox row created for every duplicate_status change
-- After T12 / T14 / T27 (status changes from 'none' to 'flagged'):
SELECT COUNT(*) FROM event_outbox
WHERE event_code = 'LEAD_STAGE_CHANGED'
  AND aggregate_type = 'lead'
  AND aggregate_id = '<test_lead_id>';
-- Expect: >= 1 row
```

---

## UI Test Scenarios

### Playwright E2E

#### UI-T01 — Duplicate warning modal appears on lead creation with medium match

1. Seed two leads with identical mobile, no PAN.
2. RM creates a third lead with the same mobile via the capture form.
3. Assert: `DuplicateWarningModal` is visible.
4. Assert: StatusChip shows "Medium" confidence.
5. Assert: match table shows 1 row; `mobile` column is masked (`98xxxxxx10`).
6. Assert: "Override" button is NOT visible for RM role.
7. Click "Proceed with warning" (warn action). Assert: modal closes; lead is saved with `duplicate_status=flagged`.

#### UI-T02 — BM can override strong block

1. Seed two leads with identical `pan_token` and `mobile`.
2. BM opens duplicate-check on one lead.
3. Assert: modal shows "Strong" confidence red badge; "Override" button is visible.
4. Click "Override"; ConfirmDialog appears.
5. Submit without `override_reason`. Assert: form error "Override reason is required."
6. Enter reason, submit. Assert: 200 response; `duplicate_status` chip shows "None" (override clears flag).
7. Assert: audit trail entry visible for `lead_override` action.

#### UI-T03 — Duplicate Review Queue shows queued matches for BM

1. Seed three leads with queued duplicate_matches.
2. BM navigates to Duplicate Review Queue page.
3. Assert: DataTable shows 3 rows; filter by confidence works.
4. Assert: out-of-branch leads are NOT visible (scope enforcement).
5. Click "Resolve" on one match. Assert: `duplicate_matches.status = 'resolved'`; row removed from queue.

#### UI-T04 — PAN and mobile values are masked for RM in match list

1. Seed a strong-confidence match.
2. RM views duplicate warning modal.
3. Assert: `pan_masked` column shows masked format (e.g. `ABCxxxx1F`); full PAN not exposed.
4. Assert: mobile shows `98xxxxxx10` format.

#### UI-T05 — WCAG 2.1 AA — modal is keyboard navigable

1. Open DuplicateWarningModal.
2. Tab through all interactive elements.
3. Assert: all buttons reachable; focus ring visible; Escape key closes modal.
4. Assert: confidence StatusChip has accessible `aria-label`.

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path — no match | T11 |
| Happy path — medium warn (flagged) | T12 |
| Happy path — BM override | T14 |
| Strong block → CONFLICT + DUPLICATE_BLOCKED | T13, T30 |
| Every BRD match-rule row scored correctly | T01–T08 |
| Multiple matches → highest confidence wins | T07 |
| Merged-master match resolution | T08 |
| AUTH_REQUIRED (401) | T18 |
| FORBIDDEN — out of scope | T17, T26 |
| FORBIDDEN — RM override attempt | T15 |
| NOT_FOUND (404) | T19 |
| VALIDATION_ERROR — override_reason missing | T16 |
| VALIDATION_ERROR — terminal lead | T20 |
| CONFLICT — optimistic lock | T21 |
| Transaction rollback on mid-write failure | T22 |
| Idempotent re-check (upsert, no duplicate row) | T23 |
| Masking — PAN/mobile in response | T24, UI-T04 |
| Scope: RM own leads only | T17 |
| Scope: BM branch-scoped | T25, T26 |
| Scope: KYC queue action | T27 |
| Audit log written for all actions | T12, T14 (INV-07) |
| Audit log append-only (no UPDATE/DELETE) | INV-06 |
| Outbox event emitted on status change | INV-08 |
| GSTIN + product match (medium) | T28 |
| Fuzzy name + pin + source match (weak) | T29 |
| Internal invocation from FR-010 | T30 |
| UI: warning modal + masked data | UI-T01, UI-T04 |
| UI: BM override flow | UI-T02 |
| UI: duplicate review queue | UI-T03 |
| UI: WCAG 2.1 AA keyboard nav | UI-T05 |
| SQL invariants (orphans, constraint, derived field) | INV-01 through INV-08 |
