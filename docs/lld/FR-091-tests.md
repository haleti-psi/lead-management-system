# FR-091 — Partner Lead Submission (Test Specification)
**Tier: 3 (Complex)** · **Source LLD:** `docs/lld/FR-091.md`

Test stack per `docs/contracts/testing-contract.md`: backend unit = **Jest** (`*.spec.ts`);
backend API integration = **Jest + supertest + Testcontainers-Postgres** (`*.e2e-spec.ts`);
frontend component = **Vitest + @testing-library/react** (`*.test.tsx`); E2E = **Playwright**
(`apps/web/e2e/*.spec.ts`). External services mocked via test doubles (no real providers). New-code
coverage ≥ 80% and 100% of the error-taxonomy paths this FR can raise.

Endpoints under test (prefix `/api/v1`):
- `POST /partners/leads` (`partnerCreateLead`)
- `GET /partners/leads` (`partnerListLeads`)

## Test Cases

| # | Title | Layer | Setup / Input | Expected result |
|---|---|---|---|---|
| T01 | Happy path — partner submits a lead | e2e API | PARTNER user, `partner_id=P1` active; active CV ProductConfig; valid `PartnerLeadCreateDto` | `201`; `data.lead_code` matches `LD-\d{4}-\d{6}`; `data.stage='captured'`; `name_masked`/`mobile_masked` present (raw absent); one `leads` row with `channel_created_by='partner'`; `source_attributions.partner_id=P1`, `source∈{DSA,Dealer}`; `lead_identities`, `lead_product_details` stub, `stage_history(from=null,to=captured)`, `audit_logs`, `event_outbox(LEAD_CREATED)` all written |
| T02 | Authz negative — RM cannot use partner endpoint | e2e API | RM user, valid body | `403 FORBIDDEN`; no `leads` row created |
| T03 | Authz negative — PARTNER with null `partner_id` | e2e API | PARTNER user, `users.partner_id=NULL`, valid body | `403 FORBIDDEN`; no write |
| T04 | Authz negative — unauthenticated | e2e API | no/expired JWT | `401 AUTH_REQUIRED` |
| T05 | Partner-active gate — suspended partner blocked | e2e API | PARTNER, `partners.status='suspended'`, valid body | `403 FORBIDDEN`; generic message; no partner internals or other-customer data in body; no `leads` row |
| T06 | Partner-active gate — expired partner blocked | e2e API | PARTNER, `partners.status='expired'` (or `valid_until` past), valid body | `403 FORBIDDEN`; no write |
| T07 | Validation — invalid mobile | e2e API | body `identity.mobile='12345'` | `400 VALIDATION_ERROR`; `fields[]` includes `{field:'identity.mobile'}`; no write |
| T08 | Validation — missing required field (name) | e2e API | body without `identity.name` | `400 VALIDATION_ERROR`; `fields[]` includes name; no write |
| T09 | Validation — no active ProductConfig | e2e API | `product_code` with no `status='active'` config | `400 VALIDATION_ERROR`; `fields[]` includes `product_code`; no write |
| T10 | Masked duplicate — strong duplicate blocks with no PII leak | e2e API | existing lead with same mobile+PAN under a **different** partner; partner submits matching identity | `409 CONFLICT`; `error.detail.reason='DUPLICATE_BLOCKED'`; message generic ("already exists"); body contains **no** matched `lead_id`, owner, name, mobile, or other partner id; **no new** `leads` row (tx rolled back) |
| T11 | Weak duplicate does not block | unit/e2e | identity producing only a weak/medium match | `201`; lead created with `duplicate_status='flagged'`; partner sees only the generic flag |
| T12 | Idempotency — replayed key returns original, no duplicate | e2e API | submit with `Idempotency-Key=K1`; resend identical body + `K1` | both responses `201` with **identical** `lead_id`/`lead_code`; exactly **one** `leads` row; one `integration_logs` row for `K1` |
| T13 | Transaction rollback — forced mid-write failure | e2e API (fault-injected) | mock `OutboxService.emit` (or audit append) to throw inside the tx | `500 INTERNAL_ERROR`; **zero** rows in `leads`, `lead_identities`, `source_attributions`, `lead_product_details`, `stage_history`, `event_outbox` for that attempt (full rollback) |
| T14 | Append-only — `stage_history` row immutable | e2e/SQL | after T01, attempt UPDATE/DELETE on the new `stage_history` row | DB rejects (trigger/REVOKE); row unchanged (see Invariant Q5) |
| T15 | Rate limit — mutation tier | e2e API | PARTNER fires > 60 POST/min | `429 RATE_LIMITED`; `Retry-After` header set |
| T16 | List own leads — partner sees only own, masked | e2e API | P1 has 2 leads, P2 has 1 lead; GET as P1 | `200`; `data` has 2 rows, all `partner_id=P1`; P2's lead absent; `name`/`mobile` masked; `score`/`owner_id` not serialized; `meta.pagination` present |
| T17 | List scope isolation — cross-partner never leaks | e2e API | GET as P2 | only P2's lead returned; P1 rows absent under all filters |
| T18 | List pagination & limit cap | e2e API | P1 has 30 leads; `?limit=200` then `?page=2&limit=25` | `limit` clamped to ≤100; page 2 returns the remaining 5; `meta.pagination.total=30` |
| T19 | Client cannot override source/partner/owner | unit | DTO with extra `source`, `partner_code='OTHER'`, `owner_id` | Zod `.strip()` removes them; created lead's `partner_id` = caller's `partner_id`, never `OTHER` |
| T20 | PAN-timing — required at capture | e2e API | ProductConfig `pan_required_at='at_capture'`; body without PAN | `400 VALIDATION_ERROR`; `fields[]` includes PAN; no write |
| T21 | Forced source mapping by partner type | unit | partner.type `DSA` vs `Dealer`/`Connector` | `source='DSA'` for DSA partners, `source='Dealer'` otherwise; `creator_channel='partner'`; satisfies `ck_source_attr_partner` |
| T22 | UI — submit form maps field errors inline | component (Vitest) | render `SubmitLeadDrawer`; submit invalid mobile; API returns `VALIDATION_ERROR.fields` | inline error shown on mobile field; no raw PII rendered |
| T23 | UI/E2E — duplicate feedback is generic | Playwright | partner submits a known duplicate | Toast shows generic "A lead with these details already exists."; **no** other-customer name/mobile/owner visible anywhere in the DOM |

(≥10 required for Tier 3 — 23 provided, covering happy path, every error code raised
[`AUTH_REQUIRED`, `FORBIDDEN`, `VALIDATION_ERROR`, `CONFLICT`/`DUPLICATE_BLOCKED`, `RATE_LIMITED`,
`INTERNAL_ERROR`], authz both ways, validation, boundaries, state-creation, idempotency,
transaction rollback, masking, append-only, and the partner-scope isolation invariant.)

## SQL Invariant Queries (each must return **0 rows**)

> Run after the relevant test; `:p1` = test partner P1, `:p2` = P2, `:org` = test org.

```sql
-- Q1. Every partner-channel lead is attributable to a partner (no orphan partner lead).
SELECT l.lead_id
FROM leads l
JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
WHERE l.org_id = :org
  AND l.channel_created_by = 'partner'
  AND sa.partner_id IS NULL;

-- Q2. A partner's leads are NEVER attributed to another partner (P-scope integrity).
--     After GET-as-P1 tests, no returned lead may belong to P2.
SELECT l.lead_id
FROM leads l
JOIN source_attributions sa ON sa.source_attribution_id = l.source_attribution_id
WHERE l.org_id = :org
  AND sa.partner_id = :p2
  AND l.lead_id IN ( /* lead_ids surfaced to P1 in T16/T17 */ );

-- Q3. No lead persisted for a blocked-duplicate attempt (T10) — by the submitted mobile.
SELECT l.lead_id
FROM leads l
JOIN lead_identities li ON li.lead_identity_id = l.lead_identity_id
WHERE l.org_id = :org
  AND li.mobile = :duplicate_mobile
  AND l.created_by = :p1_user           -- only the original (other-partner) lead may exist, not P1's
  AND sa_for(l) = :p1;                   -- pseudo: join source_attributions, partner_id = :p1

-- Q4. Idempotency — exactly one lead per idempotency key (T12); this returns extras (>0 = bug).
SELECT il.idempotency_key, COUNT(DISTINCT il.lead_id) AS leads_for_key
FROM integration_logs il
WHERE il.org_id = :org AND il.idempotency_key = 'K1'
GROUP BY il.idempotency_key
HAVING COUNT(DISTINCT il.lead_id) > 1;

-- Q5. Append-only — stage_history has no soft-delete/update artefact (occurred_at == created_at on insert).
--     (UPDATE/DELETE are rejected at the DB; this catches any in-app mutation slipping through.)
SELECT stage_history_id
FROM stage_history
WHERE updated_at <> created_at;

-- Q6. Transaction atomicity (T13) — no lead exists without its mandatory siblings.
SELECT l.lead_id
FROM leads l
WHERE l.org_id = :org
  AND l.channel_created_by = 'partner'
  AND ( NOT EXISTS (SELECT 1 FROM stage_history sh WHERE sh.lead_id = l.lead_id AND sh.to_stage = 'captured')
     OR NOT EXISTS (SELECT 1 FROM event_outbox eo WHERE eo.aggregate_id = l.lead_id AND eo.event_code = 'LEAD_CREATED')
     OR NOT EXISTS (SELECT 1 FROM lead_product_details lpd WHERE lpd.lead_id = l.lead_id) );

-- Q7. Every partner-created source_attribution satisfies the DSA/Dealer + partner_id rule.
SELECT sa.source_attribution_id
FROM source_attributions sa
WHERE sa.org_id = :org
  AND sa.creator_channel = 'partner'
  AND ( sa.partner_id IS NULL OR sa.source NOT IN ('DSA','Dealer') );
```

## UI Test Scenarios

| Scenario | Tool | Assertion |
|---|---|---|
| Submit lead — success | Playwright | Drawer form → submit → success Toast; new row appears in `DataTable` with masked name/mobile and `StatusChip` stage `captured` |
| Submit lead — validation | Vitest component | invalid mobile → inline field error via `EntityForm`; submit button blocked until corrected |
| Submit lead — duplicate (no leak) | Playwright | generic duplicate Toast; assert DOM contains **no** other-customer name/mobile/owner/lead_code |
| Submit lead — suspended partner | Playwright | clear "account cannot submit" message; no row added |
| My-leads — empty state | Vitest component | `EmptyState` rendered when `data=[]` |
| My-leads — masking | Vitest component | rendered cells show `MaskedField` output (`98xxxxxx10`), never raw mobile |
| My-leads — scope | Playwright | logged in as P1, only P1 leads visible; switching to P2 shows only P2 |
| Loading / error states | Vitest component | `LoadingSkeleton` while pending; `ErrorState` on API error |
| Accessibility | Playwright + axe | Partner Console core flow passes WCAG 2.1 AA (keyboard reachable, labels present) |

## Coverage Checklist

- [x] Happy path (T01)
- [x] Every error code the FR raises: `AUTH_REQUIRED` (T04), `FORBIDDEN` (T02/T03/T05/T06),
      `VALIDATION_ERROR` (T07/T08/T09/T20), `CONFLICT`+`DUPLICATE_BLOCKED` (T10),
      `RATE_LIMITED` (T15), `INTERNAL_ERROR` (T13)
- [x] Authorization both ways (allowed PARTNER vs denied RM / null-partner / unauth) (T01–T04)
- [x] Business authorization gate — suspended/expired partner (T05/T06)
- [x] Validation (field, schema, PAN-timing, no-active-config) (T07–T09, T20)
- [x] Boundaries — pagination/limit cap (T18)
- [x] State creation — `captured` + stage_history/audit/outbox written (T01, Q6)
- [x] Idempotency — replay returns original, no duplicate (T12, Q4)
- [x] Transaction rollback — forced mid-write failure (T13, Q6)
- [x] Masking — PII masked in create + list responses; internal fields omitted (T01/T16, UI)
- [x] Append-only — `stage_history` UPDATE/DELETE rejected (T14, Q5)
- [x] Partner-scope isolation — cross-partner reads/writes denied (T16/T17, Q2)
- [x] Client cannot override source/partner/owner (T19, Q7)
- [x] No-PII-leak on duplicate (T10, T23, Q3)
- [x] UI states (empty/loading/error), accessibility, generic-duplicate UX (UI scenarios)
- [n/a] External-service failure / `UPSTREAM_UNAVAILABLE` — FR-091 makes **no** synchronous external
      call (duplicate detection is internal; LOS/KYC are downstream); intentionally not applicable.
