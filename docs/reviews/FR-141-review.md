# FR-141 — Stage 8 Per-FR Review

**Verdict:** REJECT

> FR-141 (Event Outbox & Analytics/AI-Readiness Stream) is well-implemented overall. Auth/ABAC is correctly N/A (no HTTP endpoint; system-managed resource). Owner-writes rule is respected — only `event_outbox` is written. All production code is free of `console.*`, `any` types, swallowed errors, and hardcoded secrets. Parameterized Kysely queries are used throughout. LIMIT(100) is enforced on the poll SELECT. PII masking via MaskingService.maskEventPayload runs before every INSERT. Error codes are correct (INTERNAL_ERROR for validation/masking failures). State machine guards match contracts. Two issues block approval: the three required integration e2e test cases (T02/T03/T15) are absent — the file `apps/api/test/outbox.e2e-spec.ts` does not exist — and the runOnce batch loop lacks per-row error isolation, meaning a DB error on markPublished/markFailed aborts processing of subsequent rows in that poll cycle.

## Findings

### MAJOR — `apps/api/test/outbox.e2e-spec.ts (file missing)`

The LLD mandates this file for integration (e2e) tests T02, T03, and T15 (Tier 3 requirement: full workflow integration tests). T02 verifies lead stage transition + outbox row commit atomically (INV-06 invariant). T03 verifies full tx rollback removes the outbox row. T15 verifies CONSENT_WITHDRAWN is emitted end-to-end via ConsentService. None of these exist anywhere in apps/api/test/. The testing-contract tier-3 requirement for full workflow integration tests is unmet.

**Fix:** Create apps/api/test/integration/outbox.e2e-spec.ts using Jest + Testcontainers (matching the existing retention.e2e-spec.ts harness). Implement T02: call LeadService.transitionStage inside uow.run, commit, then assert leads.stage, stage_history row, and event_outbox row all present with status=pending. Implement T03: force a mid-tx error (e.g. duplicate stage_history_id) after OutboxService.emit is called, assert zero event_outbox rows for the test aggregate_id. Implement T15: call ConsentService.withdraw inside uow.run, assert event_outbox row with event_code=CONSENT_WITHDRAWN, aggregate_type=Consent, masked payload, schema_version=1.

### MINOR — `apps/api/src/core/outbox/outbox-publisher.service.ts:127-130 (runOnce for loop)`

The for-of loop over rows calls `await this.relay(row)` with no per-row error catch. If markPublished or markFailed throws a DB error (e.g. transient connection reset), the exception propagates out of relay() and out of runOnce(), abandoning all remaining rows in the batch for that cycle. tick() recovers the timer, but batch isolation is lost. The LLD's Path B implies per-row processing. The T08 test explicitly relies on runOnce() rejecting on markPublished failure, confirming this behaviour is untested for multi-row batches.

**Fix:** Wrap the relay call in a per-row try/catch: `try { const outcome = await this.relay(row); result[outcome] += 1; } catch (err) { this.logger.error({ event_id: row.event_id, err }, 'outbox relay error; skipping row for this cycle'); result.rescheduled += 1; }`. This preserves at-least-once (the row stays pending) while ensuring the rest of the batch is processed. Update T08 to assert rescheduled=1 rather than a rejection.


## Test coverage

Unit tests (outbox.service.spec.ts, outbox-publisher.service.spec.ts) fully cover T01, T04-T14 as required. The masking test (T09/INV-02/INV-03) uses the real MaskingService — strong. State machine transitions (T05, T06, T07, T12, T13), at-least-once (T08), LIMIT enforcement (T11), validation boundaries (T10, T14) are all present and well-structured. Critical gap: integration e2e tests T02, T03, T15 (apps/api/test/outbox.e2e-spec.ts) do not exist — transactional atomicity, rollback guarantee, and end-to-end CONSENT_WITHDRAWN flow are untested at the integration layer. E2e tests are not deferred project-wide for this FR (the LLD explicitly lists them as required, unlike some other FRs).
