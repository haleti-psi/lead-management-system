---
name: simplify
description: "Review recently changed code for duplication, dead code, unnecessary complexity, and consistency violations — then fix the issues found. Use this skill whenever a user asks to 'clean up the code', 'simplify this', 'refactor after the feature', 'deduplicate', 'remove dead code', 'improve code quality', 'polish the implementation', or says 'we just shipped X, let's clean up'. Also trigger after any AI-assisted coding session where the user wants a quick quality pass before committing. Works on git diff by default; accepts a specific file or directory as a target."
allowed-tools: Read Grep Edit Write Bash Glob Agent
---

# Simplify: Post-Coding Code Review and Cleanup

Review recently changed code for reuse, quality, and efficiency issues, then fix them. Designed as a fast, focused cleanup pass — not a full review suite.

## When to Use

Run this after every feature coding session, before committing or running the full review suite. It is cheaper and faster than `full-review` and catches the patterns AI coding assistants most commonly introduce.

Do NOT use for: full security review, accessibility audit, infrastructure review, or BRD compliance. Use `full-review` for those.

## Scoping

- **No argument**: scan all uncommitted changes via `git diff --name-only HEAD`
- **File or directory**: scan only that target (`/simplify apps/api/src/routes/orders.ts`)
- **Options**: `--dry-run` — report issues without fixing; `--staged` — scan only staged changes

## Process

### Step 1: Identify Changed Files

```bash
# Default: all uncommitted changes
git diff --name-only HEAD -- '*.ts' '*.tsx' '*.py' '*.js' '*.jsx' | grep -v node_modules | grep -v '.test.' | grep -v '.spec.'

# If target specified: use that path instead
```

If no changed files found, fall back to files modified in the last 3 commits:
```bash
git diff --name-only HEAD~3 -- '*.ts' '*.tsx' '*.py'
```

### Step 2: Review Each File for These Issues

For each changed file, check:

**A. Code Duplication**
- Functions that do the same thing as an existing function elsewhere (use `rg` to search for similar patterns)
- Copy-pasted blocks with minor variations that should be parameterised
- Repeated error handling patterns that belong in shared middleware
- API call wrappers that duplicate existing service functions

```bash
# Find functions with similar names
rg "export (async )?function " --glob '*.ts' --glob '!*.test.*' -n | sort

# Find repeated await patterns
rg "await (fetch|db\.|pool\.)" --glob '*.ts' -l | head -10
```

**B. Dead Code**
- Unused imports (TypeScript will flag these — run `tsc --noEmit`)
- Variables assigned but never read
- Commented-out code blocks
- Functions defined but never called
- Branches that can never execute

```bash
# Unused imports via TypeScript
npx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1 | head -30

# Commented-out code
rg "^\s*//" --glob '*.ts' --glob '*.tsx' -n | grep -v "^.*//\s*[A-Z]" | head -20
```

**C. Unnecessary Complexity**
- Nested ternaries (more than 2 levels)
- Functions over 50 lines that do multiple unrelated things
- Abstractions with only one consumer (premature generalisation)
- Complex logic that could be expressed as a lookup table or enum
- Over-engineered error types for simple cases

**D. Performance**
- Obvious N+1 patterns (queries inside loops over user data)
- Missing early returns that force the entire function body to run
- Redundant computations inside loops (move invariants outside)
- Unnecessary `async/await` on functions that don't need it

**E. Consistency**
- Does the code follow the project's existing patterns? (error handling, naming, async style)
- Are imports ordered consistently with adjacent files?
- Are variable names consistent with the domain vocabulary used elsewhere?

### Step 3: Classify Each Issue

| Issue | Action |
|-------|--------|
| Duplication with clear extraction target | Extract and replace all call sites |
| Dead import | Remove |
| Commented-out code > 3 lines old | Remove (git history preserves it) |
| N+1 pattern with a clear batching solution | Fix |
| Over-50-line function doing two distinct things | Split if both halves are independently testable |
| Single-consumer abstraction | Inline unless the abstraction adds genuine clarity |
| Style inconsistency | Fix to match the dominant project pattern |

**Do NOT fix:** Architecture problems, naming across files not changed, refactors that touch more than 3 files, anything that changes external behaviour.

### Step 4: Apply Fixes

Fix issues in order: dead code first (reduces noise), then duplication, then complexity.

For each extraction:
1. Determine where the shared function belongs (service layer, utils, shared package)
2. Write the function with a clear, descriptive name
3. Replace all call sites
4. Verify no call site was missed: `rg "old-pattern" --glob '*.ts'`

For each duplication extraction, follow the existing project's service layer convention. If the project has a `services/` directory, put it there. Don't introduce new conventions.

### Step 5: Verify

After all fixes:

```bash
# Build must still pass
npm run build 2>&1 | tail -10

# Tests must still pass
npm test 2>&1 | tail -15

# TypeScript must be clean
npx tsc --noEmit 2>&1 | head -20

# No new duplications from the cleanup itself
git diff --stat HEAD
```

If any check fails, revert the specific change that caused the failure and report it as a deferred item.

## Output

After completing, produce a brief summary:

```
Simplify Summary
================
Files reviewed: N
Issues found:   X
Issues fixed:   Y
Deferred:       Z (list with reason)

Changes made:
  src/services/orders.ts   — extracted sendOrderNotification() from 3 route handlers
  src/routes/orders.ts     — removed 2 unused imports, removed commented block (42 lines)
  src/utils/validation.ts  — inlined single-use validateOrderAmount() into its only caller

Build: PASS  Tests: PASS  TypeScript: PASS
```

Save a full report to `docs/reviews/simplify-{YYYY-MM-DD}.md` if any changes were made.

## Rules

- Never refactor what isn't broken — only extract code that is genuinely duplicated or clearly will be reused
- Match existing patterns — if the project uses a specific service layer convention, follow it
- Minimum viable extraction — three similar lines are better than a premature abstraction
- Don't touch adjacent code that is messy but not in scope — mention it but don't fix it
- Preserve imports — clean up imports only in files you modified
- `--dry-run` mode: produce the summary report and stop; do not edit any files
