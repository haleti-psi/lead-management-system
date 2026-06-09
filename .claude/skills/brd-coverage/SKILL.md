---
name: brd-coverage
description: Full BRD/requirements audit — maps every line-item requirement (AC, BR, edge case, failure handling) to implemented code and test coverage. Produces a comprehensive gap list, traceability report, and compliance verdict.
argument-hint: "<brd-file> [phase]"
---

# BRD Coverage Audit — Line-Item Granularity

Perform a comprehensive BRD/requirements audit at the **individual line-item level**: every acceptance criterion, business rule, edge case, and failure handling item is separately verified against the codebase. Produce a full traceability report, a flat sortable gap list, and a compliance verdict.

## Scoping

Parse the user's arguments:

```
/brd-coverage <brd-file> [phase]
```

- **`<brd-file>`** (required): Path to the BRD/requirements markdown or .docx file.
- **`[phase]`** (optional): Phase filter keyword. Default: `full`.

### Phase Keywords

| Keyword | Phases Run |
|---------|------------|
| `code-only` | Phases 0-2 only (preflight + extraction + code traceability) |
| `test-only` | Phases 0-1, 3 only (preflight + extraction + test coverage) |
| `gaps-only` | Phases 0-2, 4 only (preflight + extraction + code traceability + gap list) |
| `full` (default) | All phases 0-6 |

### No Arguments

If invoked with no arguments, ask the user which BRD file to audit.

## Project Context Discovery

**This skill is project-agnostic.** At the start of every audit, auto-detect the project structure:

### Step 1: Identify Tech Stack

```bash
# Detect project type from root files
ls package.json pyproject.toml requirements.txt Cargo.toml go.mod pom.xml build.gradle 2>/dev/null

# Detect frameworks
rg -l "express|fastify|koa|hono|nest" package.json 2>/dev/null          # Node.js backend
rg -l "react|vue|angular|svelte|next" package.json 2>/dev/null           # Frontend
rg -l "fastapi|django|flask" pyproject.toml requirements.txt 2>/dev/null  # Python backend
```

### Step 2: Map Source Directories

Discover the code layout dynamically — do NOT hardcode paths. Use these heuristics:

| Layer | Common Paths |
|-------|-------------|
| **API routes** | `server/routes/`, `src/routes/`, `src/api/`, `app/api/`, `src/controllers/` |
| **Business logic** | `server/services/`, `src/services/`, `src/domain/`, `src/lib/`, `src/core/` |
| **Data access** | `server/storage/`, `src/repositories/`, `src/db/`, `src/models/`, `src/dao/` |
| **Middleware** | `server/middleware/`, `src/middleware/`, `src/guards/`, `src/interceptors/` |
| **UI pages** | `client/src/pages/`, `src/pages/`, `src/app/`, `app/`, `pages/` |
| **UI components** | `client/src/components/`, `src/components/`, `components/` |
| **Shared types** | `shared/`, `src/types/`, `src/schemas/`, `packages/shared/` |
| **Tests** | `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `test/`, `e2e/` |
| **Python services** | `services/*/`, any directory with `pyproject.toml` or `requirements.txt` |

```bash
# Auto-discover source directories
find . -maxdepth 3 -type d \( -name routes -o -name services -o -name pages -o -name components -o -name middleware -o -name storage -o -name models -o -name controllers -o -name repositories \) 2>/dev/null | grep -v node_modules | grep -v .git

# Auto-discover test directories
find . -maxdepth 3 -type d \( -name tests -o -name __tests__ -o -name test -o -name e2e -o -name spec \) 2>/dev/null | grep -v node_modules | grep -v .git
```

Record the discovered structure in the preflight report and use these paths for all subsequent searches.

### Step 3: Monorepo Detection

```bash
# Check for workspace configuration
cat package.json 2>/dev/null | python3 -c "
import json, sys
pkg = json.load(sys.stdin)
ws = pkg.get('workspaces', [])
if ws: print('Monorepo workspaces:', ws)
else: print('Single-package project')
" 2>/dev/null

# Check for multiple services
ls -d services/*/ apps/*/ packages/*/ 2>/dev/null
```

If monorepo, identify which workspace(s) the BRD covers and scope the audit accordingly.

## Operating Rules

### Evidence Standards

- **Evidence-first**: cite exact `file_path:line_number` for every implementation claim.
- **Confirmed vs Inferred**: mark evidence as `CONFIRMED` (exact code match) or `INFERRED` (reasonable deduction).
- **Never assume implementation**: if you cannot find concrete code evidence, verdict is `NOT_FOUND`.
- **Ambiguous = PARTIAL**: if evidence exists but doesn't fully satisfy, mark `PARTIAL` with explanation.

### Search Discipline

For each line item, use **at least 3 search strategies** before concluding `NOT_FOUND`:
1. Keyword search (terms from the requirement text)
2. Entity search (table names, column names, route paths, component names)
3. Semantic search (related concepts, synonyms, alternative implementations)

Search across ALL discovered layers from the project context step.

### Full-Stack Verification

For projects with a frontend (React, Vue, Angular, Svelte, Next.js, etc.), apply this rule:

**Any functional requirement (FR) that describes user-facing behavior must have evidence from BOTH layers:**

| Layer | What counts as evidence |
|-------|------------------------|
| **Backend** | API route handler, service function, database schema, middleware |
| **Frontend** | React/Vue/Angular component, form, page, modal, wizard step, or UI workflow that calls the backend endpoint |

**Verdict impact:**
- Backend + Frontend evidence → `DONE` (subject to Behavioral Completeness check below)
- Backend only (route exists, no UI) → `PARTIAL` with note: "API implemented, no UI component"
- Frontend only (UI exists, no backend) → `PARTIAL` with note: "UI exists, backend not implemented"
- Neither → `NOT_FOUND`

**Which requirements are "user-facing"?** Any FR that implies a user action: "create", "add", "edit", "delete", "select", "upload", "configure", "view", "submit", "approve". Requirements that are purely system-internal (cron jobs, background processing, security middleware, audit logging) are exempt.

**Detecting frontend evidence:** Search for:
1. Components/pages that render forms, inputs, or interactive elements for the requirement
2. `fetch`/`axios`/API calls to the corresponding backend endpoint
3. Route definitions that map to the feature's page
4. State management (useState, useReducer, store) handling the feature's data

If the project has no frontend (pure API/library), skip this rule entirely.

### Behavioral Completeness (Anti-Skeleton Check)

**Critical rule — catches "skeleton" components that exist as files but have no functional content.**

A component file existing and importing the right hooks is NOT sufficient evidence of implementation. AI-assisted coding frequently produces skeleton components that have correct structure (imports, hooks, JSX shell) but zero interactive content (no form fields, no data display, no user inputs). These pass all pattern-based checks but are functionally empty.

**For every user-facing FR marked `DONE`, apply this behavioral completeness check:**

#### 1. Form Component Substance Check

If the FR requires data entry (create, edit, configure, submit), the frontend component MUST contain:
- **Form inputs** proportional to the data model — count `<input>`, `<select>`, `<textarea>`, `FormField`, `FormSelect`, `FormCheckbox`, `FormDateInput`, `FormCurrencyInput`, or framework equivalents (e.g., `<TextField>`, `<Select>`, `<Checkbox>`)
- **Schema-field coverage** — compare the number of user-editable fields in the Zod/Yup/JSON schema against the number of form inputs rendered. If the schema has 8 fields but the form has 0-2 inputs, verdict is `SKELETON`
- **Submit handler with API call** — the form's `onSubmit` must invoke a mutation/fetch to the backend. A `console.log` or empty handler is `SKELETON`

```bash
# Count form inputs in a component
rg -c '<(input|select|textarea|FormField|FormSelect|FormCheckbox|FormDateInput|FormCurrencyInput|TextField|Input)\b' <component-file>

# Verify submit handler calls API
rg 'onSubmit|handleSubmit' <component-file> -A 10 | rg 'mutate|fetch|post|patch|put|api\.'
```

#### 2. Data Display Substance Check

If the FR requires data display (view, list, report, dashboard), the frontend component MUST contain:
- **Data rendering** — JSX that maps over or displays fetched data (`.map(`, `{data.fieldName}`, table rows, list items)
- **Data source** — a query hook (`useQuery`, `useApiQuery`, `useFetch`, `useEffect` + `fetch`) that loads the data
- If the component fetches data but only renders a static shell with no data binding, verdict is `SKELETON`

```bash
# Verify component renders fetched data
rg '\.map\(|data\.\w+|item\.\w+|\{.*\.\w+\}' <component-file> | head -10
```

#### 3. Multi-Step Workflow Substance Check

If the FR describes a wizard, workflow, or multi-step process, verify:
- **Each step has content** — every step/tab in the workflow renders form fields or data, not just a title and "Next" button
- **Step count matches spec** — if the BRD says "8-step intake workflow", all 8 steps must have substantive content
- A wizard with navigation but empty step bodies is `SKELETON`

#### 4. Data Round-Trip Verification

For CRUD features, verify the full data path exists:
- **Write path**: Form field → form state → API call payload includes the field → server route handler reads the field → ORM/DB write includes the field
- **Read path**: DB query returns the field → API response includes the field → frontend receives and renders the field

```bash
# Trace a specific field from form to DB (example: "taxResidency")
# 1. Frontend form has the field
rg 'taxResidency|tax_residency' <component-file>
# 2. API payload includes it
rg 'taxResidency|tax_residency' <component-file> | rg 'handleChange|onChange|setValue'
# 3. Server route processes it
rg 'taxResidency|tax_residency' server/routes/ server/services/
# 4. DB schema has the column
rg 'taxResidency|tax_residency' prisma/schema.prisma shared/schemas.ts packages/shared/src/schema.ts
# 5. Response includes it
rg 'taxResidency|tax_residency' <workspace-or-response-builder>
```

When the round-trip is broken at any point (field exists in schema but not in form, or form sends it but server ignores it), the verdict is `PARTIAL` with note: "Data round-trip broken at [layer]".

**Verdict adjustments:**
- Component has correct imports and structure but < 25% of expected form fields → `SKELETON` (not `DONE`)
- Component has form fields but submit handler doesn't call API → `SKELETON`
- Component fetches data but JSX doesn't render any of it → `SKELETON`
- Wizard has navigation but step bodies are empty → `SKELETON`
- Data round-trip broken (field missing from any layer) → `PARTIAL`

**SKELETON is treated as a distinct gap category:**

In the gap list (Phase 4), add category:
F) **Skeleton Components** — Frontend component file exists and passes pattern checks (correct imports, hooks, JSX structure) but has no functional content. These are the most dangerous gaps because they are invisible to static analysis and pass all other review checks. For each skeleton:
   - Which FR it claims to implement
   - What content is missing (form fields, data bindings, step bodies)
   - Expected effort to complete (typically S-M)
   - Priority: **P0** if the FR is a core user workflow, P1 otherwise

### Prioritization

1. Must Have / P0 FRs first
2. Should Have / P1 FRs next
3. Could Have / P2 FRs last
4. Within each FR: ACs first, then BRs, then edge cases, then failure handling

### Parallelization

Use the Agent tool to search multiple FRs in parallel when possible. Each agent should search for evidence of 3-5 related FRs and report back with file:line evidence.

## Phase 0 — Preflight

Verify and report:

1. **BRD file**: Confirm exists, note size and FR count. If `.docx`, extract text content first.
2. **Project structure**: Auto-discovered directories (from Project Context Discovery above).
3. **Tech stack**: Languages, frameworks, ORMs, test frameworks detected.
4. **Test infrastructure**: Locate test files, test config (jest.config, vitest.config, pytest.ini, etc.).
5. **Git state**: Branch, commit hash, uncommitted changes.
6. **Scope summary**: Total FRs, estimated total line items, phase filter.
7. **Frontend assessment**: If a frontend exists, count UI pages/components and note any gap between backend endpoint count and frontend form/page count. Flag if the ratio is heavily skewed (e.g., 30 API endpoints but only 2 interactive UI pages).

## Phase 1 — Requirement Extraction

Read the entire BRD file. Extract every auditable line item:

| Item Type | ID Pattern | Description |
|-----------|------------|-------------|
| **Acceptance Criterion** | `AC-nn` | Testable functional assertion |
| **Business Rule** | `BR-nn` | Validation constraint, data rule, or policy |
| **Edge Case** | `EC-nn` or narrative bullet | Boundary/corner-case behavior |
| **Failure Handling** | `FH-nn` or narrative bullet | Error recovery behavior |

If the BRD uses different labeling (e.g., numbered items, bullet points without IDs), assign sequential IDs during extraction (e.g., `FR-001.AC-01`, `FR-001.BR-01`).

Produce inventory summary and maintain flat line-item registry.

## Phase 2 — Code Traceability

For every line item, search the codebase for implementation evidence.

### Search Layers

Use the directories discovered in Phase 0. Common layers to search:

1. **API/Route handlers** — endpoint definitions, request handlers
2. **Business logic/Services** — core logic, processing, AI/ML integration
3. **Data access** — ORM queries, repositories, database schemas
4. **Middleware** — validation, auth, upload handling, error handling
5. **UI pages** — page-level components, route definitions
6. **UI components** — reusable components, forms, tables
7. **Shared schemas** — type definitions, validation schemas
8. **Python/other services** — microservice implementations
9. **Configuration** — env vars, feature flags, constants

### Verdict Per Line Item

| Verdict | Criteria |
|---------|----------|
| `DONE` | Clear, complete code evidence. **For user-facing FRs in full-stack projects: requires both backend AND frontend evidence** (see Full-Stack Verification rule). |
| `PARTIAL` | Some aspects implemented, others missing. **Includes: backend-only implementation of user-facing FRs** (API exists but no UI form/page/component). |
| `STUB` | Placeholder/TODO code exists |
| `NOT_FOUND` | No code evidence after exhaustive search |
| `OUT_OF_SCOPE` | Explicitly excluded from current phase |
| `DEFERRED` | Marked as future phase in BRD |

## Phase 3 — Test Coverage

For each line item, check for test coverage across test files.

| Verdict | Criteria |
|---------|----------|
| `TESTED` | At least one test exercises this requirement |
| `INDIRECT` | A test exercises the parent feature |
| `TC_ONLY` | Test case doc exists but no automated test |
| `UNTESTED` | No test evidence found |

## Phase 4 — Comprehensive Gap List

Produce a flat, sortable gap list of every line item that is not `DONE`+`TESTED`.

### Gap Sizing

| Size | Definition |
|------|------------|
| `XS` | Config change or single-line fix |
| `S` | < 2 hours |
| `M` | 2 hours - 2 days |
| `L` | 2-5 days |
| `XL` | > 5 days |

### Gap Categories

A) Unimplemented (NOT_FOUND)
B) Stubbed (STUB)
C) Partially Implemented (PARTIAL)
D) Implemented but Untested (DONE + UNTESTED)
E) **UI-Only Gaps** — Backend API exists but no frontend component exposes it to users. These are common in AI-assisted codebases where backend services are generated before UI forms. For each gap, note:
   - Which API endpoint(s) exist
   - What UI component is needed (form, page, wizard step, modal)
   - Priority: P1 if the FR is a core user workflow (create, intake, manage), P2 if secondary
F) **Skeleton Components** — Frontend component file exists and passes pattern checks (correct imports, hooks, JSX structure) but has no or minimal functional content (see Behavioral Completeness rule). These are the most dangerous gaps because they are invisible to static analysis and cause all other review skills to report false-positive compliance. For each skeleton:
   - Which FR it claims to implement
   - What content is missing (form fields, data bindings, step bodies, API payloads)
   - What the schema/BRD expects vs what the component actually renders
   - Expected effort to complete (typically S-M)
   - Priority: **P0** — skeletons are always blockers because they represent features that appear complete but do not function

**Do NOT skip "trivial" gaps.** Include: missing validations, error codes, config defaults, edge case handling, etc.

## Phase 5 — Constraint & NFR Audit

Separately audit constraints and non-functional requirements from the BRD:

- **Performance requirements**: Response time targets, concurrency limits
- **Security requirements**: Auth, encryption, OWASP compliance
- **Scalability**: Horizontal/vertical scaling support
- **Accessibility**: WCAG compliance, ARIA labels, keyboard navigation
- **Internationalization**: i18n support, locale handling
- **Data requirements**: Backup, retention, migration
- **Infrastructure**: Deployment config, monitoring, logging

## Phase 6 — Scorecard and Verdict

### Coverage Metrics

Calculate at line-item level:

```
LINE-ITEM COVERAGE
==================
Total auditable items:        {total}
  Acceptance Criteria (AC):   {ac_total}
  Business Rules (BR):        {br_total}
  Edge Cases (EC):            {ec_total}
  Failure Handling (FH):      {fh_total}

Implementation Rate:          {done + partial} / {total} = {pct}%
Test Coverage:                {tested} / {total} = {pct}%
Total Gaps:                   {gap_count}
```

### Compliance Verdict

| Verdict | Criteria |
|---------|----------|
| `COMPLIANT` | >= 90% ACs DONE AND >= 80% BRs DONE AND zero P0 gaps AND >= 70% tested |
| `GAPS-FOUND` | >= 70% ACs DONE AND <= 3 P0 gaps |
| `AT-RISK` | < 70% ACs DONE OR > 3 P0 gaps |

### Top 10 Priority Actions

List the 10 most impactful actions to close gaps, ordered by:
1. P0 gaps first (blockers)
2. Largest coverage improvement per effort
3. Cross-cutting gaps that affect multiple FRs

## Output

Write to: `docs/reviews/brd-coverage-{slug}-{YYYY-MM-DD}.md`

Derive `{slug}` from BRD filename (lowercase, hyphens, strip extension).

If `docs/reviews/` does not exist, create it.

## Quality Checklist

Before finalizing, verify:

```
[ ] Every FR in the BRD has a section in the traceability matrix
[ ] Every AC, BR under every FR has its own row
[ ] Every verdict has supporting evidence or "searched: [terms]"
[ ] PARTIAL verdicts explain what's implemented and what's missing
[ ] Gap list includes ALL non-DONE items
[ ] Gap sizes assigned to every gap
[ ] Scorecard arithmetic is correct
[ ] Verdict follows defined criteria
[ ] Small items NOT omitted
[ ] Project structure auto-detected (no hardcoded paths from other projects)
[ ] For full-stack projects: user-facing FRs have BOTH backend and frontend evidence (not just API routes)
[ ] Behavioral Completeness applied: every DONE user-facing FR has been checked for skeleton components
[ ] Form components have form fields proportional to their schema (not just imports and a button)
[ ] Multi-step workflows have substantive content in every step (not just navigation)
[ ] Data round-trip verified for CRUD features: form → API payload → DB write → DB read → API response → UI render
[ ] SKELETON gaps cataloged separately in the gap list (Category F) with P0 priority
```
