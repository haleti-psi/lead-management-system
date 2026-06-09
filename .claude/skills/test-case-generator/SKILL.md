---
name: test-case-generator
description: "Generate comprehensive functional, data integrity, and UI/E2E test cases from a Business Requirements Document (BRD). Use this skill whenever a user uploads a BRD, PRD, requirements document, functional specification, or software spec and asks to create test cases, test plan, test scenarios, QA test suite, acceptance tests, Playwright tests, UI tests, end-to-end tests, or says things like 'generate tests from this BRD', 'create test cases for these requirements', 'write QA tests', 'build a test plan from this spec', 'what tests should I run for this app', 'create functional tests from this document', or 'generate Playwright tests from these requirements'. Also trigger when someone shares a requirements document and asks about testing, validation, quality assurance, or data integrity verification. The output is a professionally formatted .docx file containing traceable, executable test cases covering every functional requirement, its acceptance criteria, boundary conditions, edge cases, data integrity invariants, and UI flows runnable by Playwright (or equivalent — Cypress, WebdriverIO, Selenium)."
---

# Test Case Generator Skill

## Purpose

Transform a Business Requirements Document (BRD) into a comprehensive set of test cases delivered as a professionally formatted .docx file. The skill produces three complementary pillars of coverage:

1. **Business logic tests** — Happy paths, negative paths, boundary conditions, workflow state transitions, permission rules, and cross-feature integration that verify the system behaves per the BRD's acceptance criteria.
2. **Data integrity tests** — Referential integrity, uniqueness constraints, transactional atomicity, concurrent-update safety, audit trail completeness, numeric precision, and migration safety that verify the database always remains in a lawful, consistent state.
3. **UI / End-to-end tests** — Browser-executable test cases (Playwright by default; compatible with Cypress, WebdriverIO, Selenium) that verify rendered behavior, form interactions, responsive layouts, accessibility, error/empty/loading states, and complete user journeys.

Every test case must be traceable to a specific requirement in the BRD, and the complete set must cover all happy paths, error paths, boundary conditions, edge cases, data invariants, and UI flows — so that a QA team (or an AI tester) could execute them without referring back to the BRD.

## Why Traceability and Completeness Matter

A test suite is only useful if it covers every requirement and every test can be traced back to why it exists. If a test fails, the team needs to know which requirement is affected. If a requirement has no tests, it's effectively unverified. This skill ensures zero-gap coverage: every FR in the BRD gets at least one happy-path test, one error/negative test, and boundary tests where applicable.

## Process

### Step 1: Extract the BRD Content

Read the uploaded BRD file. If it's a .docx file, extract its text content using pandoc or python-docx. Parse the document to identify:

- **Functional Requirements (FRs)**: Every numbered requirement (FR-001, FR-002, etc.)
- **Acceptance Criteria**: The testable conditions listed under each FR
- **Business Rules**: Specific logic rules (thresholds, calculations, conditions)
- **Workflow State Transitions**: Every state change and its triggers from state diagrams
- **Data Validation Rules**: Field types, formats, min/max values, required fields from the data model
- **Permissions/Authorization Rules**: What each role can and cannot do from the permissions matrix
- **Notification Triggers**: Every event that should fire a notification
- **Error Messages**: Specific error text mentioned in the BRD

Build a mental inventory: count the FRs, count the acceptance criteria, count the state transitions, count the permission rules. This inventory is your coverage target.

### Step 2: Generate Test Cases

For each FR in the BRD, generate test cases in the following categories:

#### Category 1: Happy Path Tests
For each FR, create at least one test that verifies the primary success scenario — the user does the right thing and gets the expected result. Base these directly on the acceptance criteria.

**Minimum coverage rule**: Every FR must have at least 2 test cases — one happy path and one negative, boundary, or edge case. No exceptions, including read-only features like dashboards, reports, and list views. Read-only features have their own edge cases: empty state (no data), filter returns zero results, large dataset pagination, drill-down on a metric shows correct detail.

#### Category 2: Negative / Error Tests
For each FR that involves user input, form submission, or state change, create tests that verify the system handles invalid input correctly:
- Required fields left blank
- Values exceeding maximum limits
- Values below minimum limits
- Invalid formats (wrong email format, wrong date format)
- Unauthorized actions (wrong role attempting an action)
- Actions in wrong states (trying to edit a submitted claim, trying to delete a non-draft item)

For read-only / dashboard FRs, negative tests include:
- Dashboard with zero data (new system, no records yet)
- Filter that matches no records (verify "no results" state, not a crash)
- Drill-down on an aggregated metric to verify the detail matches the summary
- Large dataset behavior (does pagination work correctly with 500+ records?)

#### Category 3: Boundary Tests
For every numeric threshold, limit, or range in the BRD, create tests at:
- Exactly at the boundary value
- One unit below the boundary
- One unit above the boundary

For example, if the BRD says "claims above 5000 INR require L2 approval", generate tests for 4999, 5000, and 5001.

#### Category 4: Workflow State Tests
For every state transition in the BRD's workflow/state diagrams, create a test that:
- Starts in the "from" state
- Performs the triggering action
- Verifies the entity moves to the correct "to" state
- Verifies all side effects fire (notifications sent, related records updated, etc.)

Also create tests for invalid transitions — actions that should NOT be possible in a given state.

#### Category 5: Permission / Authorization Tests
For each row in the permissions matrix, create:
- A positive test (authorized role performs the action successfully)
- A negative test (unauthorized role is blocked from the action)

#### Category 6: Cross-Feature Integration Tests
Create tests that span multiple FRs — verifying that features work together end-to-end. These typically follow a user journey: create → submit → approve → process → complete.

#### Category 7: UI / End-to-End Tests (Playwright)

For every user-facing screen, form, modal, and critical user journey in the BRD, create UI test cases executable by Playwright (or equivalent: Cypress, WebdriverIO, Selenium). These complement the functional categories above by verifying actual rendered behavior in a real browser.

A UI test is mandatory whenever the BRD specifies:
- A page, screen, view, or route
- A form with client-side validation
- A modal, dialog, drawer, bottom sheet, or toast
- A navigation flow (login → dashboard → entity create)
- A list/table with filtering, sorting, or pagination
- A responsive layout requirement (mobile-first, breakpoints, safe-area insets)
- An accessibility requirement (WCAG, keyboard navigation, screen reader)
- An i18n/localization requirement (multi-language switching)

UI test cases MUST specify these additional fields beyond the base structure:

| UI Field | Description | Example |
|----------|-------------|---------|
| **Tool** | The intended runner | Playwright (Chromium + WebKit) |
| **Route / URL** | The path under test | `/citizen/applications/new` |
| **Selector Strategy** | Preferred selectors in order | `data-testid` → `getByRole(name)` → text. Avoid CSS classes and XPath. |
| **Locators** | The actual locators each step uses | `page.getByTestId('claim-amount')`, `page.getByRole('button', { name: 'Submit' })` |
| **Browser Matrix** | Browsers to run on | Critical paths: Chromium + Firefox + WebKit. Standard: Chromium. |
| **Viewport** | Screen dimensions | Desktop `1280x800`, tablet `768x1024`, mobile `375x667`. Mobile required for any responsive FR. |
| **Auth State** | How the test authenticates | `storageState: 'auth/citizen.json'`, programmatic login via `/api/v1/auth/login`, or none |
| **Network Expectations** | API responses the test waits for to avoid flakiness | `await page.waitForResponse(r => r.url().includes('/api/v1/applications') && r.status() === 201)` |
| **Visual Assertions** | Specific assertions on rendered elements | `await expect(page.getByRole('alert')).toContainText('Application submitted')` |
| **A11y Check** | Required for any page with a WCAG requirement | Run `@axe-core/playwright` scan; assert zero serious/critical violations |
| **Trace / Video** | Capture policy for debugging | `trace: 'retain-on-failure'`, `video: 'retain-on-failure'` |

UI tests cover these flow types — at least one test per type for each in-scope screen:
- **Page load** — Page renders without console errors, key elements present, no layout shift, document title correct
- **Form interaction** — Real keyboard input, dropdown selection, file upload; validation messages on blur and on submit; submit button enabled/disabled state matches validity
- **Error states** — Server returns 4xx/5xx → user-facing error visible, retry available where applicable, no silent failures
- **Loading states** — Skeleton/spinner shown during fetch, replaced by content when resolved, no flicker
- **Empty states** — List/dashboard with no data shows the right CTA and explanatory copy
- **Responsive** — Mobile viewport renders without horizontal scroll, touch targets ≥ 44px, drawer/hamburger works on mobile, safe-area insets respected on fixed/sticky elements
- **i18n** (where applicable) — Switching language updates all visible text on the screen
- **Keyboard navigation** — Tab order matches visual order, focus visible, Escape closes modals, Enter submits forms
- **Network resilience** — Offline banner shown when offline, retry on 5xx, idempotency under double-click (no duplicate submissions)
- **Full user journey** — Login → core action → confirmation, end-to-end with real API and DB writes (or mocked at well-defined seam)

#### Category 8: Data Integrity Tests

For every database write, state mutation, cross-record relationship, and persisted invariant in the BRD, create data integrity test cases that verify the database remains in a consistent, lawful state under normal and adversarial conditions.

Data integrity tests cover:
- **Referential integrity** — Foreign-key relationships hold. Deleting or updating a parent enforces the configured behavior (CASCADE, RESTRICT, SET NULL). Orphaned children must not exist after any operation.
- **Uniqueness constraints** — Business identifiers (ARN, application number, mobile + service combination) cannot be duplicated. Race condition: two concurrent inserts of the same key — exactly one must fail with a unique-violation error.
- **Transactional atomicity** — Multi-step writes either fully commit or fully roll back. Inject a failure between writes and verify no partial state persists (e.g., payment row inserted but application status not updated → both roll back).
- **Optimistic locking / concurrent updates** — Two users updating the same record — the version check (or `updated_at` comparison) prevents lost updates; the second writer is rejected or merged per the BRD.
- **Audit trail completeness** — Every mutation writes an audit row with actor, action, timestamp, and before/after snapshot. Test: perform an action, then assert the audit row exists with correct fields.
- **Soft-delete behavior** — Soft-deleted records are excluded from default queries, recoverable on demand, and FKs from active records to soft-deleted parents are blocked.
- **Numeric precision** — Money fields use `DECIMAL`/`NUMERIC`, not `FLOAT`. Test: sum many small amounts and assert no drift; verify rounding policy matches BRD (banker's rounding vs round-half-up).
- **Date / timezone integrity** — Timestamps stored in UTC, rendered in user TZ. Test: write a record at a TZ boundary (e.g., 23:59 IST) and verify rendered date is correct in both source and target TZ.
- **Migration safety** (when the BRD includes a schema change) — Forward migration on prod-like seed data with no data loss, no constraint violations; backward compatibility for the rolling-deploy window where required.
- **Default values & nullability** — New columns get the correct default for existing rows; NOT NULL constraints enforced on new writes; nullable columns accept NULL where intended.
- **Workflow state consistency** — An entity's state column matches the latest workflow_history row; no entity can be in an undefined state; state transitions are append-only in history.
- **Idempotency keys** — Repeated requests with the same idempotency key produce the same result without duplicate side effects (relevant for payments, notifications, document issuance).

Each data integrity test specifies these additional fields beyond the base structure:

| Data Integrity Field | Description | Example |
|----------------------|-------------|---------|
| **Setup SQL / Fixture** | Rows required before the test runs | `INSERT INTO application (id, citizen_id, status) VALUES (...)` |
| **Action** | API call, SQL command, or scripted scenario that exercises the invariant | `POST /api/v1/applications/{id}/submit` ×2 concurrently |
| **Invariant Query** | SQL that proves the invariant holds (must return 0 rows for violations) | `SELECT COUNT(*) FROM application WHERE status NOT IN ('draft','submitted','approved','rejected')` → expect `0` |
| **Cleanup** | How to restore the database after the test | `DELETE FROM application WHERE id = 'TEST-...'` or transactional rollback |

### Step 3: Structure Each Test Case

Every test case MUST contain ALL of the following fields. Do not skip any field.

| Field | Description | Example |
|-------|-------------|---------|
| **Test ID** | Unique identifier: TC-[FR]-[Seq] | TC-FR001-01 |
| **Test Name** | Short descriptive name | Verify employee can create expense claim with valid data |
| **Category** | One of: Happy Path, Negative, Boundary, Workflow, Permission, Integration | Happy Path |
| **Linked FR** | The FR number(s) this test verifies | FR-001 |
| **Priority** | Critical, High, Medium, Low | Critical |
| **Preconditions** | What must be true before the test starts | Employee is logged in. No draft claims exist. |
| **Test Steps** | Numbered step-by-step actions to perform | 1. Navigate to "New Claim" page. 2. Enter title "Mumbai trip". 3. Select date range... |
| **Test Data** | Specific input values to use | Title: "Mumbai client visit", Amount: 8500.00, Category: Travel |
| **Expected Result** | What should happen — specific and verifiable | Claim is created with status "draft". Claim number format is EXP-YYYYMM-NNNNN. Total amount shows 8500.00. |
| **Postconditions** | System state after the test | One draft claim exists in the employee's "My Claims" list. |

**Test step quality matters**: Steps must be specific enough that someone unfamiliar with the system can follow them. "Fill in the form" is bad. "Enter 'Mumbai client visit' in the Title field. Select 'Travel' from the Category dropdown. Enter 8500.00 in the Amount field." is good.

**Expected results must be verifiable**: "System works correctly" is bad. "Claim status changes to 'pending_l1'. Manager receives in-app notification with text containing the claim number and amount." is good.

### Step 4: Organize and Number

Organize test cases grouped by FR (or feature module). Within each group, order by: Happy Path first, then Negative, then Boundary, then Workflow, then Permission, then Integration, then UI/E2E, then Data Integrity.

Number test cases as: TC-FR[NNN]-[SEQ]. Example: TC-FR004-03 is the 3rd test case for FR-004. For UI tests use the `UI` infix (e.g. `TC-FR004-UI-01`); for data integrity tests use the `DI` infix (e.g. `TC-FR004-DI-01`). This makes runner-specific subsets trivially filterable.

### Step 5: Generate Summary Metrics

At the top of the document, include a Test Coverage Summary table:

| Metric | Value |
|--------|-------|
| Total Test Cases | [count] |
| FRs Covered | [count] / [total FRs in BRD] |
| Happy Path Tests | [count] |
| Negative/Error Tests | [count] |
| Boundary Tests | [count] |
| Workflow State Tests | [count] |
| Permission Tests | [count] |
| Integration Tests | [count] |
| UI / E2E Tests (Playwright) | [count] |
| Data Integrity Tests | [count] |
| Critical Priority | [count] |
| High Priority | [count] |
| Medium Priority | [count] |
| Low Priority | [count] |

Also include a **Traceability Matrix**: a table mapping every FR to its test case IDs (split into Functional / UI / Data Integrity columns), confirming zero-gap coverage across all three pillars.

### Step 6: Create the .docx File

Read the docx skill at `/mnt/skills/public/docx/SKILL.md` and follow its instructions to create a professionally formatted Word document with:

- Title page with document name, project name, version, and date
- Table of contents
- Test Coverage Summary section
- Traceability Matrix section  
- Test cases organized by feature module with proper heading hierarchy
- Each test case as a formatted table (one table per test case is clearest)
- Consistent formatting: Arial font, professional color scheme, shaded table headers
- Page numbers in footer, document title in header

## Quality Checklist

Before finalizing, verify against these criteria:

1. **Zero-gap coverage**: Does every FR in the BRD have at least one test case? Check the traceability matrix — no FR should have zero tests.
2. **Minimum 2 tests per FR**: Every FR must have at least 2 test cases. If any FR has only 1, add a negative, boundary, or edge case test. For dashboard/list FRs, add an empty-state or zero-results test.
3. **Acceptance criteria coverage**: For each FR, does every acceptance criterion have at least one test that directly verifies it?
3. **Boundary tests exist**: For every numeric threshold in the BRD (approval limits, file sizes, character limits, date ranges), are there boundary tests at the exact boundary, one below, and one above?
4. **Negative tests exist**: For every form/input in the BRD, are there tests for blank required fields, invalid formats, and values exceeding limits?
5. **Permission tests exist**: For each critical action in the permissions matrix, is there at least one positive and one negative permission test?
6. **Workflow coverage**: For every state transition in the BRD's state diagrams, is there a test verifying the transition and its side effects?
7. **Invalid state transitions**: Are there tests attempting actions that should be blocked in certain states?
8. **Test data is specific**: Does every test case have concrete test data values (not "enter valid data" but "enter 'Rahul Verma' in the Name field")?
9. **Expected results are verifiable**: Does every expected result describe something concrete that can be checked (status value, message text, UI element state)?
10. **Integration tests span the full journey**: Is there at least one end-to-end test that follows the complete workflow from creation to final state?
11. **UI coverage per screen**: Does every user-facing screen, form, and modal in the BRD have at least one Playwright (or equivalent) test covering page load, form interaction, error state, empty state, and responsive layout? For pages with a WCAG requirement, is there an axe-core a11y check?
12. **UI selectors are stable**: Do UI tests prefer `data-testid` or `getByRole(name)` selectors? CSS class and XPath selectors are flaky and must be flagged if used.
13. **Data integrity invariants are covered**: For every database write in the BRD, is there at least one data integrity test? Are referential integrity, uniqueness constraints, transactional atomicity, audit trail, and concurrent-update safety each represented by at least one test where the BRD's data model implies them?
14. **Invariant queries are concrete**: Does every data integrity test specify a SQL invariant query that can be run independently to assert zero violations?

## Common Pitfalls to Avoid

- **Generic test data**: Never write "enter valid email" — write "enter rahul.verma@company.com". Specific test data catches format assumptions that vague data misses.
- **Vague expected results**: Never write "system handles the error" — write "error message appears: 'File size must be under 5MB.' Claim is not submitted. Status remains 'draft.'"
- **Missing negative tests**: For every form field with validation rules, there must be a test that enters invalid data and verifies the correct error message.
- **Forgetting side effects**: Approval tests must verify not just the status change but also: notifications sent, related records updated, timestamps set, and any blocking/unblocking behavior.
- **Skipping edge cases at boundaries**: If the limit is 5000, testing only 100 and 10000 misses the boundary. Always test at 4999, 5000, and 5001.
- **No unauthorized access tests**: Every action restricted by role should have a test where the wrong role attempts it and is denied.
- **Brittle UI selectors**: Don't use `.css-1a2b3c4d` or `#root > div > div:nth-child(2)`. Prefer `getByTestId('submit-claim')` or `getByRole('button', { name: 'Submit' })`. If the codebase doesn't expose `data-testid` yet, write the test against `getByRole(name)` and flag the missing testid as a follow-up.
- **UI tests without network waits**: Never assert immediately after `click()` on a button that triggers an API call. Always `await page.waitForResponse(...)` (or `await expect(...).toBeVisible({ timeout: ... })` on a server-driven element) before asserting — otherwise the test is flaky.
- **UI tests with hardcoded sleeps**: Never write `await page.waitForTimeout(2000)`. Wait for network responses, element visibility, or URL changes instead.
- **Skipping mobile viewport**: For any responsive FR, run the UI test at mobile viewport (375x667) too. Bugs hiding behind the desktop breakpoint must be caught.
- **Data integrity tests without an invariant query**: A data integrity test that only checks the API response is a functional test in disguise. The defining trait of a data integrity test is a SQL query (or equivalent) that asserts the database state directly.
- **Missing concurrency tests**: For any endpoint that mutates state with a uniqueness constraint or that two users could call simultaneously (submit application, claim payment, request OTP), there must be a concurrency test that fires N parallel requests and asserts exactly the right number succeed.
- **Forgetting audit rows**: For every mutation tracked in an audit table per the BRD, the data integrity test must assert the audit row was written with the correct actor, action, timestamp, and snapshot. Missing audit rows are silent compliance failures.
