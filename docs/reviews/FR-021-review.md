# FR-021 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-021 backend (NestJS) is solidly implemented: auth/ABAC guards are correct on both endpoints, UnitOfWork wrapping is complete, LeadService is the sole writer of `leads`, AuditAppender/OutboxService are called inside the transaction, Kysely parameterised queries throughout, no `any` casts or console.* calls, error codes match the taxonomy, MERGE_UNMERGE_WINDOW_HOURS is registered in the environment contract (min:1 enforced), and test coverage for the service/repository/controller is thorough and maps well to the test spec. However there are two non-trivial defects: (1) the four web UI files specified in the LLD File Locations section are entirely absent — not deferred, just missing; (2) MergeLeadRepository in M3 directly writes documents, consent_records, and tasks tables whose owners per auth-matrix resource_governance are M8, M12, and M11 respectively, with no port/seam abstraction. Additionally the api-contract.yaml entry for POST /leads/{id}/merge omits the 400 response code that the implementation clearly produces.

## Findings

### BLOCKER — `apps/web/src/components/leads/MergeConfirmDialog.tsx (missing); apps/web/src/components/leads/UnmergeActionButton.tsx (missing); apps/web/src/hooks/use-merge-lead.ts (missing); apps/web/src/hooks/use-unmerge-lead.ts (missing)`

All four web UI files specified in the LLD File Locations section are absent. The directory apps/web/src/components/leads/ does not exist; the hooks directory exists (with 18 other hooks) but the two merge hooks are not present. The deferred tier is Playwright e2e (UI-E2E-001 to 005), not the React components themselves — those are first-class spec deliverables.

**Fix:** Create apps/web/src/components/leads/MergeConfirmDialog.tsx (Dialog + FieldPrecedenceTable with MaskedField for mobile/PAN, ReasonInput, BranchNotice banner), apps/web/src/components/leads/UnmergeActionButton.tsx (conditionally rendered per duplicate_status + window expiry), apps/web/src/hooks/use-merge-lead.ts, and apps/web/src/hooks/use-unmerge-lead.ts (useMutation wrappers invalidating ['lead', id] and ['lead', masterId] on success) per LLD §UI Component Tree and §File Locations.

### MAJOR — `apps/api/src/modules/dedupe/merge-lead.repository.ts:152-199 (reparentDocuments/reparentConsents/reparentTasks) and :207-272 (restoreDocuments/restoreConsents/restoreTasks)`

MergeLeadRepository (M3/dedupe) directly issues UPDATE statements against the documents, consent_records, and tasks tables. auth-matrix.json resource_governance assigns documents to M8, consent_records to M12, and tasks to M11/M6. The architecture §11 owner-writes rule requires that only the owning module's service writes its entity. No port/seam abstraction wraps these cross-module writes; the LLD note ('not-yet-built M8/M11/M12 owner FRs') acknowledges but does not resolve the violation.

**Fix:** Introduce port interfaces (e.g. DocumentReparentPort, ConsentReparentPort, TaskReparentPort) in the respective owning modules, bind noop or direct-write adapters now, and inject them into MergeLeadService so M3 invokes the owning module's boundary rather than writing the tables directly. Alternatively, record an explicit AMBIGUITY.md entry ratified by the architecture doc that FK-only re-parents during merge are a named exception to owner-writes, scoped to this FR.

### MAJOR — `docs/contracts/api-contract.yaml:171 (POST /leads/{id}/merge responses block)`

The api-contract.yaml entry for POST /leads/{id}/merge declares only 200, 403, and 409 responses. The implementation produces 400 VALIDATION_ERROR (DTO failures: missing reason, bad UUID, field_precedence=manual without owner_id, master_lead_id equals path id) and 404 NOT_FOUND (duplicate or master not found). The companion POST /leads/{id}/unmerge entry (line 173) correctly includes 400. The missing 400 means clients have no contract-level notice that the endpoint can return a VALIDATION_ERROR with fields[].

**Fix:** Add '"400": { $ref: "#/components/responses/ValidationError" }' and '"404": { $ref: "#/components/responses/NotFound" }' to the /leads/{id}/merge responses block, mirroring the unmerge entry and the pattern used by other mutation endpoints (e.g. /leads/{id}/stage at line 165).

### MINOR — `apps/api/src/modules/dedupe/dto/merge-lead.dto.ts:67 (MergeLeadResponseDto); apps/api/src/modules/dedupe/merge-lead.service.ts:215`

MergeLeadResponseDto declares unmerge_allowed_until: string | null (LLD spec: 'null if unmerge is disabled'), but the env schema enforces MERGE_UNMERGE_WINDOW_HOURS min:1, making the null branch permanently unreachable. The service always assigns unmergeAllowedUntil.toISOString() (never null). The nullable type is misleading and dead code.

**Fix:** Either (a) change the DTO field to string (non-nullable) to match the invariant, or (b) add a documented escape hatch (e.g. MERGE_UNMERGE_WINDOW_HOURS=0 → disable) and remove the min:1 constraint, emitting null from the service when windowHours is 0. Option (a) is simpler if disabling unmerge is not a product requirement.

### MINOR — `docs/lld/FR-021-tests.md:21 (T-010 Expected Outcome column)`

T-010 states the expected outcome as '400 VALIDATION_ERROR or 409 CONFLICT' for a chained merge attempt. The implementation raises CONFLICT (409) — consistent with the LLD state machine section ('Invalid transitions → CONFLICT 409') and the service test at merge-lead.service.spec.ts:416. The ambiguous 'or' in the test spec creates unnecessary doubt for future reviewers.

**Fix:** Update T-010 Expected Outcome to '409 CONFLICT — chained merges are blocked' to match the LLD state machine spec and the implemented behaviour, removing the ambiguous 400 alternative.


## Test coverage

Unit and component test coverage is good: merge-lead.service.spec.ts covers T-001/002/004/006/007/009-013/018-026 (happy paths, field precedence, auth/state errors, unmerge flows), merge-lead.controller.spec.ts covers T-008 analogue (metadata checks for @Requires, @Public absence, throttle tier), and merge-lead.repository.spec.ts covers T-014/016/017/026/030 analogues (re-parent column sets, A6 FK-only rule for consents, empty-list short-circuit). T-003/005 Zod DTO tests are present and exercised in the service spec. T-027 (rate-limit) is verified structurally via controller metadata. T-028 PII masking is verified by asserting the response carries no PII fields. T-029/030 DB-level REVOKE assertions are deferred to the Testcontainers integration wave (correctly noted). Missing: no test coverage for the web UI components (MergeConfirmDialog, UnmergeActionButton, hooks) because those files do not exist.
