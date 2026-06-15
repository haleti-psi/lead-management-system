# FR-052 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-052 Pipeline Board has three real issues that warrant rejection: (1) a BLOCKER response double-wrapping bug in the controller — returning `{ data: result }` instead of `result` causes the global ResponseEnvelopeInterceptor to nest the payload as `{ data: { data: result }, meta, error }`, breaking the API contract shape; (2) a MAJOR spec mismatch where terminal-state transitions (handed_off → any) are emitted as 400 VALIDATION_ERROR + STAGE_GUARD_FAILED but the test spec (T06) and LLD both require 409 CONFLICT; (3) a MAJOR omission in the api-contract.yaml for PATCH /leads/{id}/stage — the 404 NOT_FOUND response that the LLD defines and the service implements is not declared in the contract, breaking client code generators and OpenAPI validators. The SLA breach card highlight on LeadCard uses ageing-days colour (not sla_first_contact_due_at), which is a MINOR deviation from the spec. Auth/ABAC, owner-writes, parameterised queries, LIMIT enforcement, masking delegation, error taxonomy, no-any, no-console, no swallowed errors, and test coverage for happy paths and most negative paths are all correct.

## Findings

### BLOCKER — `apps/api/src/modules/workspace/pipeline-board.controller.ts:53-60`

Controller returns `{ data: result }` but the global ResponseEnvelopeInterceptor checks `isEnvelope()` which requires `{ data, meta, error }` to pass-through. Since the returned object has `data` but no `meta` or `error` keys, the interceptor wraps it again, producing `{ data: { data: StageTransitionResult }, meta, error: null }` — a double-nesting that violates the api-contract.yaml LeadEnvelope shape and breaks all consumers.

**Fix:** Return `result` directly (not `{ data: result }`), consistent with all other controllers in the codebase (e.g., `capture.controller.ts:72` returns `result.data`). The interceptor will produce the correct `{ data: StageTransitionResult, meta, error: null }` envelope.

### MAJOR — `apps/api/src/modules/workspace/pipeline-board.service.ts:113-120`

Terminal-state transitions (handed_off → any stage) cause StageGuardService to return `failed: ['terminal_state']`. PipelineBoardService maps ALL non-empty `failed[]` to VALIDATION_ERROR (400) + STAGE_GUARD_FAILED. However, test spec T06 and the LLD Error Cases table both require a 409 CONFLICT for terminal-state transitions (`handed_off → any (terminal state)`). The 400 vs 409 split matters for client-side error handling (the frontend only snaps-back on STAGE_GUARD_FAILED 400 vs shows a CONFLICT toast on 409).

**Fix:** Before the generic guard-fail branch, check `if (guardResult.failed.includes('terminal_state'))` and throw `new DomainException(ERROR_CODES.CONFLICT)` — identical to the optimistic-lock path. The remaining guard failures continue to map to VALIDATION_ERROR + STAGE_GUARD_FAILED.

### MAJOR — `docs/contracts/api-contract.yaml:155-167 (PATCH /leads/{id}/stage responses block)`

The api-contract.yaml responses for PATCH /leads/{id}/stage declare 200/400/403/409 but omit `"404": { $ref: '#/components/responses/NotFound' }`. The LLD §Error Cases explicitly defines a 404 NOT_FOUND path (lead absent or deleted), and PipelineBoardService throws DomainException(NOT_FOUND) at line 87. The missing 404 declaration causes OpenAPI-generated clients to treat the 404 as unexpected, and violates the contract as the authoritative source of truth.

**Fix:** Add `"404": { $ref: '#/components/responses/NotFound' }` to the PATCH /leads/{id}/stage responses block in api-contract.yaml, alongside the existing 400/403/409 entries.

### MINOR — `apps/web/src/components/pipeline/LeadCard.tsx:92`

The LLD spec (LeadCard responsibilities) states that the card border turns `--destructive` when `slaFirstContactDueAt` is in the past. The implementation instead applies `text-destructive` colour to the ageing-days badge when `ageingDays > 30`. The `slaFirstContactDueAt` field is not even present in the `PipelineLeadCard` type (`pipeline-board.types.ts`). This means the SLA breach visual indicator described in the spec (E06 test scenario) cannot be rendered correctly.

**Fix:** Add `slaFirstContactDueAt: string | null` to `PipelineLeadCard` in `pipeline-board.types.ts`, populate it from the GET /leads response, and in `LeadCard.tsx` add `className={cn('...', card.slaFirstContactDueAt && new Date(card.slaFirstContactDueAt) < new Date() ? 'ring-2 ring-destructive' : '')}` to the Card element, matching the E06 test assertion.


## Test coverage

Unit tests (pipeline-board.service.spec.ts, stage-guard.service.spec.ts, stage-transition.dto.spec.ts, pipeline-board.controller.spec.ts) cover T01/T04/T07/T09/T10/T12/T13/T14/T15/U01/U02/U03/U04/U05 and the controller ABAC metadata checks. Frontend component tests (KanbanBoard.test.tsx) cover loading/empty/error/success/mobile-sheet states. Missing: T02 (BM branch-scoped happy path), T03 (rejected with reason — only DTO-level, not service-level), T06 (terminal-state CONFLICT — spec asserts 409 but implementation emits 400, test in stage-guard.service.spec.ts tests the guard return value but not the service-level HTTP status mapping), T11 (HEAD role → 403, only indirectly via capability matrix), T16 (transaction rollback via mocked DB failure), T17 (board scope filter — RM-only leads). E2E tests (pipeline-board.spec.ts, e2e/pipeline-board.spec.ts) are deferred project-wide. Coverage is adequate for the core unit tier but several mandatory API-tier supertest cases (T02, T03, T11, T16, T17) referenced in FR-052-tests.md are absent from the spec files found.
