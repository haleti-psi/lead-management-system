# FR-051: Lead 360 View — Test Specification

**Tier: 2** | Source LLD: `docs/lld/FR-051.md`

---

## Test Cases

Minimum required for Tier 2: **≥ 5 test cases** covering happy path, every error code the FR raises, authz both ways, masking, validation, and boundaries. This specification provides **12 named test cases** to satisfy the testing contract.

| # | ID | Layer | Scenario | Input | Expected |
|---|---|---|---|---|---|
| 1 | TC-051-01 | API integration | **Happy path — RM views their own lead** | Valid JWT (RM, owner of lead); valid lead UUID | 200; `data.leadId` matches; `data.stage` present; `data.identity.mobile` masked (`98xxxxxx10`); `data.identity.panMasked` = `ABCxxxx1F`; all sub-sections present (stageHistory, eligibilitySnapshot, documentSummary, etc.) |
| 2 | TC-051-02 | API integration | **404 — lead does not exist** | Valid JWT (RM); UUID that has no matching row in `leads` | 404; `error.code = NOT_FOUND`; `error.message = "We couldn't find that item."`; `data = null` |
| 3 | TC-051-03 | API integration | **404 — out-of-scope lead (existence hidden)** | Valid JWT (RM user A); lead owned by RM user B (different owner_id, same branch) | 404; `error.code = NOT_FOUND`; existence not revealed |
| 4 | TC-051-04 | API integration | **401 — no token** | Request with no `Authorization` header | 401; `error.code = AUTH_REQUIRED` |
| 5 | TC-051-05 | API integration | **400 — invalid UUID path param** | JWT valid; `id = "not-a-uuid"` | 400; `error.code = VALIDATION_ERROR`; `error.fields[0].field = "id"` |
| 6 | TC-051-06 | API integration | **Masking — DPO role** | Valid JWT (DPO); a lead with PAN and mobile set | 200; `data.identity.dob` absent or null; `data.identity.mobile` masked; `data.identity.panMasked` masked; `data.notes` empty or omitted (DPO sees no internal notes unless break-glass) |
| 7 | TC-051-07 | API integration | **DPO access is audited** | Valid JWT (DPO); valid lead UUID | 200; AND: `SELECT COUNT(*) FROM audit_logs WHERE actor_id = :dpoUserId AND entity_type = 'lead' AND entity_id = :leadId AND action = 'view_sensitive'` returns ≥ 1 after the request |
| 8 | TC-051-08 | API integration | **PARTNER cannot see another partner's lead** | Valid JWT (PARTNER A); a lead submitted by PARTNER B | 404; `error.code = NOT_FOUND` |
| 9 | TC-051-09 | API integration | **PARTNER sees only non-internal notes** | Valid JWT (PARTNER A); a lead with one `is_internal=true` note and one `is_internal=false` note | 200; `data.notes` contains exactly 1 note (`is_internal=false`); internal note is not present |
| 10 | TC-051-10 | API integration | **Soft-deleted lead returns 404** | Valid JWT (RM); lead UUID where `leads.deleted_at IS NOT NULL` | 404; `error.code = NOT_FOUND` |
| 11 | TC-051-11 | API integration | **Partial data — empty sub-sections are empty arrays/null, not errors** | Valid JWT (RM); lead with no stageHistory rows, no eligibilitySnapshot, no notes, no duplicateMatches | 200; `data.stageHistory = []`; `data.eligibilitySnapshot = null`; `data.notes = []`; `data.duplicateMatches = []`; `data.documentSummary = { total: 0, verified: 0, pending: 0, mismatch: 0 }` |
| 12 | TC-051-12 | Unit | **Consent de-duplication — latest-per-purpose wins** | `consent_records` rows: two rows with `purpose=data_processing`, one `state=granted` (newer), one `state=withdrawn` (older) | `consentSummary` contains one entry for `data_processing` with `state=granted` (newest row wins) |

---

## Detailed Test Descriptions

### TC-051-01: Happy path — RM views their own lead

**Framework:** Jest + supertest (API integration)  
**Setup:** Testcontainers-Postgres; Flyway schema; seed RM user; create lead owned by that RM user; seed one stageHistory row, one eligibilitySnapshot (status=received), one consent_record (data_processing, granted), two tasks (status=open), one note (is_internal=true).

```typescript
describe('GET /api/v1/leads/:id', () => {
  it('returns the 360 aggregate for an RM viewing their own lead', async () => {
    const { leadId } = await factory.createLead({ ownerId: rmUser.userId });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${rmToken}`)
      .expect(200);

    expect(res.body.error).toBeNull();
    expect(res.body.data.leadId).toBe(leadId);
    expect(res.body.data.stage).toBeDefined();
    expect(res.body.data.identity.mobile).toMatch(/^[6-9]\d{0,1}x+\d{2}$/);  // masked
    expect(res.body.data.stageHistory).toBeInstanceOf(Array);
    expect(res.body.data.openTaskCount).toBe(2);
    expect(res.body.data.consentSummary).toBeInstanceOf(Array);
    expect(res.body.meta.correlation_id).toBeDefined();
  });
});
```

### TC-051-02: 404 — lead does not exist

```typescript
it('returns NOT_FOUND when the lead UUID has no matching row', async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${randomUUID()}`)
    .set('Authorization', `Bearer ${rmToken}`)
    .expect(404);

  expect(res.body.error.code).toBe('NOT_FOUND');
  expect(res.body.data).toBeNull();
});
```

### TC-051-03: 404 — out-of-scope lead (existence hidden)

```typescript
it('hides existence of a lead outside the RM scope (returns 404, not 403)', async () => {
  const { leadId } = await factory.createLead({ ownerId: otherRm.userId });
  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${rmToken}`)  // rmToken belongs to a different RM
    .expect(404);

  expect(res.body.error.code).toBe('NOT_FOUND');
});
```

### TC-051-04: 401 — no token

```typescript
it('returns AUTH_REQUIRED when no Authorization header is provided', async () => {
  const { leadId } = await factory.createLead();
  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .expect(401);

  expect(res.body.error.code).toBe('AUTH_REQUIRED');
});
```

### TC-051-05: 400 — invalid UUID path param

```typescript
it('returns VALIDATION_ERROR with field error when id is not a UUID', async () => {
  const res = await request(app.getHttpServer())
    .get('/api/v1/leads/not-a-uuid')
    .set('Authorization', `Bearer ${rmToken}`)
    .expect(400);

  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(res.body.error.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'id' }),
    ]),
  );
});
```

### TC-051-06: DPO masking

```typescript
it('masks dob, omits internal notes, masks mobile and PAN for DPO role', async () => {
  const { leadId } = await factory.createLead();
  await factory.createNote({ leadId, isInternal: true });

  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${dpoToken}`)
    .expect(200);

  expect(res.body.data.identity.dob).toBeUndefined();
  expect(res.body.data.notes).toHaveLength(0);  // internal notes hidden for DPO
  expect(res.body.data.identity.mobile).toMatch(/x/);
});
```

### TC-051-07: DPO access is audited

```typescript
it('writes an audit_log row for view_sensitive when DPO accesses the lead', async () => {
  const { leadId } = await factory.createLead();
  await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${dpoToken}`)
    .expect(200);

  const auditRows = await db
    .selectFrom('audit_logs')
    .selectAll()
    .where('entity_type', '=', 'lead')
    .where('entity_id', '=', leadId)
    .where('action', '=', 'view_sensitive')
    .execute();

  expect(auditRows.length).toBeGreaterThanOrEqual(1);
  expect(auditRows[0].actor_id).toBe(dpoUser.userId);
});
```

### TC-051-08: PARTNER cannot see another partner's lead

```typescript
it('returns NOT_FOUND when PARTNER A requests a lead submitted by PARTNER B', async () => {
  const { leadId } = await factory.createLead({ partnerId: partnerB.partnerId });
  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${partnerAToken}`)
    .expect(404);

  expect(res.body.error.code).toBe('NOT_FOUND');
});
```

### TC-051-09: PARTNER sees only non-internal notes

```typescript
it('filters out internal notes for PARTNER callers', async () => {
  const { leadId } = await factory.createLead({ partnerId: partnerA.partnerId });
  await factory.createNote({ leadId, isInternal: true, body: 'Internal RM note' });
  await factory.createNote({ leadId, isInternal: false, body: 'Customer note' });

  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${partnerAToken}`)
    .expect(200);

  expect(res.body.data.notes).toHaveLength(1);
  expect(res.body.data.notes[0].body).toBe('Customer note');
});
```

### TC-051-10: Soft-deleted lead returns 404

```typescript
it('returns NOT_FOUND for a soft-deleted lead', async () => {
  const { leadId } = await factory.createLead();
  await db.updateTable('leads').set({ deleted_at: new Date() }).where('lead_id', '=', leadId).execute();

  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${rmToken}`)
    .expect(404);

  expect(res.body.error.code).toBe('NOT_FOUND');
});
```

### TC-051-11: Partial data — empty sub-sections

```typescript
it('returns empty arrays/nulls for sub-sections with no data, not errors', async () => {
  const { leadId } = await factory.createLead({ ownerId: rmUser.userId });
  // No stageHistory, no eligibilitySnapshot, no notes, no duplicateMatches seeded

  const res = await request(app.getHttpServer())
    .get(`/api/v1/leads/${leadId}`)
    .set('Authorization', `Bearer ${rmToken}`)
    .expect(200);

  expect(res.body.data.stageHistory).toEqual([]);
  expect(res.body.data.eligibilitySnapshot).toBeNull();
  expect(res.body.data.notes).toEqual([]);
  expect(res.body.data.duplicateMatches).toEqual([]);
  expect(res.body.data.documentSummary.total).toBe(0);
});
```

### TC-051-12: Consent de-duplication — latest-per-purpose wins (Unit)

```typescript
// apps/api/src/modules/workspace/lead360.service.spec.ts
describe('Lead360Service.deduplicateConsents', () => {
  it('returns the newest state per purpose when multiple rows exist', () => {
    const rows = [
      { purpose: 'data_processing', state: 'withdrawn', created_at: new Date('2026-06-09') },
      { purpose: 'data_processing', state: 'granted', created_at: new Date('2026-06-10') },
      { purpose: 'eligibility_check', state: 'granted', created_at: new Date('2026-06-08') },
    ];
    const result = lead360Service.deduplicateConsents(rows);
    expect(result).toHaveLength(2);
    const dp = result.find(r => r.purpose === 'data_processing');
    expect(dp?.state).toBe('granted');  // newest row wins
  });
});
```

---

## SQL Invariant Queries

Run after each relevant test to assert no data corruption. Each must return 0 rows.

### INV-051-01: No `audit_logs` row has been updated or deleted by FR-051 (append-only check)

```sql
-- Expect 0 rows: audit_logs with updated_at significantly different from created_at
-- (append-only; existing rows must never be mutated by a view operation)
SELECT COUNT(*)
FROM audit_logs
WHERE lead_id = :leadId
  AND updated_at > created_at + INTERVAL '1 second';
-- Expected: 0
```

### INV-051-02: No `leads` row was written by a read-only 360 view

```sql
-- After calling GET /leads/:id, the lead's updated_at must not have changed
SELECT COUNT(*)
FROM leads
WHERE lead_id = :leadId
  AND updated_at > :timestampBeforeRequest;
-- Expected: 0 (GET is fully read-only; no mutation to leads permitted)
```

### INV-051-03: `stage_history` is not mutated by a view

```sql
SELECT COUNT(*)
FROM stage_history
WHERE lead_id = :leadId
  AND updated_at > created_at + INTERVAL '1 second';
-- Expected: 0
```

### INV-051-04: `consent_records` not mutated by a view

```sql
SELECT COUNT(*)
FROM consent_records
WHERE lead_id = :leadId
  AND updated_at > created_at + INTERVAL '1 second';
-- Expected: 0
```

---

## UI Test Scenarios

### Vitest + Testing Library (component unit tests)

| ID | Component | Scenario | Assertion |
|---|---|---|---|
| UI-051-01 | `Lead360View` | Renders loading skeleton while query is pending | `LoadingSkeleton` visible; tab content not rendered |
| UI-051-02 | `Lead360View` | Renders `ErrorState` when API returns 404 | `ErrorState` component present; error message displayed |
| UI-051-03 | `Lead360View` | `MaskedField` renders masked mobile | Component output matches `98xxxxxx10` pattern; no raw mobile in DOM |
| UI-051-04 | `Lead360View` | Tab navigation — clicking "Documents" tab shows `DocumentSummaryCard` | After click, `DocumentSummaryCard` is visible; "Overview" content not visible |
| UI-051-05 | `Lead360View` | Empty `stageHistory` shows `EmptyState` inside Stage Tracker card | `EmptyState` component rendered in stage tracker section |
| UI-051-06 | `LeadSummaryCard` | All `StatusChip` components render correct colours for stage values | Each `StatusChip` has expected `data-status` attribute |

### Playwright E2E (`apps/web/e2e/lead360.spec.ts`)

| ID | Scenario | Steps | Assertion |
|---|---|---|---|
| E2E-051-01 | Full tab navigation | Log in as RM; navigate to `/leads/:id`; click each tab trigger in order | Each tab panel renders without error; no broken layout |
| E2E-051-02 | Empty sections render gracefully | Lead with no documents; navigate to Documents tab | "No documents" empty state visible |
| E2E-051-03 | DPO masked view | Log in as DPO; navigate to `/leads/:id` | `dob` field absent from rendered output; mobile masked in DOM |
| E2E-051-04 | Keyboard tab navigation | Navigate to page; tab through all interactive elements | All tab triggers and internal links reachable via keyboard; focus ring visible |
| E2E-051-05 | PARTNER limited notes | Log in as PARTNER; navigate to their own lead with mixed notes | Only non-internal notes visible; internal note body absent from DOM |

---

## Coverage Checklist

| Requirement | Covered by |
|---|---|
| Happy path (200, all sections present) | TC-051-01 |
| Every error code the FR raises: `NOT_FOUND` (404) | TC-051-02, TC-051-03, TC-051-10 |
| Every error code the FR raises: `AUTH_REQUIRED` (401) | TC-051-04 |
| Every error code the FR raises: `VALIDATION_ERROR` (400) | TC-051-05 |
| Every error code the FR raises: `INTERNAL_ERROR` (500) | Covered by `AllExceptionsFilter` global test; no FR-specific scenario added |
| Authz negative — out-of-scope RM | TC-051-03 |
| Authz negative — cross-partner | TC-051-08 |
| Masking — DPO role (mobile, dob, notes) | TC-051-06 |
| DPO access audited | TC-051-07 |
| PARTNER filtered notes | TC-051-09 |
| Soft-delete respected | TC-051-10 |
| Partial data / empty sections | TC-051-11 |
| Consent de-duplication logic | TC-051-12 |
| Append-only invariants (audit_logs, stage_history, consent_records) | INV-051-01, INV-051-03, INV-051-04 |
| Lead not mutated by read | INV-051-02 |
| UI — loading/error/empty states | UI-051-01, UI-051-02, UI-051-05 |
| UI — masking in DOM | UI-051-03 |
| UI — tab navigation | UI-051-04, E2E-051-01 |
| Keyboard accessibility | E2E-051-04 |
