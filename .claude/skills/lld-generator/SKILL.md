---
name: lld-generator
description: "Generate tiered Low-Level Design (LLD) documents and Test Specifications for each functional requirement. Use this skill whenever the user wants to create implementation-grade specifications before code generation, says 'generate the LLDs', 'write the low-level design', 'create implementation specs for each FR', 'produce the LLD for FR-NNN', 'generate the test specs', 'create the technical specs', or 'write the per-FR implementation guides'. Also trigger automatically after Gate C is signed off — this is Stage 6 of the AI Dev Pipeline. The LLD is the final specification a coding agent receives; it must be complete enough that the agent can implement the FR by following instructions, not by making decisions."
allowed-tools: Read Write Bash Glob
---

# LLD Generator

Produce `docs/lld/FR-NNN.md` (LLD) and `docs/lld/FR-NNN-tests.md` (Test Specification) for each functional requirement. These two files together form the complete specification package a coding agent needs to implement one FR.

## Core Principle

An LLD is complete when the coding agent can implement the FR by **following instructions**, not by **making decisions**. Every decision point left to the agent is a point of potential divergence. This skill's job is to reduce the agent's decision count to zero for each FR.

## Inputs Required (all Stages 1–5 must be complete)

- `docs/brd.md` — FR descriptions, acceptance criteria, business rules
- `docs/data-model/schema.sql` — exact table and column names
- `docs/architecture.md` — folder structure, middleware names, API conventions
- `docs/guidelines/` — all four guideline files
- `docs/contracts/api-contract.yaml` — endpoint shapes
- `docs/contracts/auth-matrix.json` — permissions for each resource
- `docs/contracts/error-taxonomy.md` — permitted error types
- `docs/contracts/state-machines.md` — transition rules (if FR touches status)
- `docs/contracts/dependency-register.md` — approved libraries
- `docs/contracts/shared-utilities.md` — shared code to reference

## Complexity Tiers

The LLD generator first classifies each FR before writing. Classification is across three dimensions:

| Dimension | Tier 1 | Tier 2 | Tier 3 |
|-----------|--------|--------|--------|
| Data | 1–2 tables, no joins | 3–5 tables, 1–2 joins | 5+ tables, complex joins, transactions |
| Logic | Simple CRUD, no state | Validation rules, one state transition, one external call | Multi-step workflow, state machine, multiple external calls |
| UI | No UI, or single read-only view | Single form or paginated list | Multi-step wizard, complex interactive view |

**Resulting tier determines depth:**
- **Tier 1 (~0.5 pages):** Endpoint signature, specific SQL, happy path only
- **Tier 2 (~2 pages):** Full endpoint spec, all error paths, component tree, auth check
- **Tier 3 (5+ pages):** Everything in Tier 2 plus state machine diagram, transaction boundaries, external service sequence, performance notes, full test scenarios table

The tier is an initial classification. Mark the tier at the top of the LLD. If mid-writing you discover more complexity than anticipated, upgrade the tier and note why.

## Process

### Step 1: Read All Inputs

```bash
cat docs/brd.md
cat docs/data-model/schema.sql
cat docs/architecture.md | head -80
cat docs/contracts/api-contract.yaml
cat docs/contracts/auth-matrix.json
cat docs/contracts/error-taxonomy.md
cat docs/contracts/state-machines.md 2>/dev/null
cat docs/contracts/shared-utilities.md
```

### Step 2: For Each FR (or the specified FR)

If `all` is specified, process every FR in `docs/brd.md` in order.
If `FR-NNN` is specified, process only that FR.

#### 2a. Classify the FR

Evaluate the three dimensions. Record:
```
FR-NNN: [title]
Tier: [1|2|3]
Reason: [data: X tables, logic: Y, UI: Z]
```

#### 2b. Write the LLD

Write to `docs/lld/FR-NNN.md`:

```markdown
# FR-NNN: [Title]
*Tier: [1|2|3] | LLD Version: 1 | Source BRD: docs/brd.md*

## Metadata
```yaml
source_fr: [FR-NNN]
depends_on:
  - data_model.[table1]
  - data_model.[table2]
  - contracts.api-contract.[endpoint]
  - contracts.auth-matrix.[role].[resource]
  - contracts.state-machines.[entity]  # only if FR touches status
last_updated: [date]
version: 1
```

## Summary
[2-3 sentences: what this FR does, who uses it, what data it reads/writes]

## Tier [N] Specification

### Endpoint(s)
[For Tier 1: just the signature]
[For Tier 2+: full request/response shapes]

```
[HTTP METHOD] [path]
Authorization: Bearer <token>   [or "public — no auth required"]

Request body:
{
  "field1": "string",     // [description, validation rule]
  "field2": 123           // [description, validation rule]
}

Response 200:
{
  "id": "uuid",
  "field1": "string",
  "created_at": "ISO8601"
}

Response 422 (validation error):
{ "error": { "code": "VALIDATION_ERROR", "details": [{"field": "field1", "message": "..."}] } }

Response 403:
{ "error": { "code": "UNAUTHORISED", "message": "You don't have permission to perform this action." } }
```

### Auth Check
Role required: [from auth-matrix.json]
Resource operation: [e.g. orders.create]
Middleware: `requireAuth()` [exact name from architecture.md]
Ownership check: [e.g. "WHERE user_id = $current_user_id — user may only access their own orders"]

### Data Operations
[Exact SQL or ORM operations. Use the table and column names from schema.sql exactly.]

```sql
-- [Step description]
INSERT INTO [table] (col1, col2, col3)
VALUES ($1, $2, now())
RETURNING id, col1, created_at;

-- [Step description]
SELECT t.col1, t.col2, r.col3
FROM [table] t
JOIN [related] r ON r.id = t.related_id
WHERE t.user_id = $1
  AND t.deleted_at IS NULL
ORDER BY t.created_at DESC
LIMIT $2 OFFSET $3;
```

### Validation Logic
[Field-by-field — use Zod schema names or Pydantic model names]

| Field | Rule | Error Message |
|-------|------|---------------|
| `field1` | Required, max 255 chars | "Field1 is required and must be under 255 characters" |
| `field2` | Positive integer | "Field2 must be a positive number" |
| `email` | Valid email format | "Please enter a valid email address" |

### Error Cases
| Scenario | Error Code | HTTP Status | User Message |
|----------|-----------|------------|--------------|
| User not authenticated | `AUTH_REQUIRED` | 401 | [standard template from error taxonomy] |
| User lacks permission | `UNAUTHORISED` | 403 | [standard template] |
| Resource not found | `NOT_FOUND` | 404 | "The requested item could not be found." |
| Validation fails | `VALIDATION_ERROR` | 422 | Field-level details |
| Duplicate resource | `CONFLICT` | 409 | "[Specific business message]" |

### Backend Flow (Tier 2+)
Step-by-step from request to response:

1. `requireAuth()` middleware validates session → attaches `req.user` to request
2. Parse and validate request body with `[SchemaName]` — throw `VALIDATION_ERROR` if invalid
3. Check auth matrix: `user.role` must be `[role]` OR resource.user_id must equal `req.user.id`
4. Execute primary DB operation: [describe]
5. Execute side effects if primary succeeds: [notifications, audit log, cache invalidation]
6. Return [200/201] with [response shape]

### State Machine (Tier 3, only if FR triggers a transition)
This FR triggers the following transition on `[entity]`:
`[from_state]` → `[to_state]` via `[trigger action]`

Refer to `docs/contracts/state-machines.md#[entity]` for the full transition table.
Side effects from this transition: [list from state machine definition]
Invalid transition check: if entity is not in `[from_state]`, return `CONFLICT`.

### Transaction Boundaries (Tier 3, only if FR has multi-step writes)
The following operations must succeed atomically or all roll back:
1. [operation 1]
2. [operation 2]
3. [operation 3]

If any step fails, roll back and return `INTERNAL_ERROR`.

### External Service Calls (Tier 3)
[Service from integration-map.md]
- Call: `[abstractionLayer.functionName(params)]`
- On success: [what happens]
- On timeout: [what happens — from integration-map.md handling strategy]
- On failure: [what happens]
Never expose raw external service errors to the client.

### UI Component Tree (Tier 2+)
[Only for FRs with a UI component]

```
[PageName]
  ├── PageHeader (src/components/PageHeader.tsx)
  ├── [FeatureForm] (src/components/[feature]/[FeatureForm].tsx)
  │   ├── FormField: [field1] — text input, required
  │   ├── FormField: [field2] — select, options from [source]
  │   └── SubmitButton (disabled while isSubmitting)
  └── [DataTable] (src/components/DataTable.tsx)
      └── Columns: [col1, col2, col3, actions]
```

Loading state: `<LoadingSkeleton />` from `src/components/LoadingSkeleton.tsx`
Empty state: `<EmptyState />` with CTA: "[Action Label]"
Error state: Toast notification for mutations, inline error for queries

### File Locations
[Exact paths where code should be written]
| Type | Path |
|------|------|
| Route handler | `src/app/api/[resource]/route.ts` |
| Service function | `src/lib/[resource]-service.ts` |
| Schema | `src/schemas/[resource].ts` |
| Component | `src/components/[feature]/[Component].tsx` |
| Test | `src/lib/[resource]-service.test.ts` |

### Shared Utilities to Use
[Reference shared-utilities.md — do not recreate these]
- `formatCurrency()` from `src/utils/format.ts`
- `paginateQuery()` from `src/utils/pagination.ts`
- `requireAuth` middleware from `src/lib/auth.ts`
```

#### 2c. Write the Test Specification

Write to `docs/lld/FR-NNN-tests.md`:

```markdown
# Test Specification: FR-NNN — [Title]
*Tier: [1|2|3] | Source LLD: docs/lld/FR-NNN.md*

## Test Cases

Every scenario in this file must have a passing test before the FR can be merged.

| TC | Scenario | Type | Input | Expected Outcome |
|----|----------|------|-------|-----------------|
| TC-001 | Happy path — authenticated user creates [resource] | Integration | Valid payload, valid auth token | 201, resource created, returned in response |
| TC-002 | Unauthenticated request | Integration | No auth header | 401 `AUTH_REQUIRED` |
| TC-003 | Insufficient permissions | Integration | Auth token for `viewer` role | 403 `UNAUTHORISED` |
| TC-004 | Validation error — missing required field | Integration | Payload missing `field1` | 422 `VALIDATION_ERROR` with field details |
| TC-005 | Validation error — invalid format | Integration | `email: "not-an-email"` | 422 with field: email |
| TC-006 | Conflict — duplicate resource | Integration | Same identifier as existing record | 409 `CONFLICT` |
| TC-007 | [State transition: wrong state] | Integration | Entity in `approved` state | 409 `CONFLICT` |
| TC-008 | [External service timeout] | Integration | Mock [service] to timeout | 502 `EXTERNAL_SERVICE_ERROR`, no partial state |
| TC-009 | [Business logic unit test] | Unit | [specific input] | [specific output] |
| TC-010 | [Concurrent write safety] | Integration | Two simultaneous POSTs with same key | Exactly one succeeds (201), one gets 409 |

[Add more rows for Tier 3 FRs — minimum 2 per tier, 5–10 for Tier 2, 10+ for Tier 3]

## SQL Invariant Queries (Data Integrity)
After any write operation, these queries must return 0 rows:

```sql
-- No resource in an undefined state
SELECT COUNT(*) FROM [table] WHERE status NOT IN ([all valid states from enum]);
-- Expected: 0

-- No orphaned resources (FK integrity)
SELECT COUNT(*) FROM [table] t
WHERE NOT EXISTS (SELECT 1 FROM [parent] p WHERE p.id = t.parent_id);
-- Expected: 0

-- Audit trail completeness
SELECT COUNT(*) FROM [table] t
WHERE t.updated_at < t.created_at;
-- Expected: 0
```

## UI Test Scenarios (if FR has UI)
| TC | Page/Component | Action | Expected |
|----|----------------|--------|----------|
| TC-UI-001 | [Page] | Load page authenticated | Renders without errors, data loads |
| TC-UI-002 | [Form] | Submit with empty required field | Field error shown, form not submitted |
| TC-UI-003 | [Form] | Submit valid form | Success toast, data updates |
| TC-UI-004 | [List] | No data state | EmptyState component renders with CTA |
| TC-UI-005 | [Page] | Keyboard navigation | Tab reaches all interactive elements in order |

## Coverage Checklist
- [ ] Happy path tested
- [ ] All named error codes tested
- [ ] Auth check tested (both valid and invalid role)
- [ ] Validation: required fields tested
- [ ] Validation: format errors tested
- [ ] Boundary conditions tested (if numeric limits apply)
- [ ] State transitions: valid transition tested
- [ ] State transitions: invalid transition tested (if applicable)
- [ ] External service failure tested (if applicable)
- [ ] Concurrent write tested (if FR has uniqueness constraints)
- [ ] SQL invariant queries defined
```

### Step 3: Update Manifest

After generating each FR's LLD pair, update `manifest.json`:

```json
{
  "features": {
    "FR-NNN": {
      "lld_tier": 2,
      "lld_path": "docs/lld/FR-NNN.md",
      "test_spec_path": "docs/lld/FR-NNN-tests.md",
      "lld_generated_at": "<iso8601>",
      "deps": ["data_model.orders", "contracts.api-contract./api/v1/orders"]
    }
  }
}
```

### Step 4: Verify

```bash
# Count LLD files generated
ls docs/lld/*.md | grep -v "\-tests" | wc -l

# Count Test Spec files generated
ls docs/lld/*-tests.md | wc -l

# Check both files exist for each FR
for lld in docs/lld/FR-*.md; do
  base="${lld%.md}"
  [ -f "${base}-tests.md" ] && echo "✓ $lld" || echo "✗ Missing test spec for $lld"
done

# Check all metadata blocks present
rg "source_fr:|depends_on:" docs/lld/ --glob '*.md' | wc -l
```

### Step 5: Report

Tell the user:
- How many LLD/Test Spec pairs were generated
- Tier breakdown (X Tier 1, Y Tier 2, Z Tier 3)
- Any tier upgrades that happened during generation and why
- Any ambiguities found that require human input (write these to `docs/lld/AMBIGUITIES.md`)

## Output

For each FR:
- `docs/lld/FR-NNN.md` — Low-Level Design
- `docs/lld/FR-NNN-tests.md` — Test Specification

Updated `manifest.json` with LLD metadata per FR.

Optional: `docs/lld/AMBIGUITIES.md` if any specification gaps were found.

## Quality Checklist

Before marking any LLD complete:

- [ ] Tier classification documented with reasoning
- [ ] Metadata block present with `source_fr` and `depends_on`
- [ ] Endpoint specification uses exact column names from schema.sql
- [ ] Auth check specifies exact middleware name from architecture.md
- [ ] All error cases reference codes from error-taxonomy.md only
- [ ] For Tier 2+: backend flow is step-by-step with no ambiguous steps
- [ ] For Tier 3: transaction boundaries are explicit
- [ ] For Tier 3: state machine transitions reference state-machines.md
- [ ] Shared utilities referenced by import path (not recreated)
- [ ] File locations specify exact paths
- [ ] Test Specification has minimum coverage: 2 tests for Tier 1, 5+ for Tier 2, 10+ for Tier 3
- [ ] SQL invariant queries defined for any data writes
- [ ] No placeholders or "TBD" in any field
