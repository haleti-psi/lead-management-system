---
name: full-review
description: Run vibe-coding-guardrails, coding-standards-review, five domain review skills (UI, quality, security, infra, BRD coverage), then sanity-check, then fix all issues found until every finding is resolved. Produces a consolidated report with an aggregate verdict.
argument-hint: "[target] [options]"
user_invocable: true
---

# Full Review Playbook

Run a comprehensive review cycle: fast guardrails pre-check, coding standards compliance scan, five domain reviews (UI, quality, security, infra, BRD coverage), cross-domain sanity-check, remediation, and re-verification.

## Scoping

If the user specifies a target (example: `/full-review social-media-api`), pass that scope to each review skill. Otherwise review the entire project.

Generate a safe output slug from the target: replace `/` with `-`, remove spaces. Example: `apps/dopams-ui` becomes `apps-dopams-ui`. If no target, use `full-repo`.

Options the user may append:
- `critical-only` -- only fix CRITICAL findings
- `high+` -- fix HIGH and CRITICAL findings (default)
- `all` -- fix all findings including LOW and MEDIUM
- `no-fix` -- produce reports only, skip remediation
- `no-commit` -- fix but do not commit

## Conditional Skip Logic

Before launching reviews, inspect the target to determine which reviews apply:

- If the target is a backend API app (no `src/*.tsx` files), skip `/ui-review`. Check with: `ls {target}/src/*.tsx 2>/dev/null | head -1`.
- If the target is a frontend-only app (no database migrations, no API routes), skip `/infra-review` database and migration phases.
- If no BRD document exists for the target, skip `/brd-coverage`. Check with: `ls docs/brd*.md docs/BRD*.md docs/requirements*.md 2>/dev/null | head -1`.
- All five reviews run by default for full-repo scope.

### Skip Logic Details

| Review | Skip Condition | Check Command |
|--------|---------------|---------------|
| Vibe-coding guardrails | No uncommitted changes in target | `git diff --name-only HEAD -- {target} \| head -1` |
| Coding standards review | Never skip -- always applicable | -- |
| UI review | No .tsx/.jsx files in target | `ls {target}/src/**/*.tsx 2>/dev/null \| head -1` |
| Infra review | No Dockerfile and no CI config | `ls {target}/Dockerfile docker-compose*.yml .github/workflows/*.yml 2>/dev/null \| head -1` |
| Quality review | Never skip -- always applicable | -- |
| Security review | Never skip -- always applicable | -- |
| BRD coverage | No BRD/requirements document found | `ls docs/brd*.md docs/BRD*.md docs/requirements*.md 2>/dev/null \| head -1` |

## Severity Mapping

Sub-reviews use P0-P3 severity. The full review maps these to consolidated labels:

| Full Review Label | Sub-Review Level | Definition |
|---|---|---|
| CRITICAL | P0 | Data loss, security breach, system failure |
| HIGH | P1 | Fix this sprint |
| MEDIUM | P2 | Fix next sprint |
| LOW | P3 | Hardening/cleanup |

When aggregating findings across reviews, always use the full-review labels (CRITICAL/HIGH/MEDIUM/LOW) in the consolidated report.

## Verdict Aggregation

Each sub-review produces its own verdict. The full review aggregates them:

| Sub-Review | Verdict Options |
|---|---|
| Guardrails | CLEAN / WARN / BLOCKED |
| Coding Standards | COMPLIANT / NEEDS-WORK / NON-COMPLIANT |
| UI | GO / NO-GO |
| Quality | SOLID / NEEDS-WORK / AT-RISK |
| Security | SECURE / AT-RISK / CRITICAL |
| Infra | READY / CONDITIONAL / NOT-READY |
| BRD Coverage | COMPLIANT / PARTIAL / NON-COMPLIANT |
| Sanity | CLEAN / CONDITIONAL / BLOCKED |

Final verdict rules:

- **PASS**: All sub-verdicts are positive (CLEAN, GO, SOLID, SECURE, READY) OR have only non-blocking conditions, AND no skeleton components detected.
- **CONDITIONAL**: Any sub-verdict has conditions but no blockers (e.g., Guardrails is WARN, Quality is NEEDS-WORK, Infra is CONDITIONAL, Sanity is CONDITIONAL).
- **FAIL**: Any sub-verdict is BLOCKED (guardrails), NON-COMPLIANT (coding standards or BRD coverage), NO-GO, AT-RISK (quality or security), CRITICAL, NOT-READY, or BLOCKED (sanity). **Also FAIL if any skeleton/stub components are detected** — components that import hooks or declare forms but contain no substantive form fields, data rendering, or API calls are P0 blockers regardless of other verdicts.

## Conflict Resolution Priority

When sub-reviews recommend contradictory fixes (e.g., security wants to remove a feature, UI wants to enhance it), resolve conflicts in this priority order:

```
Security > Data Integrity > Build Health > Accessibility > UI/UX > Performance
```

Higher-priority domains override lower-priority domains. Log the conflict and resolution in the report.

## Deduplication

If findings from multiple reviews reference the same `file:line`, merge them into a single finding with:
- The **highest** severity across the duplicates.
- Combined impact statements from each domain.
- A single unified fix that addresses all concerns.

Tag the merged finding with its source domains (e.g., `[Security + Quality]`).

---

## Phase 1: Guardrails Pre-Check

Run `/vibe-coding-guardrails {target}` first. This is a fast (< 60 seconds) pattern-matching scan that catches convention violations (wrong i18n patterns, CSS issues, missing button types, hardcoded spacing, `any` types, etc.) before the heavier domain reviews begin.

- Skip if there are no uncommitted changes in the target directory.
- If guardrails returns **BLOCKED** (P0 findings), fix all P0s immediately before proceeding to domain reviews. This prevents domain reviews from wasting time on issues guardrails already caught.
- If guardrails returns **WARN** (P1 findings only), note them and continue -- they will be fixed during Phase 4 remediation alongside domain review findings.
- If guardrails returns **CLEAN**, proceed directly to domain reviews.

Guardrails findings use the same P0-P3 severity scale and are included in the consolidated finding table alongside domain review findings. Apply the same severity mapping (P0→CRITICAL, P1→HIGH, etc.) and deduplication rules -- if a guardrails finding overlaps with a domain review finding at the same `file:line`, merge them and tag as `[Guardrails + {Domain}]`.

## Phase 2: Coding Standards Compliance

Run `/coding-standards-review {target}` to scan against the project's 107-check coding standards matrix. This covers cross-cutting concerns (type safety, SQL patterns, accessibility patterns, dark mode, data tables, forms, etc.) that individual domain reviews may not check systematically.

- If coding standards returns **NON-COMPLIANT** (any P0 or 5+ P1 violations), fix all P0s and critical P1s immediately before proceeding to domain reviews. This prevents domain reviews from re-flagging the same issues.
- If coding standards returns **NEEDS-WORK** (< 5 P1, no P0), note findings and continue -- they will be fixed during Phase 5 remediation.
- If coding standards returns **COMPLIANT**, proceed directly.

Coding standards findings use the same P0-P3 severity scale and are included in the consolidated finding table. Apply the same deduplication rules -- if a coding standards finding overlaps with a domain review finding at the same `file:line`, merge them and tag as `[Standards + {Domain}]`.

## Phase 3: Domain Reviews

Execute each sub-review by invoking the corresponding skill (`/ui-review {target}`, `/quality-review {target}`, etc.). Run them sequentially -- each review must complete before starting the next. Collect all output reports before proceeding to Phase 4.

1. `/ui-review {target}` (skip if target has no `.tsx` files -- see Conditional Skip Logic)
2. `/quality-review {target}`
3. `/security-review {target}`
4. `/infra-review {target}`
5. `/brd-coverage {target}` (skip if no BRD/requirements document found -- see Conditional Skip Logic)

After all reviews complete, collect findings from each report. Apply the severity mapping to normalize P0/P1/P2/P3 labels to CRITICAL/HIGH/MEDIUM/LOW.

### Phase 3.1: Component Substance Cross-Check (P0 Gate)

After domain reviews complete, consolidate skeleton/stub findings from all sub-reviews into a single Component Substance table. This is a **blocking gate** — any skeleton component is an automatic CRITICAL finding.

Sources to check:
- **Guardrails** Phase 9: Skeleton Component Detection (mutation hooks without form inputs, query hooks without data rendering, empty wizard steps)
- **UI Review** Phase 1 substance inventory + FM-10 through FM-13 (form completeness, onSubmit calls API, payload includes all fields, wizard steps have content)
- **Quality Review** Phase 2E skeleton detection + Phase 2F data round-trip verification
- **BRD Coverage** Behavioral Completeness section (form substance check, data display substance check, multi-step workflow check)

Consolidate into:

```text
=== COMPONENT SUBSTANCE CHECK ===

| Component | File | Hook Imports | Form Inputs | API Calls | Data Renders | Verdict |
|-----------|------|-------------|-------------|-----------|-------------|---------|
| ExampleForm | src/components/ExampleForm.tsx | useMutation | 8 | 1 POST | N/A | OK |
| ExampleList | src/components/ExampleList.tsx | useQuery | N/A | N/A | 12 fields | OK |
| BrokenForm | src/components/BrokenForm.tsx | useMutation | 0 | 0 | N/A | SKELETON |

Skeleton Components Found: N
Verdict: [PASS (0 skeletons) | FAIL (N skeletons — list all)]
```

**If any SKELETON components are found**: They become CRITICAL findings in the consolidated table and must be fixed in Phase 5 before any other remediation. A skeleton component means the feature was never actually built — it only has scaffolding.

## Phase 4: Sanity Check

Run `/sanity-check {target}` to cross-validate findings across all domains and check for:
- Regressions or conflicts between recommendations.
- Build and test health before remediation begins.
- Merge conflicts from overlapping fixes.

## Phase 5: Remediation (skip if `no-fix`)

Work through findings by severity: CRITICAL first, then HIGH, then MEDIUM, then LOW -- stopping at the user's chosen floor (default: HIGH and above).

For each finding:
1. Log the finding in the report with its source review, severity, file, and line.
2. Implement the fix.
3. After each fix: (a) run `npm run build` to verify no build regression, (b) run the specific diagnostic command from the sub-review's verification section, (c) mark the finding as resolved in the consolidated report.

Apply deduplication: if multiple reviews flagged the same `file:line`, fix it once and mark all related findings as resolved.

Apply conflict resolution: if fixes from different reviews contradict, follow the priority order (Security > Data Integrity > Build Health > Accessibility > UI/UX > Performance).

Create one commit per severity tier (e.g., all CRITICAL fixes in one commit, all HIGH fixes in another). Use descriptive commit messages: `fix(review): resolve N CRITICAL findings from full-review of {target}`. Skip commits if `no-commit` is set.

### Unified Fix Examples

When multiple reviews flag the same file, apply a single unified fix that addresses all concerns at once.

**Same file flagged by security (SQL injection) + quality (missing error handling):**
Fix both in one change -- parameterize the query AND wrap in try/catch:
```typescript
// Before (security + quality violation)
const result = db.query("SELECT * FROM users WHERE id = " + id);

// After (unified fix)
try {
  const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
} catch (err) {
  logger.error({ err, userId: id }, "user lookup failed");
  throw new AppError("USER_NOT_FOUND", 404);
}
```

**Same component flagged by UI (missing aria-label) + quality (missing i18n):**
Fix both: add aria-label with i18n key:
```tsx
// Before
<button onClick={handleDelete}>🗑</button>

// After
<button onClick={handleDelete} aria-label={t("common.delete")}>{t("common.delete_icon")}</button>
```

## Phase 6: Re-verification

Run `/sanity-check {target}` again after all fixes to confirm:
- All targeted findings are resolved.
- No new regressions were introduced.
- Builds and tests still pass.

If new issues are found, loop back to Phase 4 (max 3 iterations to avoid infinite loops).

### Failure Exit Path

If all 3 iterations fail to resolve CRITICAL (P0) findings, stop the remediation loop and:
1. Produce the report with final verdict **FAIL**.
2. List every unresolved CRITICAL finding with file:line, source review, and reason it could not be resolved.
3. Include recommended manual steps for each unresolved blocker.

---

## Diagnostic Commands

Run these when issues arise during the review cycle:

### Build Failure After Fix
```bash
# Identify the failing module
npm run build 2>&1 | grep -i "error" | head -10

# Check if workspace packages are stale
for pkg in shared workflow-engine api-core api-integrations; do
  if [ -d "packages/$pkg/src" ]; then
    SRC=$(find "packages/$pkg/src" -name '*.ts' -newer "packages/$pkg/dist/index.js" 2>/dev/null | head -1)
    [ -n "$SRC" ] && echo "STALE: $pkg"
  fi
done

# Type check specific app
npx tsc --noEmit -p {target}/tsconfig.json 2>&1 | head -20
```

### Regression Detection
```bash
# Compare finding counts before/after fix iteration
# Count remaining findings in the consolidated report
rg -c 'P0|CRITICAL' docs/reviews/full-review-*.md
rg -c 'P1|HIGH' docs/reviews/full-review-*.md
```

### Fix Conflict Detection
```bash
# Check if multiple fixes touched the same file
git diff --name-only HEAD~N | sort | uniq -d
# If conflicts: review the file holistically, apply the higher-priority fix
```

---

## Output

### Report Path

Save the consolidated report to: `docs/reviews/full-review-{targetSlug}-{YYYY-MM-DD}.md`

If `docs/reviews/` does not exist, create it before writing the report.

### Aggregate Gate Scorecard

Combine gate results from all four domain reviews into a single scorecard:

```text
=== AGGREGATE GATE SCORECARD ===

Guardrails Pre-Check:
  Findings:           N P0, M P1, X P2, Y P3
  Verdict:            [CLEAN | WARN | BLOCKED | SKIPPED]

Coding Standards Review:
  Checks:             X/107 PASS, Y VIOLATION, Z N/A
  Verdict:            [COMPLIANT | NEEDS-WORK | NON-COMPLIANT]

UI Review:
  Blocking Gates:     X/16 PASS, Y/16 PARTIAL, Z/16 FAIL
  Component Substance: [PASS | FAIL]
  Verdict:            [GO | NO-GO | SKIPPED]

Quality Review:
  Blocking Gates:     X/9 PASS, Y/9 PARTIAL, Z/9 FAIL
  Component Substance: [PASS | FAIL]
  Data Round-Trip:    [PASS | FAIL]
  Verdict:            [SOLID | NEEDS-WORK | AT-RISK]

Security Review:
  Blocking Gates:     X/8 PASS, Y/8 PARTIAL, Z/8 FAIL
  Verdict:            [SECURE | AT-RISK | CRITICAL]

Infra Review:
  Blocking Gates:     X/7 PASS, Y/7 PARTIAL, Z/7 FAIL
  Verdict:            [READY | CONDITIONAL | NOT-READY]

BRD Coverage:
  Requirements:       X/Y DONE, Z PARTIAL, W GAP
  Behavioral Completeness: [PASS | FAIL]
  Skeleton Components: N found
  Verdict:            [COMPLIANT | PARTIAL | NON-COMPLIANT | SKIPPED]

Sanity Check:
  Verdict:            [CLEAN | CONDITIONAL | BLOCKED]

=== COMPONENT SUBSTANCE ===

Skeleton Components:  N found [list if > 0]
Substance Verdict:    [PASS | FAIL]

=== CONSOLIDATED ===

Total Findings:       N CRITICAL, M HIGH, X MEDIUM, Y LOW
Skeleton Components:  N (each counts as CRITICAL)
Findings Fixed:       A / B targeted
Findings Remaining:   C (list if > 0)
Remediation Passes:   1-3
Commits Created:      [list SHAs]
Final Verdict:        [PASS | CONDITIONAL | FAIL]
```

### Report Sections

The final report must contain these sections in order:

1. **Scope and Options** -- target, selected severity floor, skip decisions
2. **Sub-Review Summaries** -- one paragraph per review (guardrails, coding standards, UI, quality, security, infra, BRD coverage, sanity) with verdict and top findings
3. **Component Substance Report** -- consolidated skeleton/stub component table from Phase 3.1, with per-component verdicts (OK/SKELETON) and overall substance verdict (PASS/FAIL)
4. **Severity-Mapped Finding Table** -- all findings normalized to CRITICAL/HIGH/MEDIUM/LOW, deduplicated, with source domain tags (including `[Standards]` for coding-standards-review findings). Skeleton components are tagged `[Skeleton]` and always CRITICAL.
5. **Conflict Log** -- any contradictory recommendations and their resolution
6. **Remediation Log** -- each fix applied, files changed, verification result
7. **Aggregate Gate Scorecard** -- combined gates from all domains including Component Substance
8. **Unresolved Findings** -- anything not fixed, with severity and reason
9. **Final Verdict** -- PASS / CONDITIONAL / FAIL with blocking items listed
