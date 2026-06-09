---
name: cross-fr-review
description: "Run a cross-FR integration review after all functional requirements have passed individual FR review. Detects conflicts between FRs that individual review cannot find: shared table conflicts, incompatible transaction boundaries, state machine race conditions, conflicting external service assumptions, and API contract drift. Use this skill when the user says 'run the integration review', 'check for cross-FR conflicts', 'verify the FRs work together', 'run stage 9', or when all FRs show status approved in manifest.json. This skill must run after ALL FRs pass Stage 8 — it requires the complete generated codebase to be meaningful."
allowed-tools: Read Grep Glob Bash Write
---

# Cross-FR Integration Review

Detect conflicts between FRs that individual FR review cannot catch. Two FRs that each pass Stage 8 can still produce runtime failures when they interact. This review requires the complete codebase — run it only after all FRs are merged to the integration branch.

## Why Individual Review Is Not Enough

Individual FR review checks each FR against its own LLD. It cannot check:
- Whether FR-012 and FR-018 both write to `orders` with incompatible transaction boundaries
- Whether FR-007 and FR-023 trigger state transitions that create impossible states
- Whether FR-005 and FR-014 both call the same external service in ways that combine to exceed rate limits
- Whether FR-009 and FR-031 each invented their own response shape despite the API contract

This review checks all of these.

## Trigger Condition

Run when `manifest.json` shows all FRs in `merged` status:

```bash
python3 -c "
import json
m = json.load(open('manifest.json'))
statuses = [f['status'] for f in m['features'].values()]
all_merged = all(s in ['merged', 'escalated'] for s in statuses)
print('READY' if all_merged else 'NOT READY — pending FRs:', [f for f,v in m['features'].items() if v['status'] not in ['merged','escalated']])
"
```

## Process

### Phase 0: Inventory

Build a map of what each FR touches:

```bash
# Extract all tables touched per FR from LLDs
for lld in docs/lld/FR-*.md; do
  fr=$(basename "$lld" .md)
  tables=$(rg "INSERT INTO|UPDATE|DELETE FROM|FROM " "$lld" | grep -oP '\b[a-z_]+\b' | sort -u | tr '\n' ',')
  echo "$fr: $tables"
done

# Extract state transitions per FR
rg "state_machine|status.*→|transition" docs/lld/FR-*.md -l

# Extract external service calls per FR
rg "integration-map|External Service" docs/lld/FR-*.md -l
```

Produce an inventory matrix:

```
Cross-FR Inventory
==================
Table → FRs that write to it:
  orders:       FR-002 (create), FR-007 (submit), FR-015 (cancel), FR-018 (fulfil)
  order_items:  FR-002 (create), FR-018 (update)
  inventory:    FR-018 (decrement), FR-021 (restock)

State Machine → FRs that trigger transitions:
  order_status: FR-007 (draft→submitted), FR-015 (submitted→cancelled), FR-018 (approved→fulfilled)

External Service → FRs that call it:
  Stripe:       FR-010 (charge), FR-016 (refund)
  Resend:       FR-007 (submission confirmation), FR-018 (fulfilment notification)
```

### Phase 1: Shared Table Conflicts

For every table written by more than one FR, check the generated code:

#### 1a. Transaction Boundary Compatibility

Find the database operations in each FR's generated code:

```bash
# Find transaction blocks
rg "BEGIN|START TRANSACTION|db\.transaction|pool\.query.*BEGIN" src/ --glob '*.ts' --glob '*.py' -l

# Find concurrent write patterns
rg "INSERT INTO orders|UPDATE orders" src/ --glob '*.ts' --glob '*.py' -n | head -30
```

Check for:
- Two FRs wrapping the same rows in transactions simultaneously (potential deadlock if lock order differs)
- FR-A locks `orders` then `order_items`; FR-B locks `order_items` then `orders` — deadlock risk
- Missing `SELECT FOR UPDATE` where concurrent reads before writes exist

```bash
# Check lock order consistency for tables locked by multiple FRs
rg "SELECT.*FOR UPDATE|FOR SHARE" src/ --glob '*.ts' --glob '*.py' -n
```

**Finding format:**
```
CONFLICT: FR-007 and FR-018 both update orders.status without SELECT FOR UPDATE
  FR-007: src/app/api/orders/[id]/submit/route.ts:45
  FR-018: src/app/api/orders/[id]/fulfil/route.ts:62
  Risk: Race condition — concurrent submit+fulfil can both succeed, leaving order in undefined state
  Fix: Both operations must use SELECT ... FOR UPDATE or serializable transaction isolation
```

#### 1b. Soft-Delete Consistency

```bash
# Check that all FRs touching the same table handle soft-deletes consistently
rg "deleted_at" src/ --glob '*.ts' --glob '*.py' -n | grep -v "test"

# Find FRs that query without deleted_at IS NULL filter
for table in $(rg "CREATE TABLE" docs/data-model/schema.sql | grep -oP '(?<=TABLE )\w+'); do
  echo "=== $table ==="
  rg "FROM $table" src/ --glob '*.ts' --glob '*.py' -n | grep -v "deleted_at"
done
```

Any query on a soft-deletable table without `WHERE deleted_at IS NULL` is a conflict.

#### 1c. Column Update Conflicts

```bash
# Check that no two FRs update the same column with conflicting logic
rg "SET .* =" src/ --glob '*.ts' --glob '*.py' -n | sort
```

If FR-A sets `orders.total = sum_of_items` and FR-B sets `orders.total = fixed_price`, they conflict.

### Phase 2: State Machine Compatibility

For every entity with a status enum, check that all FRs touching it are compatible:

```bash
# Load state machine definitions
cat docs/contracts/state-machines.md

# Find all status updates in generated code
rg "status.*=.*['\"]|\.status\s*=\s*['\"]" src/ --glob '*.ts' --glob '*.py' -n
```

#### 2a. Impossible State Combinations

Given the valid transitions from `docs/contracts/state-machines.md`:

```bash
# Check that every status assignment is to a valid target state
# For each FR, extract the (from_state, to_state) pairs and verify against state machine
```

Detect: two FRs that can race and both attempt transitions from the same state — resulting in an entity reaching an invalid state.

**Example finding:**
```
CONFLICT: FR-007 and FR-015 can both execute when order is in 'submitted' state
  FR-007 transitions: submitted → approved
  FR-015 transitions: submitted → cancelled
  These are both valid individually, but if executed simultaneously:
  - No SELECT FOR UPDATE in either FR
  - Second FR will silently succeed on a stale read
  Fix: Both FRs must use SELECT ... FOR UPDATE on the orders row before checking status
```

#### 2b. Side Effect Conflicts

```bash
# Find notification triggers per FR
rg "sendEmail|sendNotification|createNotification" src/ --glob '*.ts' --glob '*.py' -n
```

Check: do two FRs both send the same notification for the same event (duplicate email)?

### Phase 3: External Service Conflicts

For every external service called by more than one FR:

#### 3a. Rate Limit Exposure

```bash
# Find all calls to each external service
for service in Stripe Resend OpenAI Supabase; do
  echo "=== $service ==="
  rg "$service\|resend\|stripe\|openai" src/ --glob '*.ts' --glob '*.py' -n | grep -v test | grep -v mock
done
```

Calculate worst-case call rate: if FR-010 and FR-016 both call Stripe under the same conditions, do the combined calls exceed Stripe's rate limit?

#### 3b. Error Handling Consistency

```bash
# Compare error handling across FRs calling the same service
rg "catch.*External\|ExternalServiceError\|TimeoutError" src/ --glob '*.ts' --glob '*.py' -n
```

Conflict: FR-A retries on timeout, FR-B fails immediately on timeout — inconsistent behaviour for the same service.

#### 3c. Shared Credentials

```bash
# Check that FRs don't overwrite each other's external service state
rg "apiClient\.\|sdkInstance\." src/ --glob '*.ts' --glob '*.py' -n | head -20
```

### Phase 4: API Contract Coherence

Check that all generated code matches the API contract:

```bash
# Extract all defined routes from generated code
rg "router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)" src/ --glob '*.ts' --glob '*.py' -n | grep -oP '(get|post|put|patch|delete).*["\x27]/[^"\x27]+["\x27]' | sort

# Compare against api-contract.yaml
cat docs/contracts/api-contract.yaml | grep "^  /" | sort
```

#### 4a. Response Shape Drift

```bash
# Check that response objects match the API contract schema
# For each endpoint in api-contract.yaml, find the corresponding route handler and check the return shape
rg "return.*NextResponse\|return.*response\|res\.json\|return.*jsonify" src/ --glob '*.ts' --glob '*.py' -n
```

Find any FR that returns a field not in the contract, or omits a required field.

#### 4b. Error Code Drift

```bash
# Check that all error codes used are in the taxonomy
rg "code:.*['\"]|'code'.*:" src/ --glob '*.ts' --glob '*.py' -n | grep -oP "['\"][A-Z_]+['\"]" | sort -u

# Compare against error-taxonomy.md
rg "^\| \`" docs/contracts/error-taxonomy.md | grep -oP '`[A-Z_]+`' | sort -u
```

Any error code in the code not in the taxonomy is a drift violation.

#### 4c. Auth Pattern Consistency

```bash
# Check that all protected routes use the same auth middleware
rg "requireAuth\|withAuth\|authenticate\|@require_auth" src/ --glob '*.ts' --glob '*.py' -n

# Find routes that skip auth without being in the public list
rg "router\.(get|post)" src/ --glob '*.ts' --glob '*.py' -n | grep -v "requireAuth\|withAuth\|authenticate"
```

Compare against `public_endpoints` in `docs/contracts/auth-matrix.json`.

### Phase 5: Produce the Integration Report

Write to `docs/reviews/cross-fr-integration-report.md`:

```markdown
# Cross-FR Integration Review
*Date: [date] | FRs reviewed: N | Branch: [integration branch]*

## Executive Summary
[overall verdict, number of conflicts found, severity breakdown]

## Inventory Matrix
[Table → FRs, State Machine → FRs, External Service → FRs]

## Conflicts Found

### CRITICAL — Must fix before merge to main
[Each conflict with: description, affected FRs, affected files:lines, specific fix required]

### HIGH — Should fix before release
[...]

### MEDIUM — Technical debt, fix in next sprint
[...]

## Clean Checks
[What was checked and found clean — for audit trail]

## Verdict
[PASS | CONDITIONAL | BLOCKED]
Blocking items: [list if BLOCKED]
```

### Phase 6: Update Manifest

```json
{
  "cross_fr_review": {
    "status": "complete",
    "triggered_at": "<iso8601>",
    "verdict": "PASS|CONDITIONAL|BLOCKED",
    "conflicts_critical": 0,
    "conflicts_high": 1,
    "report": "docs/reviews/cross-fr-integration-report.md",
    "signed_off": false
  }
}
```

### Phase 7: Present to Human

After generating the report:
- State the verdict clearly
- List every CRITICAL conflict with its fix
- Ask the human to review the report and sign off in `manifest.json`
- Do not block on sign-off — surface the findings and let the human decide

## Verdict Rules

- **PASS** — Zero CRITICAL, zero HIGH conflicts
- **CONDITIONAL** — Zero CRITICAL, 1+ HIGH conflicts (document them, may proceed with known debt)
- **BLOCKED** — Any CRITICAL conflict — must be resolved before merging to main

## Output

- `docs/reviews/cross-fr-integration-report.md`
- Updated `manifest.json`

## Quality Checklist

- [ ] All FRs were in `merged` state before review started
- [ ] Shared table matrix covers all tables written by 2+ FRs
- [ ] State machine check covers all entities with status enums
- [ ] External service check covers all services called by 2+ FRs
- [ ] API contract drift check compared generated routes against api-contract.yaml
- [ ] Error code drift check compared generated error codes against error-taxonomy.md
- [ ] Every conflict has: description, affected FRs, file:line references, specific fix
- [ ] Report saved to docs/reviews/
- [ ] manifest.json updated with verdict
