---
name: sanity-check
description: Post-fix sanity check after parallel review remediation. Validates builds, tests, cross-cutting regressions, and re-verifies critical findings from all four review domains (UI, quality, security, infra). Produces a consolidated pass/fail verdict.
argument-hint: "[scope]"
---

# Post-Fix Sanity Check Playbook

Run this skill **after** parallel fixes from `/ui-review`, `/quality-review`, `/security-review`, and `/infra-review` have been applied. It detects regressions, conflicts between fixes, and confirms that critical findings were actually resolved.

## Scoping

If the user specifies a scope (e.g., `/sanity-check apps/dopams-ui`), limit file-level checks to that target. Otherwise check the entire monorepo.

## Operating Rules

- Evidence-first: cite exact files, line numbers, and command output.
- Never state a check passed unless you executed it.
- If something cannot be verified (env limitation), mark `NOT_VERIFIED` with manual steps.
- Save final report to `docs/reviews/sanity-check-{YYYY-MM-DD}.md`.

### Customization

This playbook references project-specific app names, package names, and build scripts. When adapting for a different monorepo, update: (a) the package list in Phase 1 build commands, (b) app-specific paths in Phase 3 and Phase 4, (c) design system file references.

### Severity for Sanity-Check Discoveries

**Severity Definitions:**
- **P0: Build-blocking** — prevents compilation or startup
- **P1: Runtime-breaking** — app starts but feature fails (401, 500, crash)
- **P2: Degraded** — feature works but with visual/behavioral issues
- **P3: Cosmetic** — no functional impact, code quality issue

For NEW issues discovered during sanity checking (not re-verified from upstream):
- Merge conflicts: P0 (blocks build)
- Broken imports: P0 (blocks build)
- CSS specificity conflicts: P2 (degraded rendering)
- Duplicate imports: P3 (cleanup)

Re-verified findings retain their original severity from the source review. If a P1 finding from `/security-review` is confirmed still present, it remains P1.

## Phase 0: Pre-Check

Before running checks, gather context:

1. **Git state**: Run `git status` and `git diff --stat` to understand the scope of changes since the last clean state.
2. **Review reports**: Read the most recent review reports from `docs/reviews/` to identify:
   - All `P0` and `P1` findings from each review.
   - All `FAIL` and `PARTIAL` gate verdicts.
   - The specific files and lines cited in each finding.
3. **Conflict detection**: Check for merge markers, duplicate imports, or contradictory edits where two fixes touched the same file.

```bash
# Merge conflict markers
rg -n '<<<<<<<|=======|>>>>>>>' --glob '*.{ts,tsx,css,json,sql,md}'

# Duplicate imports — two-step approach to preserve file context:
# Step 1: List all import lines with file paths (file:line:import statement)
# Step 2: Sort by the import statement (field 3+) and find lines where the same file
#         imports the same module on multiple lines
rg -n "^import .* from" --glob '*.{ts,tsx}' | sort -t: -k1,1 -k3 | awk -F: 'prev_file==$1 && prev_import==$3 {print} {prev_file=$1; prev_import=$3}'
```

Produce a summary table:

| Review | Report File | P0 Count | P1 Count | FAIL Gates | Files Changed |
|--------|-------------|----------|----------|------------|---------------|

## Phase 1: Build Verification

Run all build commands. Every app and package must compile cleanly.

```bash
npm run build:all
```

If `build:all` is not available or fails, run individually in order:

```bash
npm run build:shared
npm run build:workflow-engine
npm run build:api-core
npm run build:api-integrations
# Also build packages/nl-assistant if present
npm run build:citizen
npm run build:officer
npm run build:dopams-ui
npm run build:forensic-ui
npm run build:social-media-ui
npm run build:api
npm run build:dopams
npm run build:forensic
npm run build:social-media
```

For each:
- Record: `PASS`, `FAIL`, or `SKIPPED`
- If `FAIL`: capture error summary and likely root cause

| Target | Status | Error Summary |
|--------|--------|---------------|

**Troubleshooting:** If `build:citizen` fails with `import.meta.env` errors, this is expected — use `vite build` instead (see CLAUDE.md). If a shared package build fails, check for circular deps with `npx madge --circular`.

**Gate: All builds must pass. Any build failure = FAIL verdict.**

**Next Step on Failure:** If a package build fails: check the build error, fix the source in the failing package, rebuild that package, then continue with downstream builds. Packages must be rebuilt in dependency order (shared -> workflow-engine -> api-core -> api-integrations -> apps).

## Phase 2: Test Verification

Run all available test suites:

```bash
npm run test:workflow-engine
npm run test:api
npm run test:dopams
npm run test:forensic
npm run test:social-media
npm run test:citizen:unit
```

For each:
- Record: `PASS`, `FAIL`, `SKIPPED`, or `NOT_AVAILABLE`
- If `FAIL`: capture failing test names and error summary

| Suite | Status | Failures | Notes |
|-------|--------|----------|-------|

**Troubleshooting:** Compare test results against the most recent review baseline to distinguish regressions from pre-existing failures.

**Gate: All existing tests must pass. New test failures introduced by fixes = FAIL verdict.**

**Next Step on Failure:** If tests fail: determine if the failure is a regression from the fix or a pre-existing issue. Only fix regressions. If pre-existing, note it in the report as `PRE-EXISTING` and do not count it against the verdict.

### Common Fixes

Common sanity-check failures and fixes:
- **Type error after fix**: check if the fix changed a function signature; update all callers
- **Test failure in unrelated module**: likely a shared import was modified; check package `dist/` freshness
- **CSS regression**: check specificity conflicts with `!important` overrides

## Phase 3: Cross-Cutting Regression Checks

These detect problems caused by parallel fixes stepping on each other.

### 3a. TypeScript / Import Health

```bash
# Check for broken imports across all UI apps
npx tsc --noEmit --project apps/citizen/tsconfig.json 2>&1 | tail -20
npx tsc --noEmit --project apps/officer/tsconfig.json 2>&1 | tail -20
npx tsc --noEmit --project apps/dopams-ui/tsconfig.json 2>&1 | tail -20
npx tsc --noEmit --project apps/forensic-ui/tsconfig.json 2>&1 | tail -20
npx tsc --noEmit --project apps/social-media-ui/tsconfig.json 2>&1 | tail -20
```

Note: Citizen app may have expected `import.meta.env` errors — use `vite build` as the authority, not raw `tsc`.

### 3b. CSS Integrity

```bash
# Check for !important overrides (potential specificity conflicts)
rg -n '!important' apps/*/src --glob '*.css' | head -20

# Check for orphaned/duplicate selectors
rg -n '^\.' apps/*/src --glob '*.css' | sort -t: -k3 | uniq -d -f2 | head -20

# Verify design-system.css consistency across apps
md5 apps/*/src/design-system.css 2>/dev/null
```

### 3c. Shared Package Contract

Verify that changes to `packages/shared/src/ui.tsx` or `packages/shared/src/form-renderer.tsx` didn't break consumers:
- Check all apps that import from `@puda/shared` still build
- Check that exported component signatures haven't changed in breaking ways

### 3d. Migration Consistency

If any SQL migrations were added or modified:
```bash
# Check migration file numbering is sequential and non-conflicting
ls apps/*/migrations/*.sql | sort

# Verify shared migrations exist
ls packages/api-core/src/migrations/shared/ 2>/dev/null
```

### 3e. Package.json / Lock File

```bash
# Ensure lock file is consistent
npm ls --depth=0 2>&1 | grep -i 'ERR\|WARN\|missing\|invalid'
```

## Phase 4: Re-Verify Critical Review Findings

For each review domain, re-run the specific verification commands that correspond to `P0` and `FAIL`-gate findings.

### 4a. UI Review Re-Checks

```bash
# Bilingual anti-pattern (citizen app)
rg -n 'label=\{t\(' apps/citizen/src --glob '*.tsx'

# 100vh usage (should be zero)
rg -n '\b100vh\b' apps/*/src --glob '*.css'

# Hardcoded px breakpoints (should be zero)
# Note: This pattern matches `@media` rules containing `px` values. It may also match
# px values in properties inside media query blocks, not just breakpoint declarations.
# Manually verify each match targets the breakpoint value (e.g., `max-width: 768px`).
rg -n '@media[^{]*[0-9]+px' apps/*/src --glob '*.css'

# Hover without active (touch parity)
# Compare :hover count vs :active count — large gap = problem
rg -c ':hover' apps/*/src --glob '*.css'
rg -c ':active' apps/*/src --glob '*.css'

# aria-live regions for async feedback
rg -n 'aria-live' apps/*/src --glob '*.tsx'

# Skip links present
rg -n 'skip-link|skip.*main' apps/*/src --glob '*.tsx'
```

**Remediation if checks fail:**
- `label={t(` matches: Replace `label={t("key")}` with `label={<Bilingual tKey="key" />}`
- `100vh` matches: Replace `100vh` with `100dvh`
- Hardcoded px breakpoints: Replace with design token rem values (`48rem`, `80rem`, `22.5rem`)
- Hardcoded colors: Replace with `var(--color-*)` design token

### 4b. Quality Review Re-Checks

```bash
# Hardcoded API URLs (should use env vars)
rg -n 'http://localhost|http://127\.0\.0\.1' apps/*/src --glob '*.{ts,tsx}'

# Console.log left in production code
rg -n 'console\.log' apps/*/src --glob '*.{ts,tsx}' | grep -v test | grep -v __tests__

# Unused exports from shared package
# Any TODO/FIXME/HACK markers
rg -n 'TODO|FIXME|HACK|XXX' apps/*/src --glob '*.{ts,tsx}' | head -30
```

**Remediation if checks fail:**
- Hardcoded URLs: Replace with `import.meta.env.VITE_API_URL` (frontend) or `process.env.API_URL` (backend)
- `console.log`: Remove or replace with structured logger (`request.log` for Fastify, remove entirely for frontend)
- TODO/FIXME in changed files: Resolve the TODO or convert to a tracked issue with an ID (e.g., `// TODO(ISSUE-123): ...`)

### 4c. Security Review Re-Checks

```bash
# SQL injection vectors (string concatenation in queries)
rg -n '\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)|(SELECT|INSERT|UPDATE|DELETE|WHERE).*\$\{' apps/*/src --glob '*.ts'

# Secrets in code
rg -ni 'password\s*=\s*["\x27]|api_key\s*=\s*["\x27]|secret\s*=\s*["\x27]' apps/*/src --glob '*.{ts,tsx}'

# Missing auth middleware on routes
rg -n '\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(' apps/*/src/routes --glob '*.ts' | head -30

# .env files not in .gitignore
cat .gitignore | grep -i env
ls apps/*/.env 2>/dev/null
```

**Remediation if checks fail:**
- SQL injection: Convert string concatenation to parameterized query using `$1`, `$2` placeholders (e.g., `pool.query('SELECT * FROM t WHERE id = $1', [id])`)
- Secrets in code: Move to environment variables loaded via `process.env`; add the secret name to `.env.example` without the value
- Missing auth on routes: Verify the route is intentionally public (in `PUBLIC_ROUTES` list or under `/public/` prefix) or add `requireAuth` middleware to the route registration
- `.env` files tracked by git: Add `.env` and `.env.*` (except `.env.example`) to `.gitignore` and remove from tracking with `git rm --cached`

### 4d. Infra Review Re-Checks

```bash
# Dockerfile health
ls Dockerfile.* docker-compose.yml

# Health check endpoints
rg -n 'health|readiness|liveness' apps/*/src --glob '*.ts'

# Environment variable validation at startup
rg -n 'process\.env\.' apps/*/src --glob '*.ts' | head -20

# Docker compose service dependencies
grep -A2 'depends_on' docker-compose.yml
```

**Remediation if checks fail:**
- Missing health endpoint: Add a `GET /health` route returning `{ status: "ok" }` with DB connectivity check
- Missing env validation: Add startup validation using Zod schema or manual checks that throw on missing required vars
- Missing `depends_on`: Add service dependency declarations in `docker-compose.yml` to ensure correct startup order

For each re-check, record:

| Domain | Check | Expected | Actual | Status |
|--------|-------|----------|--------|--------|

## Phase 5: Lint and Format

```bash
# Discover available lint/format scripts
cat package.json | python3 -c "import json,sys; scripts=json.load(sys.stdin).get('scripts',{}); [print(f'  {k}: {v}') for k,v in scripts.items() if 'lint' in k.lower() or 'format' in k.lower()]"

# Then run discovered scripts, e.g.:
npm run lint 2>&1 | tail -20
npm run format:check 2>&1 | tail -20
```

Record results. Lint errors introduced by fixes are regressions.

## Phase 6: Frontend Budget Check

```bash
npm run check:frontend-budgets 2>&1
```

If bundle sizes grew beyond thresholds, flag as a regression.

## Phase 7: Verdict

### Gate Scorecard

PARTIAL = All findings addressed (fixed or acknowledged with documented justification) but not all fully resolved.

| Gate | Status | Notes |
|------|--------|-------|
| All packages build | PASS / FAIL | |
| All UI apps build | PASS / FAIL | |
| All API apps build | PASS / FAIL | |
| All tests pass | PASS / FAIL | |
| No merge conflicts | PASS / FAIL | |
| No broken imports | PASS / FAIL | |
| No cross-fix regressions | PASS / FAIL | |
| UI P0 findings resolved | PASS / PARTIAL / FAIL | |
| Quality P0 findings resolved | PASS / PARTIAL / FAIL | |
| Security P0 findings resolved | PASS / PARTIAL / FAIL | |
| Infra P0 findings resolved | PASS / PARTIAL / FAIL | |
| Lint clean | PASS / PARTIAL / FAIL | |
| Bundle budgets met | PASS / PARTIAL / FAIL | |

### Verdict Block

```text
Builds:             [ALL PASS | X FAIL]
Tests:              [ALL PASS | X FAIL]
Cross-Fix Conflicts: [NONE | X FOUND]
P0 Resolution:      UI [X/Y] | Quality [X/Y] | Security [X/Y] | Infra [X/Y]
Regressions:        [NONE | X FOUND]
Final Verdict:      [CLEAN | CONDITIONAL | BLOCKED]
```

Verdict definitions:
- **CLEAN**: All gates pass, all P0s resolved, no regressions. Ready for next step.
- **CONDITIONAL**: Builds and tests pass, but some P0s still open or minor regressions exist. List conditions.
- **BLOCKED**: Build or test failures, merge conflicts, or critical regressions. Must fix before proceeding.

## Phase 8: Remaining Work Summary

If verdict is not `CLEAN`, produce:

| ID | Issue | Origin Review | Severity | Status | Next Step |
|----|-------|---------------|----------|--------|-----------|

Group by:
1. **Blockers** (must fix now)
2. **Conditions** (fix before release)
3. **Deferred** (tracked but not blocking)

## Output

Save the full report to `docs/reviews/sanity-check-{YYYY-MM-DD}.md` with these sections:

1. Pre-Check Summary
2. Build Results
3. Test Results
4. Cross-Cutting Regression Analysis
5. Review Finding Re-Verification
6. Lint and Format
7. Bundle Budget
8. Gate Scorecard and Verdict
9. Remaining Work (if not CLEAN)
