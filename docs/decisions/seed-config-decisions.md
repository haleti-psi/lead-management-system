# Seed & Config Decision Brief — AMBIGUITIES §D (D1–D4) gating FR-011 / FR-020 / FR-031

2026-06-12
Status: **SIGNED OFF** — Dev 1 (haleti-psi), 2026-06-12. All four RECs approved: D1 seed via `V3__seed_default_scoring_rules.sql`; D2 home = `sla_config.hot_amount_threshold` (FR-031 amended); D3 placeholders PENDING-BUSINESS; D4 constants (shipped in FR-020). Score-model ownership: **FR-011 owns `leads.score`; FR-031 owns `is_hot` only** (both LLDs annotated).
Resolves: `docs/lld/AMBIGUITIES.md` §D. All code claims verified against the built tree (Wave 1 + FR-010 + FR-030 + FR-040/041/042/130/131/132).

## D2 — `hot_amount_threshold` location

- The two LLDs disagree with each other: FR-011.md:324 reads `product_configs.sla_config.hot_amount_threshold`; FR-031.md:309,321,327 reads `product_configs.field_schema.hot_threshold` (default 500 000 INR when absent). Neither key exists in built M5.
- Built Zod: `SlaConfigSchema` is free-form `z.record(z.unknown())` — keys are NOT enumerated; numeric values must be positive integers, with an "(hours)" error message (`apps/api/src/modules/product-config/dto/product-config-schema.ts:81-91`). A rupee amount passes the refinement; only the "(hours)" wording is stale.
- `FieldSchemaSchema` is a strict `{groups:[...]}` object (`product-config-schema.ts:55-57`) wired into the create/update DTOs (`dto/create-product-config.dto.ts:30`). Zod strip-mode silently DROPS an extra `hot_threshold` key on every FR-040 API write — FR-031's home is unusable in the built code.
- FR-041 seed sets `sla_config` to NULL for all 7 products (`docs/data-model/migrations/V2__seed_product_configs.sql:53,70,87,104,121,138,155`); its `field_schema` is `{"required":[...]}` shape — business thresholds do not belong there.

REC: Canonical home = `sla_config.hot_amount_threshold` (FR-011 expectation holds); the one-line correction is to FR-031: amend FR-031.md:309/321/327 from `field_schema.hot_threshold` → `sla_config.hot_amount_threshold` (keep the 500 000 INR in-code default when the key/column is NULL); relax the "(hours)" wording at product-config-schema.ts:87 when next touched.

## D1 — scoring seed (`config_type='scoring_rules'`)

- FR-011.md:319-335 defines 13 additive factors incl. the PAN-missing (-15) and source-rejection (-10) penalties, clamped to [0,100]. Runtime: `ScoringService` loads the active `ConfigurationVersion` (config_type=`scoring_rules`, status=`active`) and merges its `diff` JSONB over BUILT-IN defaults; no active row → defaults (FR-011.md:337). The seed is therefore governance visibility, not a build blocker.
- Built governance (FR-132): `configuration_versions.config_type` is a free `VARCHAR(40)`, payload in `diff JSONB`, status enum pending/approved/rejected/active/rolled_back (`docs/data-model/schema.sql:1039-1058`, `:42`). Approval = `POST /admin/config/:id/approve|rollback` (`apps/api/src/modules/admin/config-governance.controller.ts:27,32,44`); pending rows are created by per-config write paths, not a generic endpoint (`config-governance.service.ts:48-49`). A config_type with NO registered activator (today: only `sla_policy`, `product_config`) is status-only governed — `scoring_rules` is legal with zero code change (`admin/activators/config-activator.port.ts:18`).
- Seed precedent: FR-041 inserts bootstrap rows directly at status='active' via Flyway, explicitly bypassing maker-checker (`V2__seed_product_configs.sql:7-13`). Follow it with `V3__seed_default_scoring_rules.sql` (FR-011.md:500 names "V005", but repo numbering is V1/V2 → next is V3): one row — default org, `config_ref` NULL, `version` 1, `maker_id` = system user `00000000-0000-0000-0000-000000000000`, `checker_id` NULL, `status` 'active', `effective_at` now(), `diff` =

```json
{ "clamp": [0, 100],
  "factors": {
    "mobile_verified": 10, "pin_present": 8, "requested_amount_present": 7,
    "high_amount": 10, "language_preference_set": 5,
    "pan_present": 15, "pan_missing_penalty": -15,
    "partner_quality_good": 10, "partner_high_risk": -10,
    "source_high_rejection": -10,
    "customer_type_business": 5, "employment_type_present": 5, "asset_details_present": 5 },
  "params": { "partner_quality_good_min": 70, "partner_quality_poor_max": 40,
              "penalised_sources": [], "source_rejection_rate_threshold": null } }
```

(`high_amount` compares against D2's product-level key, not a value in this row; `penalised_sources` per D3.)

REC: Seed exactly the FR-011 factor table via Flyway `V3__seed_default_scoring_rules.sql` at status='active' (FR-041 precedent); activation path thereafter = FR-132 `POST /admin/config/:id/approve` (status-only; no activator required); a maker write-path for new scoring_rules pending versions is post-MVP.

## D3 — penalised-source list

- Shape FR-011.md:330 expects: a list of `source_attributions.source` values (penalty -10) plus a "configurable threshold" on historical rejection rate — NO numeric threshold is stated anywhere in the LLD.
- Legal source values: `lead_source` enum `'DSA','Dealer','Branch','Website','Referral','Telecalling','Field'` (`schema.sql:51`).
- Placeholder (already embedded in the D1 diff above): `"penalised_sources": []`, `"source_rejection_rate_threshold": null` — the factor can never fire, so capture scoring is unaffected until business supplies values. Flag: **PENDING-BUSINESS**.

REC: Seed the empty list + null threshold inside the D1 row, marked PENDING-BUSINESS in the migration comment; business later supplies values as a new FR-132-governed version — no code change.

## D4 — duplicate-match thresholds

- FR-020's "thresholds" are a RULE TABLE, not tunable numbers: key-combination → confidence tier → default action (same `pan_token`+`mobile` = strong/block; same `pan_token` diff mobile = strong/warn→identity-review; same mobile no-PAN = medium/warn+flag; same `ckyc_id` = strong/block; gstin-proxy asset = strong/block; same `gstin`+`product_code` = medium/warn-link; fuzzy name+pin+source = weak/warn; highest-confidence wins; merged-master inherits) — FR-020.md:442-456. Only numeric knob: trigram similarity via the pg_trgm `%` operator at Postgres's default (0.3); the LLD sets no custom GUC (FR-020.md:248-262).
- The LLD already homes them: "match table thresholds are currently hardcoded in `DuplicateService`; a future Phase 1.5 `DuplicateConfig` table may make them configurable per NBFC" (FR-020.md:604).
- Recommendation: **constants** (exported rule table in a `duplicate.constants.ts` beside `DuplicateService`, M3 dedupe). Rationale: (1) it is what the signed LLD specifies — a ConfigurationVersion would need a write path and diff-merge logic FR-020 does not spec, and a new table contradicts the LLD's explicit Phase 1.5 deferral; (2) the rules are structural key-combinations, not business-tunable numbers — there is nothing to govern yet.

REC: Hardcode the FR-020 "Confidence Scoring Rules" table as exported constants; NO schema or api-contract amendment needed; write the resolution back into AMBIGUITIES.md D4 (constants now, `DuplicateConfig` table deferred to Phase 1.5).

## Ready to build?

| FR | Buildable now with best-effort seeds? | Remaining arbiter decisions |
|---|---|---|
| FR-011 scoring at capture | **YES** — built-in defaults fallback (FR-011.md:337); capture already exposes the hook (`apps/api/src/modules/capture/ports/scoring.port.ts:6-8`) and `LeadService.setScore` is built (`capture/lead.service.ts:395`); `ScoreReasonCode` enum not yet in `packages/shared` — added as part of this FR (FR-011.md:492) | Sign off D1 seed values + D2 home (the 3-line FR-031 amendment); D3 stays PENDING-BUSINESS (non-blocking) |
| FR-020 duplicate detection | **YES** — rules hardcoded per LLD (FR-020.md:604); capture's port awaits the service (`capture/ports/duplicate-check.port.ts:8`) | Sign off D4 = constants; nothing else |
| FR-031 hot-lead flag | **YES once D2 is signed** — hot-rule weights intentionally hardcoded for MVP (FR-031.md:350); 500 000 default applies silently (FR-031.md:309); `LeadService.setHotFlag` stub awaits wiring (`capture/lead.service.ts:484-485`) | D2 (which JSONB path to read) **plus one new call**: FR-011.md:319-335 and FR-031.md:333-348 define two DIFFERENT 0–100 score models writing the same `leads.score` — declare FR-011 owns `score` and FR-031 owns `is_hot` only (recommended), or reconcile the tables before dispatch |

Verdict: dispatch order FR-020 → FR-011 → FR-031. No schema migration needed beyond the V3 scoring seed; the only spec write-backs are the FR-031 threshold-path amendment (D2) and the score-model ownership note (FR-011 vs FR-031).
