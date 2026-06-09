---
name: code-structure
description: Post-feature code structure review — finds duplicated logic, missing service layers, and scattered patterns, then restructures into clean, reusable modules. Run after every feature to keep the codebase agent-friendly.
allowed-tools: Read Grep Edit Write Bash Glob Agent
argument-hint: "[target]"
---

# Code Structure: Service Layer & Deduplication Review

After a feature is built, scan for duplicated logic, scattered patterns, and inline code that should be extracted into reusable service modules. Then restructure.

The goal: make deployment, provisioning, and repair simpler by moving repeated runtime mechanics behind structured, reusable modules — while keeping route handlers and components responsible only for domain policy.

## Scoping

If the user specifies a target (e.g., `/code-structure apps/api`), review only that app or package. Otherwise, review recently changed files via `git diff`.

## Phase 1: Identify Changed Surface

```bash
# If target specified, use that directory
# Otherwise, find recently changed files
git diff --name-only HEAD~3 -- '*.ts' '*.tsx' | grep -v node_modules | grep -v '.test.' | grep -v '.spec.'
```

If no recent changes, fall back to full codebase scan of `apps/` and `packages/`.

## Phase 2: Duplication Detection

For each changed file and its neighboring modules, search for:

### A) Repeated Function Patterns
- Functions that do the same thing but in different files (e.g., two streaming response handlers, two file upload processors, two notification senders)
- Copy-pasted API call wrappers with minor URL/param differences
- Repeated error handling blocks (try/catch with same logging pattern)
- Repeated database query patterns (same joins, same filters, different table)

```bash
# Find functions with similar names across the codebase
rg "export (async )?function " --glob '*.ts' --glob '!*.test.*' --glob '!*.spec.*' -n | sort

# Find repeated patterns — common indicators
rg "await fetch\(|await db\.|await pool\." --glob '*.ts' -l | head -20
```

### B) Inline Logic That Should Be a Service
- Route handlers doing business logic directly (>20 lines of logic before response)
- Components with embedded API calls, data transformations, or business rules
- Repeated validation/transformation chains across multiple files

### C) Scattered Configuration
- Same constants defined in multiple files
- Repeated type definitions that should be in shared packages
- Same environment variable read in multiple places

## Phase 3: Service Layer Analysis

For each duplication found, determine:

1. **What's the shared mechanic?** (e.g., "stream an AI response", "upload and validate a file", "send a notification")
2. **Where should it live?**
   - Cross-app shared logic → `packages/shared/src/`
   - API-specific shared logic → `apps/api/src/services/`
   - Frontend-specific shared logic → `apps/{app}/src/hooks/` or `apps/{app}/src/utils/`
3. **What's the interface?** — Define the function signature that all callers would use
4. **What varies between callers?** — These become parameters, not separate implementations

## Phase 4: Restructure

For each identified duplication:

1. **Extract** the shared logic into a service function with a clear, descriptive name
2. **Replace** all duplicate call sites with calls to the new service function
3. **Preserve behavior** — the restructuring must not change any functionality
4. **Keep route handlers thin** — they should only:
   - Parse and validate the request
   - Call service functions
   - Format and return the response

### Extraction Rules

- One function per mechanic (not a god-service with 20 methods)
- Functions should be pure where possible (take inputs, return outputs, no hidden side effects)
- Side effects (DB writes, API calls, file operations) are explicit in the function signature
- Error handling stays in the caller unless it's truly shared error logic
- Don't over-abstract — if only 2 call sites exist, a simple shared function is fine. No factory patterns, no dependency injection, no abstract base classes unless there are 4+ consumers.

## Phase 5: Verify

After restructuring:

```bash
# 1. Type check passes
npx tsc --noEmit 2>&1 | tail -20

# 2. Tests still pass
npm test 2>&1 | tail -20

# 3. No new duplications introduced
# Re-run duplication scan from Phase 2

# 4. Build succeeds
npm run build 2>&1 | tail -20
```

## Guidelines

- **Don't refactor what isn't broken** — only extract code that is genuinely duplicated or will clearly be reused
- **Match existing patterns** — if the project uses a specific service layer convention, follow it
- **Minimum viable extraction** — the simplest shared function that eliminates the duplication. Three similar lines are better than a premature abstraction
- **Don't move unrelated code** — if adjacent code is messy but not duplicated, mention it but don't touch it
- **Preserve imports** — clean up imports only in files you modified

## Report

After fixing, provide a summary:

| File | Action | What Changed |
|------|--------|-------------|
| `apps/api/src/services/notify.ts` | Created | Extracted notification logic from 3 route handlers |
| `apps/api/src/routes/tasks.ts` | Modified | Replaced inline notification with `sendNotification()` |
| ... | ... | ... |

Include:
- Number of duplications found vs fixed
- New service functions created with their locations
- Any duplications intentionally left (with reason)
- Files that should be reviewed for further cleanup in a future pass
