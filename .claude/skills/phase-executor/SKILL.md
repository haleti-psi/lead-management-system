---
name: phase-executor
description: "Multi-agent orchestrator that executes a specification end-to-end. Parses functional requirements from SPEC.md or the separated docs/ artefact tree, builds a dependency graph, and dispatches each FR to a coding sub-agent in its own git worktree. Runs up to N agents in parallel, gates every PR through a reviewer sub-agent, auto-merges in topological order, runs integration tests after each merge, rolls back on failure, and escalates to the human only on repeated failures or architectural ambiguity. Use whenever the user has a SPEC.md or a docs/ pipeline artefact tree and wants the code built, or says things like 'execute the spec', 'build the project', 'run the plan', 'start the build', 'dispatch the FRs', 'implement the LLDs', or 'generate the code from the pipeline'."
allowed-tools: Read Grep Glob Bash Agent TaskCreate TaskUpdate TaskList TaskGet
---

# Phase Executor: Multi-Agent Specification Orchestrator

## Role

This skill is a **dispatcher**, not a coder. It never writes application code itself. Its job is to read the specification, decide which FRs are ready to build, hand each one to a coding sub-agent in an isolated git worktree, gate the result through a reviewer sub-agent, and merge approved PRs in dependency order.

The `allowed-tools` list deliberately omits `Edit` and `Write`. If you find yourself wanting to edit application files, you are out of role — spawn a sub-agent instead. `Bash` is included only for git/worktree/PR management and for running tests.

## Input Modes

### Mode A — Monolithic SPEC.md (legacy)
A single `SPEC.md` file produced by `brd-generator`. Must have `### FR-NNN: <title>` headers with `#### Business Requirement` and `#### Low-Level Design` subsections, plus `## SHARED-MODELS` and `## SHARED-CONVENTIONS`.

### Mode B — Separated docs/ artefact tree (pipeline)
The full pipeline artefact tree produced by the multi-stage specification pipeline:

```
docs/
  brd.md
  architecture.md
  data-model/schema.sql + DATA_MODEL.md
  guidelines/ (coding.md, ui.md, security.md, performance.md)
  contracts/ (api-contract.yaml, auth-matrix.json, state-machines.md,
               error-taxonomy.md, dependency-register.md, ...)
  lld/
    FR-001.md
    FR-001-tests.md
    FR-002.md
    FR-002-tests.md
    ...
```

In Mode B, each FR has its own LLD file and Test Specification file. The executor assembles the full context package for each agent from the docs/ tree.

**Auto-detect:** Check for `docs/lld/` directory. If present, use Mode B. Otherwise fall back to Mode A.

## Arguments

- `spec_path` — path to SPEC.md (Mode A default: `./SPEC.md`) or docs/ root (Mode B default: `./docs`)
- `repo_path` — path to the git repo (default: current directory)
- `integration_branch` — branch to merge into (default: `main`)
- `max_concurrent_agents` — parallelism cap (default: `1`; recommended `3–5` once trusted)
- `auto_merge` — merge PRs without human approval after reviewer passes (default: `true`)
- `max_retries` — retry attempts per FR before escalation (default: `2`)
- `resume` — boolean; if `true`, read `manifest.json` and continue an interrupted run

## State: `manifest.json`

The orchestrator maintains `manifest.json` in the repo root as the source of truth for run state. Update it after every state transition.

```json
{
  "run_id": "<uuid>",
  "mode": "B",
  "spec_path": "./docs",
  "integration_branch": "main",
  "started_at": "<iso8601>",
  "max_concurrent_agents": 3,
  "auto_merge": true,
  "pipeline_gates": {
    "A": { "signed_off": true, "at": "<iso8601>" },
    "B": { "signed_off": true, "at": "<iso8601>" },
    "C": { "signed_off": true, "at": "<iso8601>" }
  },
  "features": {
    "FR-001": {
      "title": "...",
      "lld_tier": 1,
      "risk": "low",
      "deps": [],
      "files_touched": [],
      "test_spec_path": "docs/lld/FR-001-tests.md",
      "status": "pending|ready|in_progress|review|approved|merged|failed|escalated",
      "worktree": "/path/to/.worktrees/FR-001",
      "branch": "feature/FR-001",
      "attempt": 0,
      "last_error": null,
      "ambiguities": [],
      "started_at": null,
      "merged_at": null
    }
  }
}
```

Statuses: `pending → ready → in_progress → review → approved → merged`, with `failed` or `escalated` as terminal failure states.

## Process

### Phase 1 — Load and Validate

**Mode A:**
1. Read SPEC.md
2. Run parser to extract FR IDs, titles, risk levels, dependencies, files touched
3. Validate all FR headers conform to `### FR-NNN: <title>`
4. Validate every dependency anchor resolves
5. Confirm `## SHARED-MODELS` and `## SHARED-CONVENTIONS` exist
6. Build dependency graph; detect cycles — halt if found

**Mode B:**
1. Read `docs/brd.md` — extract FR IDs and titles
2. For each FR, verify `docs/lld/FR-NNN.md` and `docs/lld/FR-NNN-tests.md` exist
3. Check that `docs/architecture.md`, `docs/guidelines/`, and `docs/contracts/` exist
4. Verify all pipeline quality gates are signed off in `manifest.json` (A, B, C)
5. Parse dependencies from each LLD's `# Metadata` block (`depends_on` field)
6. Build dependency graph; detect cycles — halt if found

**Gate:** If any validation fails, halt with a specific error message. Do not attempt partial execution.

### Phase 2 — Context Assembly per FR

For each FR, assemble the specification package the coding agent will receive.

**Mode A:** Extract the FR section from SPEC.md plus the SHARED-MODELS and SHARED-CONVENTIONS sections.

**Mode B:** Assemble from:
- `docs/lld/FR-NNN.md` — the FR's LLD (what to build)
- `docs/lld/FR-NNN-tests.md` — Test Specification (how to verify)
- `docs/architecture.md` — runtime, folder structure, middleware names
- `docs/guidelines/coding.md` — error handling, naming, async patterns
- `docs/guidelines/security.md` — auth checks, input validation rules
- `docs/guidelines/performance.md` — pagination, query constraints
- `docs/guidelines/ui.md` — component library, design tokens (if FR has UI)
- `docs/contracts/api-contract.yaml` — endpoint conventions
- `docs/contracts/auth-matrix.json` — role permissions for this FR's resources
- `docs/contracts/error-taxonomy.md` — permitted error types
- `docs/contracts/dependency-register.md` — approved libraries
- `docs/data-model/schema.sql` — exact table and column names

This assembled package is injected as context for the coding sub-agent. The agent must not make architectural, security, or structural decisions — all such decisions are pre-resolved in the package.

### Phase 3 — Dispatch Loop

```
WHILE ready_frs exist AND not all merged:
  ready = [fr for fr in pending if all deps merged]
  batch = ready[:max_concurrent_agents]
  FOR each fr in batch (parallel):
    spawn_coding_agent(fr, context_package)
    → agent writes code + tests to worktree
    → agent writes AMBIGUITY.md if any spec gap found
  FOR each completed fr:
    IF AMBIGUITY.md exists:
      surface to human, resolve, update LLD, retry
    ELSE:
      spawn_reviewer_agent(fr, context_package)
      IF reviewer approves:
        merge worktree to integration_branch
        run integration tests
        IF tests fail: rollback merge, mark fr failed
      ELSE:
        IF attempt < max_retries: retry with reviewer feedback
        ELSE: escalate to human
```

### Phase 4 — Coding Agent Instruction

Each coding sub-agent receives this system prompt (adapted to Mode A or B context):

```
You are a coding agent implementing FR-{NNN}: {title}.

Your specification package is attached. Follow it exactly — do not make
architectural decisions not specified in it. All such decisions are pre-resolved.

If you encounter an ambiguity not resolved in your LLD:
  1. Write a file called AMBIGUITY.md in your worktree root
  2. Describe the specific ambiguity precisely
  3. Stop — do not guess

Rules:
- Use only libraries listed in the Dependency Register
- Implement only the error types listed in the Error Taxonomy
- Follow the folder structure in the Architecture Document
- Apply auth checks exactly as specified in the Auth Matrix
- Match the API response shapes in the API Contract exactly
- Write tests covering every scenario in the Test Specification

When done: all tests in the Test Specification must pass.
```

### Phase 5 — Reviewer Agent Instruction

Each reviewer sub-agent receives the FR's context package plus the generated code:

```
You are a code reviewer for FR-{NNN}: {title}.

Review the generated code against its specification package.
Check:
1. Every LLD requirement has a corresponding implementation
2. Auth matrix rows are correctly implemented
3. Only approved error types are used
4. All Test Specification scenarios have passing tests
5. Guidelines are honoured (error handling, logging, validation)
6. No new libraries introduced beyond the Dependency Register

Output: APPROVE or REJECT with specific findings.
If REJECT: list each failing check with file:line evidence.
```

### Phase 6 — Ambiguity Resolution

When a coding agent writes `AMBIGUITY.md`:

1. Surface the file contents to the human operator
2. The human provides a resolution
3. Update the relevant LLD (`docs/lld/FR-NNN.md`) with the resolution
4. Update `manifest.json` — record the ambiguity and its resolution
5. Clear `AMBIGUITY.md` from the worktree
6. Resume the coding agent with the updated context

This is a specification refinement, not a failure. Track all resolved ambiguities in `manifest.json` — they will be propagated to future projects.

### Phase 7 — Integration Testing

After each successful FR merge:

```bash
# Run the full test suite against the integration branch
npm test 2>&1 | tail -20

# If tests fail: identify which FR's merge caused the regression
git bisect start
git bisect bad HEAD
git bisect good <pre-merge-commit>
# Rollback the offending merge and mark FR as failed
```

### Phase 8 — Completion

When all FRs are `merged` or `escalated`:

1. Run the full test suite one final time
2. Update `manifest.json` with final status
3. Produce a completion report:

```
Phase Execution Complete
========================
FRs dispatched:   N
FRs merged:       X
FRs escalated:    Y
FRs failed:       Z

Ambiguities resolved: A
Test suite: PASS / FAIL

Merged FRs:
  FR-001 (Tier 1) — merged at <time> — 2 files
  FR-002 (Tier 2) — merged at <time> — 5 files
  ...

Escalated FRs (require human attention):
  FR-007 — reason: <last_error>
```

## Failure Modes and Recovery

| Condition | Action |
|-----------|--------|
| Build fails after merge | Rollback merge, mark FR `failed`, continue with other FRs |
| Tests fail after merge | Rollback merge, mark FR `failed` |
| Agent writes AMBIGUITY.md | Surface to human, resolve, retry |
| Agent fails 3 times | Mark `escalated`, surface last error, continue with other FRs |
| Circular dependency detected | Halt, surface the cycle, ask human to resolve |
| Context package missing files | Halt before dispatching that FR, report which files are missing |
| All FRs blocked by escalated FR | Surface the blocker, pause until human resolves |

## Resume Behaviour

If the session ends mid-run:
```
/phase-executor --resume
```
Reads `manifest.json`, identifies the last stable state, and continues from there. FRs in `in_progress` state are restarted from scratch (their worktrees are cleaned). FRs in `merged` state are not re-executed.

## Quality Checklist Before Marking Complete

- [ ] All non-escalated FRs are in `merged` state
- [ ] Full test suite passes on the integration branch
- [ ] No uncleaned worktrees remain
- [ ] All ambiguities are recorded in `manifest.json`
- [ ] `manifest.json` reflects final state
- [ ] Completion report produced
