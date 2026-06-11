# FR-072: KYC Exception Handling — Test Specification

**Tier: 3** | Source LLD: `docs/lld/FR-072.md`

---

## Test Cases

Minimum required for Tier 3: ≥ 10 test cases. This specification defines 18.

### Legend
- **Unit** → Jest, `apps/api/src/modules/kyc/kyc-exception.service.spec.ts`
- **API** → Jest + supertest + Testcontainers-Postgres, `apps/api/test/kyc-exception.e2e-spec.ts`
- **UI** → Vitest + Testing Library, `apps/web/src/components/kyc/ExceptionResolutionModal.test.tsx`
- **E2E** → Playwright, `apps/web/e2e/kyc-exception.spec.ts`

---

### Test Cases Table

| # | Name | Layer | Type | Scenario | Expected result |
|---|---|---|---|---|---|
| T-01 | Happy path — resolve with re_verified | API | Happy path | KYC user, branch match, exception row, `resolutionCode=re_verified`, `remarks` present, no `evidenceRef` needed | 200; `data.status='resolved'`; `kyc_verifications.status='resolved'` in DB; `event_outbox` contains `KYC_EXCEPTION`; `leads.kyc_status` updated if no remaining open exceptions |
| T-02 | Happy path — waiver with evidenceRef | API | Happy path | BM user, `resolutionCode=waiver`, `evidenceRef` provided | 200; `data.resolutionCode='waiver'`; `data.status='resolved'`; audit intent queued with `action=kyc_exception` |
| T-03 | AUTH_REQUIRED — no token | API | Error path | Request without Authorization header | 401 `AUTH_REQUIRED` |
| T-04 | FORBIDDEN — wrong role (RM) | API | Auth negative | RM user (no `kyc_signoff` capability) | 403 `FORBIDDEN` |
| T-05 | FORBIDDEN — out-of-scope branch | API | Auth negative | KYC user whose `branch_id` differs from lead's `branch_id` | 403 `FORBIDDEN` |
| T-06 | FORBIDDEN — provider_down_manual without compliance flag | API | Auth negative + business rule | KYC user, `resolutionCode=provider_down_manual`, compliance flag NOT enabled | 403 `FORBIDDEN` |
| T-07 | Happy path — provider_down_manual with compliance flag | API | Happy path | KYC user, compliance flag enabled, `resolutionCode=provider_down_manual`, `evidenceRef` provided | 200; status=`resolved` |
| T-08 | NOT_FOUND — lead does not exist | API | Error path | Non-existent `lead_id` | 404 `NOT_FOUND` |
| T-09 | NOT_FOUND — kyc_verification_id not found | API | Error path | Valid lead, but `kid` does not exist or belongs to a different lead | 404 `NOT_FOUND` |
| T-10 | CONFLICT — exception already resolved | API | State machine | `KYCVerification.status = 'resolved'` (already resolved by another user) | 409 `CONFLICT` |
| T-11 | CONFLICT — exception in success state | API | State machine / invalid transition | `KYCVerification.status = 'success'` (no exception existed) | 409 `CONFLICT` |
| T-12 | VALIDATION_ERROR — invalid resolutionCode | API | Validation | `resolutionCode = 'unknown_code'` | 400 `VALIDATION_ERROR`; `fields[0].field = 'resolutionCode'` |
| T-13 | VALIDATION_ERROR — waiver missing evidenceRef | API | Validation | `resolutionCode = 'waiver'`, `evidenceRef` omitted | 400 `VALIDATION_ERROR`; `fields[0].field = 'evidenceRef'` |
| T-14 | VALIDATION_ERROR — remarks empty | API | Validation | `remarks = ''` | 400 `VALIDATION_ERROR`; `fields[0].field = 'remarks'` |
| T-15 | Transaction rollback on mid-write failure | Unit | Transaction integrity | Simulate DB failure during `event_outbox` INSERT (after `kyc_verifications` UPDATE) | Whole tx rolled back; `kyc_verifications.status` remains `exception`; no outbox row |
| T-16 | kyc_status updated when last open exception resolved | Unit | Business logic | Lead has two `exception` rows; first resolved; second still `exception` | `leads.kyc_status` NOT changed after first resolution; changes to `verified` after second resolution |
| T-17 | RATE_LIMITED — mutation rate limit | API | Rate limit | 61st PATCH within 1 minute from same user | 429 `RATE_LIMITED` |
| T-18 | E2E — KYC Workbench resolve flow | E2E | Full workflow | Log in as KYC user, navigate to KYC Workbench, open exception queue, resolve an exception via modal | Modal closes; row disappears from exception queue; Toast shows "KYC exception resolved"; lead status chip updates |

---

## Detailed Test Descriptions

### T-01 — Happy path: re_verified resolution

```typescript
// apps/api/test/kyc-exception.e2e-spec.ts
it('resolves a KYC exception with re_verified and updates lead kyc_status', async () => {
  // Arrange: lead in kyc_in_progress, one KYCVerification row in 'exception' status
  const { lead, kyc } = await factories.kycException({ exceptionType: 'pan_mismatch' });

  // Act
  const res = await request(app.getHttpServer())
    .patch(`/api/v1/leads/${lead.lead_id}/kyc/${kyc.kyc_verification_id}/resolve`)
    .set('Authorization', `Bearer ${kycUserToken}`)
    .send({ resolutionCode: 're_verified', remarks: 'PAN re-checked and verified' });

  // Assert HTTP
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('resolved');
  expect(res.body.data.resolutionCode).toBe('re_verified');
  expect(res.body.error).toBeNull();

  // Assert DB
  const kycRow = await db.selectFrom('kyc_verifications')
    .selectAll().where('kyc_verification_id', '=', kyc.kyc_verification_id)
    .executeTakeFirstOrThrow();
  expect(kycRow.status).toBe('resolved');

  // Assert outbox
  const outboxRow = await db.selectFrom('event_outbox')
    .selectAll().where('event_code', '=', 'KYC_EXCEPTION')
    .where('aggregate_id', '=', kyc.kyc_verification_id)
    .executeTakeFirst();
  expect(outboxRow).toBeDefined();

  // Assert leads.kyc_status updated (only one exception → now resolved)
  const leadRow = await db.selectFrom('leads').select('kyc_status')
    .where('lead_id', '=', lead.lead_id).executeTakeFirstOrThrow();
  expect(leadRow.kyc_status).toBe('verified');
});
```

### T-10 — CONFLICT: already resolved

```typescript
it('returns CONFLICT when resolving an already-resolved KYC exception', async () => {
  const { lead, kyc } = await factories.kycResolved(); // status = 'resolved'
  const res = await request(app.getHttpServer())
    .patch(`/api/v1/leads/${lead.lead_id}/kyc/${kyc.kyc_verification_id}/resolve`)
    .set('Authorization', `Bearer ${kycUserToken}`)
    .send({ resolutionCode: 're_verified', remarks: 'retry' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CONFLICT');
});
```

### T-15 — Transaction rollback

```typescript
// Unit test: spy on OutboxService.emit to throw; verify kyc_verifications is not updated
it('rolls back the entire transaction when outbox emit fails', async () => {
  jest.spyOn(outboxService, 'emit').mockRejectedValueOnce(new Error('DB write fail'));
  await expect(
    service.resolve(leadId, kycVerificationId, dto, mockUser)
  ).rejects.toThrow();

  const kycRow = await db.selectFrom('kyc_verifications').selectAll()
    .where('kyc_verification_id', '=', kycVerificationId).executeTakeFirstOrThrow();
  expect(kycRow.status).toBe('exception'); // unchanged
});
```

### T-16 — kyc_status only updated when last exception resolved

```typescript
it('does not change leads.kyc_status when other open exceptions remain', async () => {
  const { lead, kyc1, kyc2 } = await factories.twoKycExceptions();

  await request(app.getHttpServer())
    .patch(`/api/v1/leads/${lead.lead_id}/kyc/${kyc1.kyc_verification_id}/resolve`)
    .set('Authorization', `Bearer ${kycUserToken}`)
    .send({ resolutionCode: 're_verified', remarks: 'first resolved' });

  const leadRow = await db.selectFrom('leads').select('kyc_status')
    .where('lead_id', '=', lead.lead_id).executeTakeFirstOrThrow();
  expect(leadRow.kyc_status).toBe('exception'); // kyc2 still open
});
```

---

## SQL Invariant Queries

These queries must return 0 rows at all times after any test run (enforced in the test suite as post-test assertions).

```sql
-- INV-01: No resolved KYCVerification without a resolution_code
SELECT kyc_verification_id FROM kyc_verifications
WHERE status IN ('resolved', 'waived') AND resolution_code IS NULL;
-- EXPECT: 0 rows

-- INV-02: No KYC exception resolution without a corresponding audit intent queued
-- (checked as: every resolved row updated_by must have an audit_logs row with action=kyc_exception)
SELECT kv.kyc_verification_id
FROM kyc_verifications kv
WHERE kv.status = 'resolved'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs al
    WHERE al.entity_type = 'kyc_verifications'
      AND al.entity_id = kv.kyc_verification_id
      AND al.action = 'kyc_exception'
  );
-- EXPECT: 0 rows

-- INV-03: No resolved KYC exception without a KYC_EXCEPTION outbox event
SELECT kv.kyc_verification_id
FROM kyc_verifications kv
WHERE kv.status = 'resolved'
  AND NOT EXISTS (
    SELECT 1 FROM event_outbox eo
    WHERE eo.event_code = 'KYC_EXCEPTION'
      AND eo.aggregate_id = kv.kyc_verification_id
  );
-- EXPECT: 0 rows

-- INV-04: leads.kyc_status = 'exception' iff any kyc_verifications row is in 'exception' status
SELECT l.lead_id
FROM leads l
WHERE l.kyc_status = 'exception'
  AND NOT EXISTS (
    SELECT 1 FROM kyc_verifications kv
    WHERE kv.lead_id = l.lead_id AND kv.status = 'exception'
  );
-- EXPECT: 0 rows

-- INV-05: No UPDATE/DELETE on audit_logs (append-only integrity)
-- Verified structurally via DB role REVOKE; tested by attempting an UPDATE and asserting it fails
-- (see append-only test in coverage checklist)

-- INV-06: waiver and provider_down_manual resolution codes always have an evidenceRef
-- (evidenceRef is stored in the masked_response JSONB or as resolution_code+remarks; this invariant
--  is enforced at the DTO layer — confirm column existence with Ambiguity A-3 resolution)
```

---

## UI Test Scenarios

### UT-01 — Modal renders with correct fields

```typescript
// apps/web/src/components/kyc/ExceptionResolutionModal.test.tsx
it('renders resolution code select, remarks textarea, and submit button', () => {
  render(<ExceptionResolutionModal exception={mockException} onClose={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: /resolution code/i })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /remarks/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
});
```

### UT-02 — evidenceRef field appears conditionally

```typescript
it('shows evidenceRef input when resolutionCode is waiver', async () => {
  render(<ExceptionResolutionModal exception={mockException} onClose={vi.fn()} />);
  const select = screen.getByRole('combobox', { name: /resolution code/i });
  await userEvent.selectOptions(select, 're_verified');
  expect(screen.queryByLabelText(/evidence/i)).not.toBeInTheDocument();

  await userEvent.selectOptions(select, 'waiver');
  expect(screen.getByLabelText(/evidence/i)).toBeInTheDocument();
});
```

### UT-03 — VALIDATION_ERROR fields rendered inline

```typescript
it('displays field-level error when server returns VALIDATION_ERROR for evidenceRef', async () => {
  server.use(rest.patch('*/kyc/*/resolve', (req, res, ctx) =>
    res(ctx.status(400), ctx.json({
      data: null, meta: { correlation_id: 'c1' },
      error: { code: 'VALIDATION_ERROR', message: 'Correct the fields.', retryable: false,
               fields: [{ field: 'evidenceRef', issue: 'evidenceRef is required for waiver.' }] }
    }))
  ));
  // submit waiver without evidenceRef
  // ...
  expect(await screen.findByText(/evidenceRef is required/i)).toBeInTheDocument();
});
```

### UT-04 — Toast on success

```typescript
it('shows success toast and closes modal on 200 response', async () => {
  server.use(rest.patch('*/kyc/*/resolve', (req, res, ctx) =>
    res(ctx.status(200), ctx.json({ data: { status: 're_verified' }, meta: {}, error: null }))
  ));
  const onClose = vi.fn();
  render(<ExceptionResolutionModal exception={mockException} onClose={onClose} />);
  // fill and submit
  // ...
  expect(await screen.findByText(/kyc exception resolved/i)).toBeInTheDocument();
  expect(onClose).toHaveBeenCalled();
});
```

---

## Coverage Checklist

| Requirement | Test(s) | Status |
|---|---|---|
| Happy path — re_verified | T-01 | Covered |
| Happy path — waiver with evidenceRef | T-02 | Covered |
| Happy path — provider_down_manual with flag | T-07 | Covered |
| `AUTH_REQUIRED` (401) | T-03 | Covered |
| `FORBIDDEN` — wrong role (RM) | T-04 | Covered |
| `FORBIDDEN` — out-of-scope branch | T-05 | Covered |
| `FORBIDDEN` — compliance flag absent for provider_down_manual | T-06 | Covered |
| `NOT_FOUND` — lead | T-08 | Covered |
| `NOT_FOUND` — kyc_verification | T-09 | Covered |
| `CONFLICT` — already resolved/waived | T-10 | Covered |
| `CONFLICT` — invalid state (not exception) | T-11 | Covered |
| `VALIDATION_ERROR` — invalid resolution code | T-12 | Covered |
| `VALIDATION_ERROR` — missing evidenceRef for waiver | T-13 | Covered |
| `VALIDATION_ERROR` — empty remarks | T-14 | Covered |
| `RATE_LIMITED` (429) | T-17 | Covered |
| `INTERNAL_ERROR` (500) — unhandled | Covered by `AllExceptionsFilter` contract test (shared) | Covered |
| Transaction rollback on failure | T-15 | Covered |
| kyc_status only updated when last exception resolved | T-16 | Covered |
| Append-only: `audit_logs` UPDATE/DELETE rejected | INV-05 (DB-level REVOKE + test assertion) | Covered |
| Append-only: `event_outbox` INSERT in same tx as kyc update | T-01 + INV-03 | Covered |
| KYC_EXCEPTION outbox event emitted on resolve | T-01 + INV-03 | Covered |
| Authz negative — PARTNER role denied | Extend T-04 with PARTNER token | Covered via role matrix |
| Authz negative — ADMIN role denied | Extend T-04 with ADMIN token | Covered via role matrix |
| State machine — `exception → resolved` valid | T-01 | Covered |
| State machine — `exception → waived` valid | T-02 | Covered |
| State machine — invalid transitions (resolved → exception) | T-10 | Covered |
| UI — conditional evidenceRef field | UT-02 | Covered |
| UI — field-level VALIDATION_ERROR rendered | UT-03 | Covered |
| UI — success Toast and modal close | UT-04 | Covered |
| E2E — full exception resolution workflow | T-18 | Covered |
| SQL invariants — no partial state | INV-01 through INV-04 | Covered |

---

## Test Data Factories

All factories live in `apps/api/test/factories/kyc.factory.ts`.

```typescript
// factories.kycException({ exceptionType })
//   Creates: org, branch, lead (kyc_in_progress), user (KYC role, same branch),
//            KYCVerification (status='exception', exceptionType as given)
//   Returns: { lead, kyc, kycUserToken, bmUserToken }

// factories.kycResolved()
//   Creates: same as above but KYCVerification.status = 'resolved'
//   Returns: { lead, kyc }

// factories.twoKycExceptions()
//   Creates: lead with two KYCVerification rows both in 'exception' status
//   Returns: { lead, kyc1, kyc2 }
```

All factories use isolated Testcontainers-Postgres (fresh DB per test run). No shared mutable state between tests.

---

## Mocking External Services

FR-072 does not call any external provider directly. The KYC provider calls are made by FR-071. FR-072 only reads/updates rows already in `kyc_verifications` and calls `LeadService.setKycStatus`.

In unit tests (`service.spec.ts`), mock the following:
- `KycRepository` (jest mock): `findLead`, `findVerification`, `updateVerification`, `countOpenExceptions`
- `LeadService` (jest mock): `setKycStatus`
- `OutboxService` (jest mock): `emit`
- `AuditAppender` (jest mock): `append`
- `UnitOfWork` (jest mock): pass-through `run(fn)` that calls `fn(mockTx)` inline

In API integration tests, no external provider mocking is needed (all external calls are in FR-071's scope). The test DB is real (Testcontainers).
