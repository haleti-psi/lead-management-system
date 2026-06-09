---
name: quality-review
description: End-to-end code quality and functional completeness review covering requirements mapping, API contracts, database schema and migrations, error handling, test coverage, code maintainability, and i18n. Produces a prioritized improvement plan with a quality verdict.
argument-hint: "[target] [phase]"
---

# Code Quality & Completeness Review

Perform an end-to-end code quality and functional completeness review and produce a prioritized, actionable improvement plan with a quality verdict.

## Scoping

If the user specifies a target (example: `/quality-review apps/api`), review only that app or package. Otherwise review the full codebase.

If the user specifies a phase (example: `/quality-review api only`), run only that section.
Valid phase keywords: `preflight`, `discover`, `completeness`, `api`, `database`, `errors`, `testing`, `quality`, `i18n`, `gates`, `bugs`, `backlog`, `quickwins`.

If target includes `/`, generate a safe output slug: replace `/` with `-`, remove spaces.

## Operating Rules

- Evidence-first: cite exact files and line numbers.
- Separate `confirmed` evidence from `inferred` conclusions.
- Never claim a check passed unless you ran or inspected it.
- If evidence is missing, state the gap and how to obtain it.
- Every recommendation must include: `what`, `where`, `how`, and `verify`.
- Prefer small, reversible fixes; propose phased migration for larger refactors.
- Recommend one default path when options exist; give short rationale.
- Prioritize: Data correctness -> Functional gaps -> Error handling -> API contracts -> Test coverage -> Maintainability.
- Save final report to `docs/reviews/quality-review-{targetSlug}-{YYYY-MM-DD}.md`.

## Troubleshooting

Common review blockers and how to resolve them:

- **Build fails**: Run `npx tsc --noEmit 2>&1 | head -20` to identify type errors. Check if workspace packages need rebuilding (`npm run build:shared`).
- **Tests fail with fixture errors**: Check for missing test database or seed data. Verify `.env.test` exists.
- **Requirements documents not found**: Fall back to Phase 2B (code-inferred feature coverage).
- **Context pressure from large codebase**: Use the Context-Overflow Strategy section.

## Quality Bar (Definition of Done)

The review is complete only when all are present:

- Codebase structure map with module inventory.
- Functional completeness assessment against requirements (if available).
- Findings for all requested categories with evidence.
- Every finding has severity, confidence, and verification steps.
- QA gate scorecard with `PASS` / `PARTIAL` / `FAIL`.
- Quality verdict (`SOLID` / `NEEDS-WORK` / `AT-RISK`) with blocking issues listed.
- Prioritized improvement backlog and quick-win plan.

## Severity, Confidence, and Risk

Use these fields for every finding:

- `Severity`: `P0` (urgent — data loss or corruption risk), `P1` (high — fix this sprint), `P2` (medium — next sprint), `P3` (low — cleanup/hardening)
- `Confidence`: `High` (direct evidence), `Medium` (strong inference), `Low` (hypothesis)
- `Status`: `Confirmed`, `Partially Confirmed`, `Unverified`

Risk scoring:

`Risk Score = Impact (1-5) x Likelihood (1-5)`

Risk Score to severity mapping: `16-25 = P0`, `9-15 = P1`, `4-8 = P2`, `1-3 = P3`.

---

## Phase 0: Preflight

Before deep analysis, capture:

- Scope, assumptions, and explicit exclusions.
- Current commit hash and branch.
- Tech stack discovery: languages, frameworks, ORMs, validation libraries, test frameworks.
- Available quality scripts (test, lint, typecheck, format, coverage).
- Requirements documents location (BRD, SRS, user stories, epics) — if any.
- Environment constraints (missing databases, APIs, test fixtures).

Output a preflight block so readers understand confidence boundaries.

## Phase 1: Codebase Discovery

Scan and document:

- Module inventory: apps, packages, services, libraries.
- Dependency graph: which modules depend on which.
- Shared code: reusable packages, utilities, types.
- Entry points: API servers, CLI tools, UI apps, workers, cron jobs.
- Configuration patterns: env vars, config files, feature flags.
- Build and output structure.

Recommended discovery commands:

```bash
# Module inventory
ls -d apps/*/  packages/*/  2>/dev/null

# Dependency graph between workspace packages
rg '"@puda/' apps/*/package.json packages/*/package.json

# Entry points
rg -l "listen\(|createServer\|createApp" apps/*/src --glob '*.ts' | head -10
```

Include a module map (table or diagram) showing component relationships.

## Phase 2: Functional Completeness

### A) Requirements Mapping

If requirements documents exist:

- Inventory all functional requirements.
- Map each to implementation evidence (route, component, service, migration).
- Identify: implemented, partially implemented, not implemented, and over-implemented (scope creep).

Produce a completeness matrix:

| Requirement ID | Description | Implementation Evidence | Status | Gaps | Notes |
|----------------|-------------|------------------------|--------|------|-------|

Status: `Complete`, `Partial`, `Missing`, `Over-Implemented`, `Unable to Verify`.

### B) Feature Coverage (Code-Inferred)

If no requirements docs, infer feature coverage from code:

- Route inventory: all CRUD and business-logic endpoints.
- Entity coverage: create, read, update, delete, list, search for each domain entity.
- Workflow/state-machine completeness: all states reachable, all transitions implemented.
- UI screen coverage: all routes have corresponding views with data binding.

### C) Business Logic Gaps

- Edge cases: boundary conditions, empty states, max-value scenarios.
- Workflow transitions: unreachable states, missing guard conditions, dead-end states.
- Data consistency: operations that should be transactional but are not.
- Feature parity: multi-tenant/multi-role features that work for one role but not others.

### D) Integration Completeness

- Frontend-to-API alignment: every UI action has a corresponding API endpoint.
- API response shapes match frontend expectations (types, field names, pagination).
- Error responses from API are handled in frontend (not just happy path).
- Cross-service communication: all expected integrations are wired.

### E) Skeleton & Stub Component Detection (P0 Gate)

**Critical check — catches the #1 failure mode in AI-assisted codebases: components that exist as files but have no functional content.**

AI coding assistants frequently generate components with correct imports, hooks, and JSX shells but zero interactive content (no form fields, no data rendering, no API payloads). These "skeleton" components pass every pattern-based review (coding standards, accessibility, i18n) because empty code has no violations. They only fail when a user tries to actually use the feature.

**Detection procedure:**

#### Step 1: Inventory all interactive components

```bash
# Find all components that import form/mutation hooks (these SHOULD have form fields)
rg -l 'useApiMutation|useMutation|useFormState|useForm\b' <component-dirs> --glob '*.tsx'

# Find all components that import query hooks (these SHOULD render data)
rg -l 'useApiQuery|useQuery|useSWR|useFetch' <component-dirs> --glob '*.tsx'
```

#### Step 2: Check form components for substance

For each component that imports a mutation hook, verify it has form inputs:

```bash
# For each mutation-importing component, count form elements
for file in $(rg -l 'useApiMutation|useMutation' <component-dirs> --glob '*.tsx'); do
  INPUTS=$(rg -c '<(input|select|textarea|FormField|FormSelect|FormCheckbox|FormDateInput|FormCurrencyInput|TextField|Input|Slider|Switch|RadioGroup)\b' "$file" 2>/dev/null || echo 0)
  FORM=$(rg -c '<form\b|onSubmit' "$file" 2>/dev/null || echo 0)
  LINES=$(wc -l < "$file" | tr -d ' ')
  echo "$file: ${INPUTS} inputs, ${FORM} form/submit, ${LINES} lines"
done
```

**Skeleton indicators** (flag as P0):
- Component imports mutation hook but has 0 form input elements
- Component has `<form onSubmit>` but the JSX body contains only a button (no fields)
- Component has fewer than 30 lines of JSX but is mapped to a multi-field CRUD operation
- Wizard/stepper component where individual steps render only a title or "Mark Complete" button

#### Step 3: Check data display components for substance

For each component that imports a query hook, verify it renders the fetched data:

```bash
# For each query-importing component, check for data rendering
for file in $(rg -l 'useApiQuery|useQuery|useSWR' <component-dirs> --glob '*.tsx'); do
  MAPS=$(rg -c '\.map\(' "$file" 2>/dev/null || echo 0)
  DATA_REFS=$(rg -c 'data\.\w+|item\.\w+|record\.\w+' "$file" 2>/dev/null || echo 0)
  echo "$file: ${MAPS} .map() calls, ${DATA_REFS} data field references"
done
```

**Skeleton indicators** (flag as P0):
- Component fetches data via query hook but never references any field from the response in JSX
- Component has `.map()` but the mapped JSX is a placeholder (`<li key={item.id}>{item.id}</li>` with no other fields)

#### Step 4: Check API payload completeness

For form components, verify the mutation payload includes all fields that the form collects:

```bash
# Find form field names and mutation call in same component
rg 'name=["'\''](\w+)["'\'']' <component-file> -o  # form field names
rg 'mutate\(|mutation\(' <component-file> -A 10      # payload sent to API
```

**Skeleton indicators** (flag as P1):
- Form has 6 inputs but mutation payload sends only 2 fields
- Mutation sends hardcoded/dummy values instead of form state
- Form state is managed (`useState`, `useFormState`) but never passed to the mutation

#### Step 5: Cross-reference schemas vs form fields

```bash
# Extract field names from Zod/validation schema
rg '(z\.\w+|schema)\.' shared/schemas.ts -A 1 | rg '(\w+):' -o | sort -u

# Compare with form field names in the corresponding component
rg 'name=["'\''](\w+)["'\'']|handleChange\(["'\''](\w+)["'\'']' <component-file> -o | sort -u
```

If the schema defines 10 fields but the form renders 3, that is a **P0 finding** — the form is incomplete.

**Finding format:**

| File | Type | Schema Fields | Form Fields | Gap | Severity |
|------|------|---------------|-------------|-----|----------|
| IntakeWizard.tsx | Form (8-step wizard) | 20+ (across steps) | 1 (Mark Complete button) | SKELETON: 0 step content | P0 |
| ConsentForm.tsx | Toggle | 2 (privacy, disclaimer) | 2 checkboxes (orphaned state) | SKELETON: checkboxes not connected to API | P0 |

**This check is a BLOCKING GATE.** Any P0 skeleton findings cause the Functional Completeness gate to FAIL.

### F) Data Round-Trip Verification

For every CRUD feature, verify the full write-read cycle works at the code level:

**Write path** (form → API → DB):
1. Form collects field value via input/select
2. Form state includes the field
3. Mutation payload sends the field to the API
4. Server route handler reads the field from `request.body`
5. Service/ORM writes the field to the database

**Read path** (DB → API → UI):
1. DB query/ORM select returns the field
2. API response JSON includes the field
3. Frontend query hook receives the field
4. Component JSX renders or uses the field

```bash
# Trace a field through the stack (example: "taxResidency")
FIELD="taxResidency"
echo "=== FORM ==="
rg "$FIELD" client/src/components/ --glob '*.tsx' | head -5
echo "=== API ROUTE ==="
rg "$FIELD" server/routes/ --glob '*.ts' | head -5
echo "=== SERVICE ==="
rg "$FIELD" server/services/ --glob '*.ts' | head -5
echo "=== SCHEMA ==="
rg "$FIELD" shared/ prisma/ --glob '*.ts' --glob '*.prisma' | head -5
echo "=== RESPONSE ==="
rg "$FIELD" server/routes/ server/services/ --glob '*.ts' | rg 'response|json|return' | head -5
```

**Common broken round-trip patterns** (flag as P1):
- Form sends field but server route doesn't destructure it from body → data silently lost
- Server writes field but workspace/GET response doesn't include it → UI shows stale data
- Schema has field but form doesn't collect it → field always null/default
- Form collects field but sends wrong field name (camelCase vs snake_case mismatch)
- Form sends field to wrong endpoint (POST to a route that ignores that field)

Sample at least 3 critical entity types (e.g., Person, Asset, Matter) and trace 3-5 fields each through the full stack. Report any breaks.

## Phase 3: API Contract Quality

### A) Route Design and Consistency

- RESTful conventions: resource naming, HTTP method usage, status codes.
- Consistent URL patterns across all API modules.
- Consistent response envelope (success and error shapes).
- Pagination, filtering, and sorting patterns are uniform.
- Idempotency for mutation endpoints (PUT, DELETE).

### B) Schema Validation

- All request bodies validated against schemas before processing.
- All path/query parameters validated and typed.
- Validation errors return structured, actionable error messages.
- Schema reuse: shared schemas for common patterns (pagination, ID params, timestamps).
- No `any` types or unvalidated request body access.

### C) Error Contract

- Consistent error response format across all endpoints.
- HTTP status codes used correctly (not 200 for errors, not 500 for client errors).
- Error messages are user-safe (no stack traces, internal paths, or SQL in responses).
- Domain errors are distinguishable from system errors.
- Error codes are documented or self-describing.

### D) API Documentation and Discoverability

- OpenAPI/Swagger spec exists or is auto-generated from schemas.
- Route handlers have clear parameter and return type annotations.
- Undocumented endpoints or parameters flagged.

## Phase 4: Database and Data Layer Quality

### A) Schema Design

- Tables have appropriate primary keys (UUID vs serial, consistency).
- Foreign keys with proper referential integrity constraints.
- Indexes exist for frequently queried columns and join conditions.
- Appropriate use of constraints: NOT NULL, UNIQUE, CHECK.
- Consistent naming conventions (snake_case, singular/plural, prefix conventions).
- Soft-delete vs hard-delete approach is consistent.

### B) Migration Quality

- Migrations are ordered and non-conflicting.
- Each migration is idempotent (can run twice without error) — uses `IF NOT EXISTS`, `IF EXISTS`.
- No destructive operations without a migration rollback plan.
- Migrations do not modify data in ways that break running application code (backward compatible).
- Seed data is separate from schema migrations.
- Migration file naming follows a consistent convention.

### C) Query Quality

- No N+1 query patterns (list endpoint that queries per item).
- Joins preferred over sequential queries where appropriate.
- Transactions used for multi-step mutations (not partial commit risks).
- Connection pooling configured with appropriate limits.
- No unbounded queries (missing LIMIT/pagination on list endpoints).
- Raw SQL is parameterized (no string interpolation with user input).

### Database Diagnostic Queries

Run these queries to quickly surface schema issues:

```bash
# List all tables and their column counts
psql "$DATABASE_URL" -c "SELECT table_name, COUNT(*) as col_count FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY table_name"

# Check for missing indexes on foreign key columns
psql "$DATABASE_URL" -c "SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name NOT IN (SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = (tc.table_name)::regclass) LIMIT 20"

# Check for tables without primary keys
psql "$DATABASE_URL" -c "SELECT t.table_name FROM information_schema.tables t LEFT JOIN information_schema.table_constraints tc ON t.table_name = tc.table_name AND tc.constraint_type = 'PRIMARY KEY' WHERE t.table_schema = 'public' AND tc.constraint_name IS NULL"
```

### D) ORM Schema-to-Database Consistency

**Critical check — catches "table does not exist" 500 errors in production.**

The application ORM schema (e.g., Drizzle `pgTable()`, Prisma `model`, SQLAlchemy `Base`) defines tables the code expects to exist. These MUST match the actual database. Drift causes silent 500 errors that only surface when a user hits the affected endpoint.

**Automated check procedure:**

1. Extract all table names from the ORM schema:
```bash
# Drizzle (TypeScript)
grep 'pgTable("' packages/shared/src/schema.ts | sed 's/.*pgTable("//' | sed 's/".*//' | sort -u > /tmp/orm_tables.txt

# Prisma
grep 'model ' prisma/schema.prisma | awk '{print $2}' | sort -u > /tmp/orm_tables.txt
```

2. Extract all table names from the database:
```bash
psql "$DATABASE_URL" -t -A -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" > /tmp/db_tables.txt
```

3. Diff the two lists:
```bash
echo "=== ORM TABLES MISSING FROM DB ==="
comm -23 /tmp/orm_tables.txt /tmp/db_tables.txt
```

4. For each missing table, check if it's actively used in server routes:
```bash
# For Drizzle — find the variable name for each missing table
# then search server/ for imports and usage
rg "from.*schema" server/ --glob '*.ts' | grep "<variableName>"
```

**Findings classification:**
- **P0 (deploy-blocker):** Table is missing AND actively queried in production routes → will 500.
- **P1 (high):** Table is missing AND imported in server code but may not be hit yet → latent 500.
- **P3 (low):** Table is in ORM schema but not referenced in any server code → harmless drift.

**Also check for MISSING COLUMNS (most common regression):**

This is the #1 cause of "shows 0 rows" bugs: a column is added to the ORM schema but the SQL migration is missing. Drizzle's `db.select().from(table)` expands to `SELECT col1, col2, ..., missing_col FROM table` → PostgreSQL throws "column does not exist" → catch block returns 500 → UI shows empty/zero.

```bash
# For each table defined in the ORM schema, compare column lists:
# 1. Extract ORM columns for a table (e.g., products)
grep -A200 'pgTable("products"' packages/shared/src/schema.ts | \
  grep -oP '(?<=\(")[a-z_]+(?="\))' | sort -u > /tmp/orm_cols.txt

# 2. Extract DB columns for the same table
psql "$DATABASE_URL" -t -A -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='products' ORDER BY column_name;" > /tmp/db_cols.txt

# 3. Find columns in ORM but missing from DB
echo "=== ORM COLUMNS MISSING FROM DB (will cause 500) ==="
comm -23 /tmp/orm_cols.txt /tmp/db_cols.txt
```

**Run this for every table that was modified in the current branch** (check `git diff` for schema.ts changes).

**Findings classification:**
- **P0 (deploy-blocker):** Column is in ORM schema AND the table is queried via `select().from()` (CRUD factory, snapshots) → guaranteed 500 on that endpoint.
- **P1 (high):** Column is in ORM schema AND the table is queried with explicit column list that includes the missing column.
- **P3 (low):** Column is in ORM schema but only used in `insert` operations with `.default()` — DB will use column default or NULL.

**Also check for column type mismatches** between ORM and DB:
- ORM says `integer` but DB column is `varchar` (breaks FK constraints and inserts).
- ORM says `serial` but DB column is `text` (type coercion issues).
- ORM references a FK to a table whose PK type doesn't match.

**Resolution:** Create `ALTER TABLE ADD COLUMN IF NOT EXISTS` migration for missing columns, matching the ORM schema exactly. Both the migration SQL file AND the schema.ts change must land in the same commit.

### E) Data Integrity

- Business invariants enforced at the database level (not just application code).
- Unique constraints for naturally unique fields (email, reference numbers).
- Cascading deletes/updates are intentional and correct.
- Audit fields (created_at, updated_at, created_by) consistently present.
- Timestamps use consistent timezone handling (UTC preferred).

## Phase 5: Error Handling and Resilience

### A) Error Handling Patterns

- All async operations have error handling (try/catch, `.catch()`, error middleware).
- Global error handler exists and catches unhandled exceptions.
- Errors are logged with sufficient context (request ID, user ID, stack trace).
- Error handling does not swallow errors silently (`catch(e) {}` anti-pattern).
- Promise rejections are always handled (no unhandled promise rejections).

### B) Graceful Degradation

- External service failures are handled (API calls, database, file storage, queues).
- Timeout configuration for all external calls.
- Circuit breaker or retry patterns for unreliable dependencies.
- Fallback behavior defined for non-critical feature failures.
- SIGTERM/SIGINT handlers for graceful shutdown.

### C) Validation and Boundary Errors

- Input validation errors return helpful messages (not generic 500).
- File upload errors handled: too large, wrong type, corrupt file.
- Pagination boundary errors: negative page, page beyond results.
- Concurrent modification handling (optimistic locking or last-write-wins with awareness).

### D) Frontend Error Handling

- API errors displayed meaningfully to users (not raw JSON or stack traces).
- Network failure states: offline banner, retry mechanisms, cached data display.
- Error boundaries catch component crashes (React ErrorBoundary or equivalent).
- Form submission errors: field-level feedback, not just toast messages.
- Loading and error states for every data-fetching component.

## Phase 6: Testing and Quality Gates

### A) Test Coverage and Depth

- Unit test presence for core business logic (services, utilities, validators).
- Integration test presence for API routes (request/response verification).
- End-to-end test presence for critical user journeys.
- Test coverage percentage (if measurable): flag modules below 50%.

### B) Test Quality

- Tests assert behavior, not implementation details.
- Tests are deterministic (no time-dependent, order-dependent, or flaky tests).
- Test data setup is isolated (no shared mutable state between tests).
- Negative cases tested (invalid input, unauthorized access, missing data).
- Edge cases tested (empty collections, max values, concurrent operations).

### C) Test Infrastructure

- Tests can run locally without external dependencies (mocks/fixtures).
- CI pipeline runs tests on every PR/push.
- Test failures block merge/deploy.
- Test execution time is reasonable (not blocking developer productivity).

### D) Static Analysis

- TypeScript strict mode (or equivalent type checking) enabled.
- Linter configured and enforced (ESLint, Pylint, etc.).
- Formatter configured and enforced (Prettier, Black, etc.).
- No lint/type suppressions (`// @ts-ignore`, `// eslint-disable`) without explanatory comment.
- Type safety: minimal use of `any`, `unknown` is preferred over `any` where types are unclear.

## Phase 7: Code Maintainability

### A) Dead Code and Unused Exports

- Unused imports detected across the codebase.
- Exported functions/types/constants that are never imported.
- Unreachable code paths (after early returns, in disabled branches).
- Commented-out code blocks (should be removed or tracked as TODOs).
- Files not imported anywhere (orphaned modules).

### B) Duplication

- Repeated utility functions across modules.
- Copy-pasted handlers/components with minor variations.
- Duplicated type definitions that should be in shared packages.
- Repeated configuration patterns that could be abstracted.

### C) Naming and Organization

- Consistent naming conventions across the codebase.
- Clear module boundaries and responsibility separation.
- File organization follows a discoverable pattern.
- Naming reflects domain language (not implementation details).

### D) Complexity Hotspots

- Functions exceeding ~50 lines (candidates for extraction).
- Files exceeding ~500 lines (candidates for splitting).
- Deeply nested conditionals (>3 levels — candidates for early returns or extraction).
- High cyclomatic complexity functions.
- God objects or modules with too many responsibilities.

### E) Technical Debt Indicators

- TODO/FIXME/HACK comments inventory.
- Temporary workarounds that became permanent.
- Version pinning with comments about compatibility issues.
- Feature flags or conditional logic for deprecated features.

### Common Fix Patterns

**N+1 Query**: Replace loop-based queries with a single JOIN or IN clause:
```typescript
// BAD: N+1
for (const id of ids) { await db.query("SELECT * FROM items WHERE id = $1", [id]); }
// GOOD: Single query
const items = await db.query("SELECT * FROM items WHERE id = ANY($1)", [ids]);
```

**Missing Error Handler**: Add global error handler in Fastify:
```typescript
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  reply.status(error.statusCode ?? 500).send({ error: error.message });
});
```

**Silent Error Swallowing**: Replace empty catch with logging:
```typescript
// BAD: catch(() => {})
// GOOD: catch((err) => { logger.warn({ err }, "non-critical failure"); })
```

**Hardcoded String in UI**: Use i18n function:
```tsx
// BAD: <span>Submit</span>
// GOOD: <span>{t("common.submit")}</span>
```

## Phase 8: Internationalization and Content Quality

### A) i18n Coverage

- All user-visible text uses i18n functions (no hardcoded strings in UI components).
- Translation keys exist in all required locale files.
- No missing translations (keys present in one locale but not others).
- Dynamic content (interpolation, pluralization) handled correctly.

### B) i18n Pattern Compliance

- Consistent use of i18n utilities across the codebase.
- Labels, headings, and messages follow the project's i18n conventions.
- Date, number, and currency formatting use locale-aware utilities.
- Error messages are translatable (not hardcoded English in API responses shown to users).

### C) Content Quality

- Error messages are actionable (tell the user what to do, not just what went wrong).
- Consistent tone and terminology across the application.
- No placeholder or lorem ipsum text remaining.
- Technical jargon not exposed to end users.

## Phase 9: QA Gates and Quality Verdict

Assess each gate as `PASS`, `PARTIAL`, `FAIL`.

Blocking gates:

1. **Functional completeness** — Core features implemented and wired end-to-end.
2. **Component substance** — No skeleton/stub components: every form has fields proportional to its schema, every data view renders fetched data, every wizard step has content. (See Phase 2E.)
3. **Data round-trip integrity** — CRUD fields flow from form → API → DB → API → UI without data loss at any layer. (See Phase 2F.)
4. **Data integrity** — Transactions, constraints, and validation protect data correctness.
5. **API contracts** — Consistent schemas, error envelopes, and status codes.
6. **Error handling** — No silent failures; errors surfaced and handled at every layer.
7. **Type safety** — Strict types; minimal `any`; no untyped API boundaries.
8. **Critical-path tests** — Core business logic and key user journeys have test coverage.
9. **Build health** — Build succeeds cleanly; no warnings treated as acceptable.

Non-blocking gates:

1. **Test depth** — Coverage beyond critical paths; edge cases and negative cases.
2. **Code maintainability** — Low duplication, clear naming, manageable complexity.
3. **i18n completeness** — All user-facing text internationalized where required.
4. **Documentation** — API docs, code comments for non-obvious logic.

Gate assessment criteria:

- `PASS` — Evidence confirms the gate is fully satisfied with no significant gaps.
- `PARTIAL` — Evidence shows the gate is addressed but with 1-3 notable exceptions or incomplete areas. Document each exception.
- `FAIL` — Critical gap: no evidence of gate satisfaction, or evidence of systematic violation (3+ instances).

Verdict policy:

- Any blocking gate `FAIL` => `AT-RISK`.
- Blocking gates all `PASS` or `PARTIAL` with no `FAIL` and 2+ `PARTIAL` => `NEEDS-WORK`.
- Blocking gates all `PASS` with at most 1 `PARTIAL` => `SOLID`.

Verdict block:

```text
Functional Status:     [PASS | PARTIAL | FAIL]
Component Substance:   [PASS | PARTIAL | FAIL]  (skeleton/stub detection)
Data Round-Trip:       [PASS | PARTIAL | FAIL]  (form → API → DB → UI)
Data Integrity:        [PASS | PARTIAL | FAIL]
API Contracts:         [PASS | PARTIAL | FAIL]
Error Handling:        [PASS | PARTIAL | FAIL]
Blocking Gates:        X/9 PASS, Y/9 PARTIAL, Z/9 FAIL
Non-Blocking Gates:    X/4 PASS, Y/4 PARTIAL, Z/4 FAIL
Quality Verdict:       [SOLID | NEEDS-WORK | AT-RISK]
```

## Phase 10: Bugs and Foot-Guns

Minimum counts:

- Full-repo review: `10+` high-impact and `10+` medium-impact findings.
- Scoped review: `5+` high-impact and `5+` medium-impact findings.

High-impact = P0 + P1 findings. Medium-impact = P2 findings.

Each finding must include:

- Severity, confidence, and status.
- Exact file:line evidence.
- Impact statement (data loss, incorrect behavior, user-facing bug, etc.).
- Specific fix with code-level guidance.
- Verification steps.

## Phase 11: Requirements Compliance Matrix

If requirements documents are available, produce:

| Requirement ID | Description | Implementation Evidence | Status | Gap | Next Step |
|----------------|-------------|------------------------|--------|------|-----------|

If no formal requirements, produce a feature-coverage matrix based on inferred domain model.

## Phase 12: Improvement Backlog

Backlog size:

- Full-repo: `25-50` items.
- Scoped: `10-25` items.

| ID | Title | Priority | Risk Score | Effort | Category | Where | Why | Fix | Verify | Dependencies |
|----|-------|----------|------------|--------|----------|-------|-----|-----|--------|--------------|

Priority:

- `P0`: urgent — data correctness or critical functionality gap.
- `P1`: high — fix this sprint.
- `P2`: medium — next sprint.
- `P3`: low — cleanup/hardening.

Effort:

- `S`: under 2 hours.
- `M`: 2 hours to 2 days.
- `L`: more than 2 days.

## Phase 13: Quick Wins and Stabilization

- Quick wins (2 hours): `5-10` fixes with immediate quality improvement.
- 2-day stabilization: `8-15` fixes that materially improve reliability and correctness.

Each task must include exact file targets and verification steps.

## Phase 14: Verification Commands

Adapt commands to the discovered tech stack. Examples:

```bash
# Type checking
npx tsc --noEmit 2>&1 | head -50
# or: mypy . --ignore-missing-imports

# Linting
npx eslint . --max-warnings=0 2>&1 | tail -20
# or: ruff check .

# Test execution
npm test 2>&1 | tail -30
# or: pytest --tb=short

# Test coverage (if configured)
npm run test:coverage 2>&1 | tail -20

# Dead code detection
rg -n "export (function|const|class|type|interface) " --glob '*.ts' --glob '*.tsx' | head -50
# Then cross-reference: are these exports imported anywhere?

# TODO/FIXME inventory
rg -n "\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b|\bTEMP\b" --glob '!node_modules' --glob '!*.lock'

# Unused imports (TypeScript)
rg -n "^import .* from" --glob '*.ts' --glob '*.tsx' | head -30

# N+1 query patterns
rg -n "for.*await.*query\(|\.forEach.*await.*find" --glob '*.ts' --glob '*.js'

# Missing error handling
rg -n "\.catch\(\(\) => \{\}\)|catch\s*\(e?\)\s*\{\s*\}" --glob '*.ts' --glob '*.js'

# Any type usage
rg -n ": any\b|as any\b" --glob '*.ts' --glob '*.tsx'

# Hardcoded strings in UI (potential i18n misses)
rg -n '>[A-Z][a-z].*</' --glob '*.tsx' --glob '*.jsx' | head -30

# Build verification
npm run build 2>&1 | tail -20
```

Record each command as `Executed` or `Not Executed` with reason.

### Migration-to-Code Column Consistency

Verify that column names in migration SQL match the names used in application queries:

```bash
# Extract column names from CREATE TABLE statements
rg -n 'CREATE TABLE' --glob '*.sql' -A 20 | head -60

# Cross-reference with query code — find column references
rg -n "SELECT|INSERT INTO|UPDATE.*SET|WHERE" --glob '*.ts' --glob '!*.test.*' --glob '!*.spec.*' | head -40

# Find potential mismatches: snake_case in SQL vs camelCase in code
rg -n 'data_jsonb|state_id|created_at|updated_at' --glob '*.ts' --glob '!*.sql' | head -20
```

Flag any column referenced in queries that does not exist in the migration-defined schema.

## Context-Overflow Strategy

For large codebases (> 20 apps/packages or > 100K lines), prevent context overflow:

1. **Phase 1**: Scan full codebase for structure, but only retain the module map.
2. **Phase 2-8**: Process one app/package at a time. Record findings incrementally to the output file.
3. **Phase 9-14**: Compile findings from all processed modules.
4. If context pressure is high, prioritize: blocking-gate phases first, non-blocking phases second.
5. Always complete the gate scorecard and verdict — these are the minimum viable output.

## Output

Final report sections in order:

1. Scope and Preflight
2. Codebase Discovery
3. Functional Completeness Assessment
4. API Contract Findings
5. Database and Data Layer Findings
6. Error Handling Findings
7. Testing and Quality Gate Findings
8. Code Maintainability Findings
9. i18n and Content Findings
10. QA Gates and Verdict
11. Bugs and Foot-Guns
12. Requirements Compliance Matrix
13. Improvement Backlog
14. Quick Wins and Stabilization
15. Top 5 Priorities

If `docs/reviews/` does not exist, create it before writing the report.
