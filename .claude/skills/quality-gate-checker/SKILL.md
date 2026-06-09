---
name: quality-gate-checker
description: "Evaluate a pipeline artefact against its quality gate checklist and record the sign-off in manifest.json. Use this skill whenever the user asks to 'check the gate', 'sign off gate A/B/C', 'validate the BRD before moving on', 'check if the data model is complete', 'review the contracts package', 'run the gate checklist', or is moving between pipeline stages and wants to ensure the prior stage output is complete. Also trigger automatically when any other pipeline skill (brd-generator, brd-data-modeler, contracts-generator) finishes — run the appropriate gate before the next stage begins. Gates A, B, and C correspond to the three formal checkpoints in the AI Dev Pipeline."
allowed-tools: Read Grep Glob Bash Write
---

# Quality Gate Checker

Evaluate pipeline artefacts against a structured checklist and record sign-off in `manifest.json`. Prevents downstream stages from starting until the prior stage's output is verified complete.

## The Three Gates

| Gate | After Stage | Artefact Checked | Blocks |
|------|-------------|------------------|--------|
| A | Stage 1 — BRD | `docs/brd.md` | Stage 2 (Data Model) |
| B | Stage 2 — Data Model | `docs/data-model/` | Stage 3 (Architecture) |
| C | Stage 5 — Contracts | `docs/contracts/` | Stage 6 (LLD) |

## Process

### Step 1: Identify the Gate and Artefact

Parse the user's argument:
- `gate-A` or `A` → Gate A, artefact at `docs/brd.md`
- `gate-B` or `B` → Gate B, artefact at `docs/data-model/`
- `gate-C` or `C` → Gate C, artefact at `docs/contracts/`

If `manifest.json` does not exist, create it with the minimum schema before proceeding.

### Step 2: Run the Gate Checklist

#### Gate A — BRD Completeness

Read `docs/brd.md` and evaluate each item:

```
GATE A CHECKLIST
────────────────────────────────────────────────────────────
 [ ] 1. Every user role is named with a description
 [ ] 2. Every core workflow has a happy path AND at least one failure case
 [ ] 3. Every FR has a unique ID (FR-NNN format)
 [ ] 4. Every FR references only entities and roles defined in the document
 [ ] 5. No FR references a concept not defined in the Glossary
 [ ] 6. Non-functional requirements have concrete thresholds (numbers, not adjectives)
 [ ] 7. Out-of-scope boundaries are explicitly stated
 [ ] 8. No two FRs describe identical behaviour (no duplicates)
 [ ] 9. Every external system is named (not "third-party payment provider")
 [10] 10. Glossary covers every domain term used in the FRs
```

For each item, check mechanically where possible:

```bash
# Count FRs and verify FR-NNN format
rg "^### FR-[0-9]{3}" docs/brd.md | wc -l

# Check for NFRs with concrete numbers
rg "p95|ms|MB|KB|uptime|WCAG" docs/brd.md

# Check for Glossary section
rg "^## Glossary" docs/brd.md

# Check for Out of Scope section
rg "out.of.scope|not in scope" docs/brd.md -i
```

For items that require reading comprehension (items 2, 4, 5, 8, 10), read the relevant sections and evaluate.

#### Gate B — Data Model Completeness

Read `docs/data-model/DATA_MODEL.md` and `docs/data-model/schema.sql`, cross-referenced against `docs/brd.md`:

```
GATE B CHECKLIST
────────────────────────────────────────────────────────────
 [ ] 1. Every entity named in any BRD FR has a table in schema.sql
 [ ] 2. Every workflow relationship described in the BRD has a FK in schema.sql
 [ ] 3. Every status or state field has a corresponding enum type
 [ ] 4. Every M:N relationship has a junction table
 [ ] 5. Soft-delete requirements from the BRD are implemented (deleted_at columns)
 [ ] 6. Multi-tenancy model is consistently applied across all tables (org_id)
 [ ] 7. Every table has created_at and updated_at TIMESTAMPTZ columns
 [ ] 8. All assumptions are documented in DATA_MODEL.md Assumptions section
 [ ] 9. Dependency metadata links each table to its source FR(s)
 [10] 10. schema.sql passes syntax validation
```

Mechanically verify where possible:

```bash
# Check all tables have timestamps
rg "created_at|updated_at" docs/data-model/schema.sql

# Check for enum types
rg "CREATE TYPE.*ENUM" docs/data-model/schema.sql | wc -l

# Syntax check schema.sql
psql --no-password -d postgres -c "BEGIN; $(cat docs/data-model/schema.sql); ROLLBACK;" 2>&1 | grep -i error | head -10
# If psql unavailable, use pg_format as a syntax-only check
pg_format --check docs/data-model/schema.sql 2>&1 | head -5

# Check for metadata blocks
rg "source_fr:|depends_on:" docs/data-model/schema.sql | head -5

# Extract entity names from BRD and compare against schema tables
rg "CREATE TABLE" docs/data-model/schema.sql | grep -oP '(?<=TABLE )\w+'
```

#### Gate C — Contracts Package Completeness

Read all files in `docs/contracts/` cross-referenced against `docs/brd.md` and `docs/data-model/`:

```
GATE C CHECKLIST
────────────────────────────────────────────────────────────
 [ ] 1. Every FR has at least one entry in api-contract.yaml
 [ ] 2. Every user role from the BRD appears in auth-matrix.json
 [ ] 3. Every resource from the data model appears in auth-matrix.json
 [ ] 4. Every entity with a status enum has a definition in state-machines.md
 [ ] 5. Every external service has a named test-double strategy in integration-map.md
 [ ] 6. Every error type in error-taxonomy.md has a defined handling strategy (user-visible or logged)
 [ ] 7. All environment variables are listed in environment-contract.md
 [ ] 8. All shared utilities required by multiple FRs are in shared-utilities.md
 [ ] 9. No two FRs share a state machine transition with incompatible side effects
 [10] 10. api-contract.yaml is valid YAML with required fields per endpoint
```

Mechanically verify:

```bash
# Count API contract entries
rg "^  /" docs/contracts/api-contract.yaml | wc -l

# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('docs/contracts/api-contract.yaml'))" 2>&1

# Check auth matrix has all roles from BRD
rg "role:" docs/contracts/auth-matrix.json | head -10

# Check state machines exist for status enums
rg "AS ENUM" docs/data-model/schema.sql | grep -oP "'\w+'" | sort -u
rg "^## " docs/contracts/state-machines.md

# Check all env vars are documented
rg "process\.env\.\w+" docs/ --glob '*.md' -o | sort -u | head -20
```

### Step 3: Score and Report

Calculate the score:

```
Gate X Checklist Results
═══════════════════════════════════════════════════════
 ✓  1. [description]  →  PASS
 ✓  2. [description]  →  PASS
 ✗  3. [description]  →  FAIL — [specific gap found]
 ⚠  4. [description]  →  WARN — [present but incomplete]
...

Items passing:   7/10
Items warning:   1/10
Items failing:   2/10

Verdict:  ⛔ BLOCKED
```

**Verdict rules:**
- **PASS** — All 10 items passing (or warning items have documented justification)
- **CONDITIONAL** — Zero FAIL items, 1–3 WARN items. May proceed with documented caveats
- **BLOCKED** — Any FAIL item. Must resolve before next stage

### Step 4: Record Sign-Off (if PASS or CONDITIONAL)

Update `manifest.json`:

```json
{
  "gates": {
    "A": {
      "signed_off": true,
      "verdict": "PASS",
      "by": "operator",
      "at": "<iso8601>",
      "score": "10/10",
      "caveats": [],
      "report": "docs/reviews/gate-A-YYYY-MM-DD.md"
    }
  }
}
```

For CONDITIONAL verdicts, list the caveats in `manifest.json` so downstream skills can reference them.

For BLOCKED verdicts, write the specific failures to `manifest.json` as `"blocked_by"` items so the next operator knows exactly what to fix.

### Step 5: Write Gate Report

Save full results to `docs/reviews/gate-{A|B|C}-{YYYY-MM-DD}.md` with:

1. Artefact paths reviewed
2. Full checklist with PASS/FAIL/WARN per item
3. Evidence for each item (file:line or search output)
4. Specific gaps found and what must be done to resolve them
5. Verdict and sign-off status

## Presenting the Result

After completing the gate check, always tell the user:
- The verdict (PASS / CONDITIONAL / BLOCKED)
- Which items failed (if any) and what specifically is missing
- What action to take before running the gate again

If BLOCKED: "Gate {X} is BLOCKED. The following items must be resolved before proceeding to Stage {N}: ..."
If CONDITIONAL: "Gate {X} is CONDITIONAL. You may proceed but note these caveats: ..."
If PASS: "Gate {X} passed (10/10). Stage {N} is now unblocked. Recorded in manifest.json."

## Notes

- Dependency tracking is best-effort, not a guarantee — quality gates are the backstop
- A gate report showing CONDITIONAL does not override the human sign-off requirement; it provides evidence for the human to make an informed decision
- Gates cannot be auto-bypassed; any gate check that finds FAIL items must surface them to the operator even if `auto_merge` is true in `manifest.json`
