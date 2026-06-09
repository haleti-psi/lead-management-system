---
name: feature-life-cycle
description: "End-to-end feature lifecycle: BRD generation with blue ocean thinking, adversarial evaluation, test case generation, gap analysis, phased planning, execution, bug fixing, full review, and local deployment. Orchestrates 8 sub-skills into a single pipeline that takes a feature from idea to deployed code."
argument-hint: "<feature-description or path-to-doc> [options]"
user_invocable: true
---

# Feature Life Cycle — Idea to Deployed Feature Pipeline

Orchestrate the complete lifecycle of a feature from initial concept through deployed, reviewed code. This skill chains 8 sub-skills in a dependency-aware pipeline, with parallel execution where possible and quality gates between phases.

## Input

The skill accepts one of:

- A **feature description** (1+ paragraphs describing what to build)
- A **path to a document** (existing BRD, spec, or requirements file)
- A **reference to existing project context** (e.g., "the data upload feature based on the BRD in doc/")

If no argument is provided, ask the user to describe the feature they want to build.

## Options

The user may append options after the feature description:

- `skip-eval` — Skip adversarial evaluation (Step 2-3). Use when speed matters more than rigor.
- `skip-tests` — Skip test case generation (Step 4). Use when tests already exist.
- `brd-only` — Stop after producing the final BRD (Step 3).
- `plan-only` — Stop after producing the phased plan (Step 6).
- `no-deploy` — Run through full-review but skip local deployment.
- `autonomous` — Skip user approval gates between phases (proceed automatically).

Default behavior: run all 10 steps with user approval gates after Steps 3, 6, and 7.

---

## Pipeline Overview

```
Step 1: BRD Generation (/brd-generator)
         │
Step 2: Adversarial Evaluation (/adversarial-idea-evaluator)
         │
Step 3: Final BRD (synthesize evaluations)
         │
    ┌────┴────┐
Step 4:     Step 5:
Test Cases  Gap Analysis
(/test-case-generator)  (BRD vs codebase)
    └────┬────┘
         │
Step 6: Phased Plan (/phased-planner)
         │
Step 7: Execute Plan (/phase-executor)
         │
Step 8: Test Validation & Bug Fixing
         │
Step 9: Full Review (/full-review)
         │
Step 10: Local Deployment (/local-deployment)
```

---

## Step 1: BRD Generation

**Sub-skill:** `/brd-generator`

**Goal:** Produce a comprehensive, AI-buildable BRD from the feature description.

### Process

1. Gather all available context before invoking the BRD generator:
   - Read any documents the user referenced (existing BRDs, specs, design docs).
   - Scan the existing codebase for related features, patterns, and data models that inform the BRD.
   - Check `doc/` and project root for any existing requirements or planning documents.

2. **Blue ocean thinking**: Before generating, expand the feature scope by considering:
   - What would a best-in-class product in this domain include?
   - What adjacent features do competitors offer that users expect?
   - What pain points exist in the current workflow that this feature could solve?
   - What automation, intelligence, or analytics opportunities exist?
   - What integrations or cross-feature synergies are possible with the existing system?

   Add these as additional requirements in the BRD (clearly marked as "Blue Ocean Enhancements" so the user can accept or reject them).

3. Invoke `/brd-generator` with the enriched feature description.

4. Read the generated BRD `.docx` file and extract the content for subsequent steps.

**Output:** BRD v1 saved as `.docx` in the project root or `doc/` directory.

**Gate:** Inform the user the BRD v1 is ready. If `autonomous` mode, proceed immediately.

---

## Step 2: Adversarial Evaluation

**Sub-skill:** `/adversarial-idea-evaluator`

**Goal:** Stress-test the key decisions and feature modules in the BRD.

### Process

1. Extract the major feature modules from the BRD (group FRs by module/domain area).

2. For each major module (not every individual FR — batch related FRs together), invoke `/adversarial-idea-evaluator` to evaluate:
   - Is this the right approach?
   - What are the risks, costs, and alternatives?
   - Are there missing edge cases or business rules?
   - Is the scope appropriate (over-engineered or under-specified)?

3. **Batch strategy**: Group FRs into 3-7 evaluable units based on functional boundaries (e.g., "User Management & Auth", "Order Processing Workflow", "Reporting & Analytics"). Evaluating every FR individually is prohibitively slow and produces redundant arguments.

4. Run evaluations sequentially. Each evaluation produces a report in `doc/evaluations/`.

5. After all evaluations complete, produce a **consolidated evaluation summary**:
   - Modules rated: Approve / Approve with Conditions / Needs Revision
   - Key risks across all modules (ranked)
   - Recommended changes to the BRD (specific, actionable)
   - Blue Ocean items validated or rejected

**Output:** Individual evaluation reports in `doc/evaluations/` + consolidated summary.

---

## Step 3: Final BRD

**Goal:** Synthesize adversarial feedback into a refined, final BRD.

### Process

1. Read the consolidated evaluation summary from Step 2.

2. Update the BRD to address all findings:
   - **Approved with Conditions**: Add the conditions as constraints or business rules.
   - **Needs Revision**: Rewrite the affected FRs based on the recommended changes.
   - **Key Risks**: Add mitigation strategies to Non-Functional Requirements or as explicit business rules.
   - **Rejected Blue Ocean items**: Remove from the BRD or move to "Out of Scope / Future Consideration".
   - **Accepted Blue Ocean items**: Fully integrate into the relevant sections (data model, FRs, UI, API).

3. Run the BRD quality checklist (from `/brd-generator`):
   - Every entity mentioned in FRs exists in the data model.
   - Every FR has acceptance criteria and a user story.
   - Sample data exists for every entity.
   - API examples exist for complex endpoints.

4. Generate the final BRD as a new `.docx` file (versioned: `_v2` or `_final`).

**Output:** Final BRD `.docx` file.

**Gate:** Present the final BRD to the user for approval before proceeding to implementation planning. Show a summary of changes from v1 to final. If `brd-only` option, stop here. If `autonomous`, proceed.

---

## Step 4: Test Case Generation (parallel with Step 5)

**Sub-skill:** `/test-case-generator`

**Goal:** Generate comprehensive test cases from the final BRD.

### Process

1. Invoke `/test-case-generator` with the final BRD from Step 3.
2. The test cases will be used in Step 8 for validation after implementation.

**Execution:** Launch this step as a **background agent** since it has no dependency on Step 5 and vice versa.

**Output:** Test cases `.docx` file.

---

## Step 5: Gap Analysis (parallel with Step 4)

**Goal:** Identify what the final BRD requires vs. what already exists in the codebase.

### Process

1. Read the final BRD and extract a structured inventory:
   - **Data model entities** and their fields
   - **API endpoints** required
   - **UI screens/pages** required
   - **Business logic/workflows** required
   - **Integrations** required
   - **Non-functional requirements** (performance, security, etc.)

2. Scan the existing codebase systematically:
   - **Database**: Check `supabase/migrations/`, Drizzle schema files, existing tables
   - **API**: Check `server/routes/`, `server/services/` for existing endpoints
   - **UI**: Check `client/src/pages/`, `apps/*/src/pages/` for existing screens
   - **Shared types**: Check `packages/shared/` for existing types/schemas
   - **Config**: Check for existing feature flags, environment variables, etc.

3. For each BRD requirement, classify as:
   - **EXISTS** — Fully implemented in the codebase (with file path references)
   - **PARTIAL** — Partially implemented (specify what exists and what's missing)
   - **MISSING** — No implementation found
   - **CONFLICT** — Existing implementation contradicts BRD requirement (specify the conflict)

4. Produce a **gap report** as a markdown file:

```markdown
# Gap Analysis: [Feature Name]
## Date: [YYYY-MM-DD]

## Summary
- Total requirements: N
- Existing (no work needed): X
- Partial (modification needed): Y
- Missing (new implementation): Z
- Conflicts (resolution needed): W

## Data Model Gaps
| Entity | Status | Existing Location | Gap Details |
|--------|--------|-------------------|-------------|
| ... | MISSING/PARTIAL/EXISTS/CONFLICT | file:line | ... |

## API Gaps
| Endpoint | Status | Existing Location | Gap Details |
|----------|--------|-------------------|-------------|
| ... | ... | ... | ... |

## UI Gaps
| Screen | Status | Existing Location | Gap Details |
|--------|--------|-------------------|-------------|
| ... | ... | ... | ... |

## Business Logic Gaps
| Workflow/Rule | Status | Existing Location | Gap Details |
|---------------|--------|-------------------|-------------|
| ... | ... | ... | ... |

## Integration Gaps
| Integration | Status | Gap Details |
|-------------|--------|-------------|

## Non-Functional Gaps
| Requirement | Status | Gap Details |
|-------------|--------|-------------|

## Conflicts Requiring Resolution
[Detail each CONFLICT with current implementation vs BRD requirement]
```

**Output:** Gap analysis report saved to `doc/gap-analysis-[feature-name]-[YYYY-MM-DD].md`.

---

## Step 6: Phased Execution Plan

**Sub-skill:** `/phased-planner`

**Goal:** Create a dependency-ordered, phase-by-phase implementation plan that addresses all gaps.

### Process

1. Wait for both Step 4 (test cases) and Step 5 (gap analysis) to complete.

2. Feed the gap analysis report to `/phased-planner` with this context:
   - The final BRD (for full requirements context)
   - The gap report (so the plan focuses only on gaps, not re-implementing existing code)
   - Any CONFLICT items (which need special handling — may require migration or refactoring)

3. The phased planner will produce a plan document in `doc/`.

**Planning guidance to pass to `/phased-planner`:**
   - **Skip EXISTS items** — Don't plan work for things that already exist and match the BRD.
   - **PARTIAL items first** — Modifications to existing code should come before new implementations (they often unblock new code).
   - **CONFLICT items need migration phases** — If existing code contradicts the BRD, plan a migration/refactoring phase early.
   - **MISSING items by dependency** — New implementations should follow the planner's standard dependency ordering (DB → services → API → UI).
   - **Include test tasks in each phase** — Tests belong with the code they test, not in a separate phase.

**Output:** Phased development plan saved to `doc/plan-[feature-name].md`.

**Gate:** Present the plan to the user for approval before execution. Show the dependency graph and phase summary. If `plan-only`, stop here. If `autonomous`, proceed.

---

## Step 7: Execute the Plan

**Sub-skill:** `/phase-executor`

**Goal:** Implement all code changes according to the phased plan.

### Process

1. Invoke `/phase-executor doc/plan-[feature-name].md`.
2. The phase executor handles:
   - Task creation and dependency tracking
   - Parallel execution where possible
   - Review gates between phases
   - Build verification after each phase

3. **Important guardrails during execution:**
   - After each phase, verify the build still succeeds (`npm run build`).
   - Respect existing code patterns and conventions.
   - Don't modify code marked as EXISTS in the gap analysis unless the plan explicitly calls for it.

**Output:** Implemented code changes across all planned files.

**Gate:** Phase executor includes its own inter-phase gates. After all phases complete, summarize what was built and any deferred items.

---

## Step 8: Test Validation & Bug Fixing

**Goal:** Validate the implementation against the test cases from Step 4 and fix any bugs found.

### Process

1. Read the test cases document from Step 4.

2. For each test case category, validate systematically:

   a. **Automated validation** (where possible):
      - Run `npm run build` to verify no build errors.
      - Check that all new API endpoints respond correctly (use curl/fetch via bash).
      - Verify database migrations applied cleanly.
      - Check that new pages/routes are accessible.

   b. **Code-level validation** (for each test case):
      - Read the relevant code and verify it implements the expected behavior described in the test case.
      - Check that acceptance criteria from the test cases are satisfied by the code.
      - Verify error handling paths exist for negative test cases.
      - Verify boundary conditions are handled.
      - Verify permission checks exist for authorization test cases.

3. **Track findings** in a validation report:

```markdown
# Test Validation Report: [Feature Name]

## Summary
- Total test cases: N
- Passed: X
- Failed: Y
- Blocked: Z (cannot validate without manual testing)

## Failed Test Cases
| TC-ID | Description | Expected | Actual | Severity |
|-------|-------------|----------|--------|----------|
| ... | ... | ... | ... | P0/P1/P2 |

## Bug Fixes Applied
| TC-ID | Bug Description | Fix Applied | Files Changed |
|-------|----------------|-------------|---------------|
| ... | ... | ... | ... |
```

4. **Fix bugs** found during validation:
   - Fix P0 (critical) bugs first, then P1, then P2.
   - After each fix, re-run build verification.
   - Re-validate the specific test case after fixing.

5. **Iterate** until all fixable test cases pass (max 3 fix-validate cycles to avoid infinite loops).

**Output:** Test validation report saved to `doc/test-validation-[feature-name]-[YYYY-MM-DD].md`.

---

## Step 9: Full Review

**Sub-skill:** `/full-review`

**Goal:** Comprehensive quality, security, UI, and infrastructure review of all changes.

### Process

1. Invoke `/full-review` targeting the changed files/directories.

2. The full review runs: guardrails pre-check, coding standards, UI review, quality review, security review, infra review, sanity check, and remediation.

3. All findings are fixed as part of the full review's remediation phase.

**Output:** Review report in `docs/reviews/`.

---

## Step 10: Local Deployment Verification

**Sub-skill:** `/local-deployment`

**Goal:** Verify the complete feature works end-to-end in a local environment.

### Process

1. Invoke `/local-deployment` to:
   - Build all packages
   - Start dev servers
   - Validate authentication
   - Verify database connectivity
   - Test new routes and API endpoints
   - Verify the feature renders and functions correctly
   - Check frontend-to-API integration

2. Report the local deployment status with access credentials and feature location.

**Output:** Local deployment verification report with ready-for-testing verdict.

---

## Error Handling & Recovery

### If a step fails:

| Step | Failure Action |
|------|---------------|
| 1 (BRD) | Retry with more context. Ask user for clarification if needed. |
| 2 (Eval) | Skip failed module evaluation, note it as unevaluated. Continue. |
| 3 (Final BRD) | Present partial updates. Ask user whether to proceed with incomplete revisions. |
| 4 (Tests) | Log warning. Continue — tests are used in Step 8 but aren't blocking for Steps 5-7. |
| 5 (Gap) | Critical failure — cannot plan without gap analysis. Retry or ask user for guidance. |
| 6 (Plan) | Ask user to manually adjust the gap report or provide additional context. Retry. |
| 7 (Execute) | Phase executor handles its own failures. If a phase fails after 3 attempts, surface to user. |
| 8 (Validate) | After 3 fix cycles, report remaining failures and continue to review. |
| 9 (Review) | Full review handles its own retry logic (max 3 iterations). Report final state. |
| 10 (Deploy) | Report deployment issues. User may need to resolve environment issues manually. |

### Resumability

If the pipeline is interrupted (session ends, user pauses), the artifacts from completed steps are saved to disk:
- BRD files in project root or `doc/`
- Evaluation reports in `doc/evaluations/`
- Gap analysis in `doc/`
- Plan document in `doc/`
- Test validation report in `doc/`
- Review report in `docs/reviews/`

On resume, check which artifacts exist and offer to restart from the last incomplete step.

---

## Completion Report

After all steps complete (or after an early stop due to options), produce a final summary:

```markdown
# Feature Life Cycle Report: [Feature Name]
## Date: [YYYY-MM-DD]

## Pipeline Status
| Step | Status | Duration | Output |
|------|--------|----------|--------|
| 1. BRD Generation | DONE | - | [path] |
| 2. Adversarial Evaluation | DONE | - | [path] |
| 3. Final BRD | DONE | - | [path] |
| 4. Test Case Generation | DONE | - | [path] |
| 5. Gap Analysis | DONE | - | [path] |
| 6. Phased Plan | DONE | - | [path] |
| 7. Plan Execution | DONE | - | N phases, M tasks |
| 8. Test Validation | DONE | - | X/Y passed |
| 9. Full Review | DONE | - | [verdict] |
| 10. Local Deployment | DONE | - | [verdict] |

## Key Metrics
- Requirements in BRD: N
- Gaps identified: X
- Code changes: Y files across Z phases
- Test cases: A total, B passed, C failed
- Review verdict: [PASS/CONDITIONAL/FAIL]
- Deployment status: [READY/NOT READY]

## Artifacts Produced
- [list all generated files with paths]

## Deferred Items
- [anything explicitly deferred for future work]

## Next Steps
- [recommended follow-up actions]
```

Save to `doc/feature-life-cycle-[feature-name]-[YYYY-MM-DD].md`.

---

## Guidelines

- **Evidence-first**: Every decision, finding, and status must reference specific files, line numbers, or artifacts. No vague claims.
- **Existing code respect**: Never overwrite or refactor existing working code unless the gap analysis identifies a CONFLICT that the plan addresses.
- **User control**: Unless `autonomous` mode is set, always pause at gates (Steps 3, 6, 7) for user approval.
- **Parallel execution**: Steps 4 and 5 must run in parallel. Within Step 7, the phase executor handles parallelism.
- **Incremental saves**: Save artifacts to disk after each step completes. This enables resumability and gives the user visibility into progress.
- **Blue ocean, not gold-plating**: Blue ocean thinking in Step 1 should add genuinely valuable features for the domain, not unnecessary complexity. The adversarial evaluation in Step 2 serves as a check against over-engineering.
