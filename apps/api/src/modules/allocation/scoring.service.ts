import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { HotReasonCode, ScoreReasonCode, type ScoringResult } from '@lms/shared';

import type { KyselyDb, DbTransaction } from '../../core/db';
import { ScoringRepository, type ScoringConfig, type ScoringContext } from './scoring.repository';

/** Result of {@link ScoringService.evaluateHotRules}. */
export interface HotRuleResult {
  isHot: boolean;
  hotReasons: HotReasonCode[];
}

/**
 * Built-in default scoring weights and parameters (FR-011 LLD §317-335).
 * These are used when no active ConfigurationVersion(config_type='scoring_rules')
 * exists in the DB. The seed (V3__seed_default_scoring_rules.sql) mirrors these
 * values so both paths produce identical results on a fresh install.
 */
const BUILT_IN_CONFIG: ScoringConfig = {
  clamp: [0, 100],
  factors: {
    mobile_verified: 10,
    pin_present: 8,
    requested_amount_present: 7,
    high_amount: 10,
    language_preference_set: 5,
    pan_present: 15,
    pan_missing_penalty: -15,
    partner_quality_good: 10,
    partner_high_risk: -10,
    source_high_rejection: -10,
    customer_type_business: 5,
    employment_type_present: 5,
    asset_details_present: 5,
  },
  params: {
    partner_quality_good_min: 70,
    partner_quality_poor_max: 40,
    penalised_sources: [],
    source_rejection_rate_threshold: null,
  },
};

/**
 * Default hot-amount threshold (INR) used when `product_configs.sla_config` does
 * not contain `hot_amount_threshold` (D2 arbiter decision: canonical home is
 * `sla_config.hot_amount_threshold`; absent → this default).
 */
const DEFAULT_HOT_AMOUNT_THRESHOLD = 500_000;

/**
 * FR-011 — Lead quality scoring engine. Pure additive factor evaluation; reads
 * lead context and an active ConfigurationVersion (scoring_rules) from the DB,
 * merges the DB config over the built-in defaults, and computes a 0–100 score
 * with an array of ScoreReasonCode values.
 *
 * Scoring is best-effort: if evaluate() throws internally it is caught by the
 * caller (ScoringAdapter.evaluateAsync). The method itself is designed not to
 * throw — all errors are caught and return `{ score: null, reasons: null }`.
 *
 * Located in M4 allocation module per FR-011 LLD §File Locations.
 */
@Injectable()
export class ScoringService {
  constructor(
    private readonly repo: ScoringRepository,
    @InjectPinoLogger(ScoringService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Evaluate the 13-factor quality score for the given lead. Reads all necessary
   * context via Kysely (parameterised; all reads LIMIT-bounded by query structure
   * or single-row joins). The `db` parameter accepts either a transaction handle
   * (for in-transaction scoring) or the plain pool (for post-commit scoring).
   *
   * `preloadedContext` is optional: when the caller has already called
   * `ScoringRepository.loadContext` (e.g. ScoringAdapter loads it once and passes
   * it here so FR-031 hot-rule evaluation reuses the same rows — fixing the
   * double-load defect). When omitted, context is loaded internally as before,
   * preserving the FR-011 behaviour when evaluate() is called standalone.
   *
   * Returns `{ score: null, reasons: null }` on any internal error — callers must
   * not throw this upward; a structured log entry is emitted at level 'error'.
   */
  async evaluate(
    leadId: string,
    db: KyselyDb | DbTransaction,
    orgId: string,
    preloadedContext?: ScoringContext,
  ): Promise<ScoringResult> {
    try {
      const context = preloadedContext ?? await this.repo.loadContext(leadId, db);
      const dbConfig = await this.repo.loadActiveScoringConfig(orgId, db);
      const config = this.mergeConfig(dbConfig);
      return this.computeScore(context, config);
    } catch (err) {
      this.logger.error(
        { err, lead_id: leadId, module: 'scoring' },
        'ScoringService.evaluate failed — score will be null',
      );
      return { score: null, reasons: null };
    }
  }

  /**
   * Merge the DB-loaded config over the built-in defaults. Any factor or param
   * present in the DB config overrides the built-in value; missing keys fall back
   * to the built-in. Returns a valid ScoringConfig (never throws).
   */
  private mergeConfig(dbConfig: ScoringConfig | null): ScoringConfig {
    if (dbConfig == null) {
      return BUILT_IN_CONFIG;
    }
    return {
      clamp: dbConfig.clamp,
      factors: { ...BUILT_IN_CONFIG.factors, ...dbConfig.factors },
      params: { ...BUILT_IN_CONFIG.params, ...dbConfig.params },
    };
  }

  /**
   * Apply the 13 factors to the loaded context, accumulate the weighted sum,
   * clamp to [clampMin, clampMax], and return the result. No throws — all guard
   * paths produce safe defaults.
   */
  private computeScore(context: ScoringContext, config: ScoringConfig): ScoringResult {
    const f = config.factors;
    const p = config.params;
    const [clampMin, clampMax] = config.clamp;

    let raw = 0;
    const reasons: ScoreReasonCode[] = [];

    // Factor 1: mobile_verified — mobile present + valid format (10 digits Indian mobile)
    if (context.mobile != null && /^[6-9]\d{9}$/.test(context.mobile)) {
      raw += this.weight(f, 'mobile_verified');
      reasons.push(ScoreReasonCode.MOBILE_VERIFIED);
    }

    // Factor 2: pin_present
    if (context.pin_code != null) {
      raw += this.weight(f, 'pin_present');
      reasons.push(ScoreReasonCode.PIN_PRESENT);
    }

    // Factor 3: requested_amount_present
    if (context.requested_amount != null) {
      raw += this.weight(f, 'requested_amount_present');
      reasons.push(ScoreReasonCode.REQUESTED_AMOUNT_PRESENT);

      // Factor 4: high_amount — D2 arbiter: read from sla_config.hot_amount_threshold
      const threshold = this.hotAmountThreshold(context.sla_config);
      if (context.requested_amount >= threshold) {
        raw += this.weight(f, 'high_amount');
        reasons.push(ScoreReasonCode.HIGH_AMOUNT);
      }
    }

    // Factor 5: language_preference_set
    if (context.preferred_language != null) {
      raw += this.weight(f, 'language_preference_set');
      reasons.push(ScoreReasonCode.LANGUAGE_PREFERENCE_SET);
    }

    // Factor 6 / 7: PAN present bonus vs missing penalty
    if (context.pan_token != null) {
      raw += this.weight(f, 'pan_present');
      reasons.push(ScoreReasonCode.PAN_PRESENT);
    } else if (context.pan_required_at === 'at_capture') {
      raw += this.weight(f, 'pan_missing_penalty');
      reasons.push(ScoreReasonCode.PAN_MISSING_PENALTY);
    }

    // Factor 8 / 9: partner quality
    if (context.partner_id != null) {
      const qualityScore = context.partner_quality_score ?? 0;
      const riskCategory = context.partner_risk_category ?? '';
      const isActive = context.partner_status === 'active';

      if (isActive && qualityScore >= p.partner_quality_good_min) {
        raw += this.weight(f, 'partner_quality_good');
        reasons.push(ScoreReasonCode.PARTNER_QUALITY_GOOD);
      } else if (qualityScore < p.partner_quality_poor_max || riskCategory === 'high') {
        raw += this.weight(f, 'partner_high_risk');
        reasons.push(ScoreReasonCode.PARTNER_HIGH_RISK);
      }
    }

    // Factor 10: source_high_rejection — source in penalised list (D3: PENDING-BUSINESS; list is [] in seed)
    if (p.penalised_sources.includes(context.source)) {
      raw += this.weight(f, 'source_high_rejection');
      reasons.push(ScoreReasonCode.SOURCE_HIGH_REJECTION);
    }

    // Factor 11: customer_type_business
    if (context.product_attributes['customer_type'] === 'business') {
      raw += this.weight(f, 'customer_type_business');
      reasons.push(ScoreReasonCode.CUSTOMER_TYPE_BUSINESS);
    }

    // Factor 12: employment_type_present
    if (context.product_attributes['employment_type'] != null) {
      raw += this.weight(f, 'employment_type_present');
      reasons.push(ScoreReasonCode.EMPLOYMENT_TYPE_PRESENT);
    }

    // Factor 13: asset_details_present
    if (context.product_attributes['asset_type'] != null) {
      raw += this.weight(f, 'asset_details_present');
      reasons.push(ScoreReasonCode.ASSET_DETAILS_PRESENT);
    }

    // Guard: NaN / Infinity from factor accumulation must not reach the clamp.
    if (!Number.isFinite(raw)) {
      this.logger.error(
        { raw, lead_id: 'unknown', module: 'scoring' },
        'Score accumulator is not finite — returning null',
      );
      return { score: null, reasons: null };
    }
    const clamped = Math.max(clampMin, Math.min(clampMax, raw));
    const scoreInt = Math.round(clamped);

    return {
      score: scoreInt,
      reasons: reasons.length > 0 ? reasons : null,
    };
  }

  /**
   * Get the hot-amount threshold from sla_config JSONB (D2 arbiter decision).
   * Falls back to DEFAULT_HOT_AMOUNT_THRESHOLD when the key is absent or invalid.
   */
  private hotAmountThreshold(slaConfig: Record<string, unknown> | null): number {
    if (slaConfig == null) return DEFAULT_HOT_AMOUNT_THRESHOLD;
    const v = slaConfig['hot_amount_threshold'];
    return typeof v === 'number' && v > 0 ? v : DEFAULT_HOT_AMOUNT_THRESHOLD;
  }

  /** Get the numeric weight for a factor key; returns 0 if not found. */
  private weight(factors: Record<string, number>, key: string): number {
    return factors[key] ?? 0;
  }

  /**
   * FR-031 — Evaluate the eight hot rules (H1–H8) for the given scoring context.
   * Returns `{ isHot, hotReasons }`. A lead is hot if ANY rule fires. On cool-down
   * (no rule fires) `isHot=false` and `hotReasons=['COOLED']`. Never throws —
   * designed to be called from `evaluateAsync` after FR-011 score evaluation.
   */
  evaluateHotRules(context: ScoringContext): HotRuleResult {
    const hotReasons: HotReasonCode[] = [];
    const threshold = this.hotAmountThreshold(context.sla_config);
    const amount = context.requested_amount ?? 0;

    // H1 — Priority high
    if (context.priority === 'high') {
      hotReasons.push(HotReasonCode.PRIORITY_HIGH);
    }

    // H2 — Amount above product threshold (sla_config.hot_amount_threshold)
    // H8 — Amount above default threshold (fallback when product config absent)
    // Both use the same resolved threshold; the reason code differs by source.
    if (amount > 0) {
      const slaThreshold = this.resolvedHotThresholdSource(context.sla_config);
      if (amount > threshold) {
        hotReasons.push(
          slaThreshold === 'product' ? HotReasonCode.AMOUNT_ABOVE_THRESHOLD : HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD,
        );
      }
    }

    // H3 — Returning customer
    if (context.is_existing_customer === true) {
      hotReasons.push(HotReasonCode.RETURNING_CUSTOMER);
    }

    // H4 — Partner verified (partner_id set, quality_score >= 70, status active)
    if (
      context.partner_id != null &&
      context.partner_quality_score != null &&
      context.partner_quality_score >= 70 &&
      context.partner_status === 'active'
    ) {
      hotReasons.push(HotReasonCode.PARTNER_VERIFIED);
    }

    // H5 — Customer submitted docs (M8 not yet built → count=0, rule won't fire)
    if (context.customer_doc_count > 0) {
      hotReasons.push(HotReasonCode.CUSTOMER_SUBMITTED_DOCS);
    }

    // H6 — Positive LOS indicative (M9 not yet built → false, rule won't fire)
    if (context.has_positive_eligibility) {
      hotReasons.push(HotReasonCode.POSITIVE_LOS_INDICATIVE);
    }

    // H7 — High-intent callback event (M7 not yet built → false, rule won't fire)
    if (context.has_callback_task) {
      hotReasons.push(HotReasonCode.HIGH_INTENT_EVENT);
    }

    if (hotReasons.length > 0) {
      return { isHot: true, hotReasons };
    }

    // Cool-down: was hot but no rule fires now
    return { isHot: false, hotReasons: [HotReasonCode.COOLED] };
  }

  /**
   * Returns 'product' when sla_config contains a valid hot_amount_threshold,
   * 'default' otherwise. Used to pick the correct HotReasonCode (H2 vs H8).
   */
  private resolvedHotThresholdSource(slaConfig: Record<string, unknown> | null): 'product' | 'default' {
    if (slaConfig == null) return 'default';
    const v = slaConfig['hot_amount_threshold'];
    return typeof v === 'number' && v > 0 ? 'product' : 'default';
  }
}
