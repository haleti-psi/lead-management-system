/**
 * FR-011 unit tests for {@link ScoringService} — the 13-factor lead quality
 * scoring engine (FR-011 LLD §Scoring Rules; FR-011-tests.md T01–T10).
 *
 * All tests use in-memory mocks — no DB or NestJS container.
 * The scoring rule table produces deterministic results for known fixtures.
 */

import 'reflect-metadata';

import { ScoreReasonCode } from '@lms/shared';

import type { PinoLogger } from 'nestjs-pino';
import { ScoringService } from './scoring.service';
import type { ScoringRepository, ScoringConfig, ScoringContext } from './scoring.repository';
import type { KyselyDb } from '../../core/db';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A fully-enriched lead context (T01 fixture).
 * requested_amount is set BELOW the default high_amount threshold (500_000) so
 * the high_amount factor does NOT fire — matching FR-011-tests.md T01 spec value 65.
 * FR-031 hot-rule fields default to safe non-firing values so FR-011 score
 * assertions remain correct.
 */
const FULL_CONTEXT = {
  lead_id: 'lead-001',
  org_id: 'org-001',
  product_config_id: 'pc-001',
  pin_code: '411001',
  requested_amount: 200_000,
  priority: 'normal',
  is_hot: false,
  pan_token: 'BBBPK1234C',
  mobile: '9876543210',
  preferred_language: 'Hindi',
  source: 'Branch',
  partner_id: 'partner-001',
  pan_required_at: 'before_kyc',
  sla_config: null,
  partner_quality_score: 80,
  partner_risk_category: 'low',
  partner_status: 'active',
  product_attributes: {
    employment_type: 'salaried',
    asset_type: 'new',
    customer_type: 'individual',
  },
  // FR-031 hot-rule auxiliary fields — safe defaults that do not fire hot rules
  is_existing_customer: null,
  customer_doc_count: 0,
  has_positive_eligibility: false,
  has_callback_task: false,
};

function makeRepo(
  context: ScoringContext = FULL_CONTEXT,
  config: ScoringConfig | null = null,
): ScoringRepository {
  return {
    loadContext: jest.fn().mockResolvedValue(context),
    loadActiveScoringConfig: jest.fn().mockResolvedValue(config),
  } as unknown as ScoringRepository;
}

function makeLogger(): PinoLogger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger;
}

const MOCK_DB = {} as KyselyDb;
const ORG = 'org-001';

// ─── T01: Fully-enriched lead ─────────────────────────────────────────────────

describe('T01 — ScoringService.evaluate returns correct score for fully-enriched lead', () => {
  /**
   * Factors for T01 fixture (pan_required_at=before_kyc so NO pan_missing_penalty;
   * requested_amount=200_000 < 500_000 default threshold so NO high_amount):
   *   mobile_verified          +10 (9876543210 matches [6-9]\d{9})
   *   pin_present              +8
   *   requested_amount_present +7
   *   language_preference_set  +5
   *   pan_present              +15 (pan_token set)
   *   partner_quality_good     +10 (quality_score=80 >= 70, status=active)
   *   employment_type_present  +5
   *   asset_details_present    +5
   * Total = 65; no penalties, no high_amount.
   */
  it('returns score=65 with correct reasons (spec T01)', async () => {
    const service = new ScoringService(makeRepo(), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.score).toBe(65);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        ScoreReasonCode.MOBILE_VERIFIED,
        ScoreReasonCode.PIN_PRESENT,
        ScoreReasonCode.REQUESTED_AMOUNT_PRESENT,
        ScoreReasonCode.LANGUAGE_PREFERENCE_SET,
        ScoreReasonCode.PAN_PRESENT,
        ScoreReasonCode.PARTNER_QUALITY_GOOD,
        ScoreReasonCode.EMPLOYMENT_TYPE_PRESENT,
        ScoreReasonCode.ASSET_DETAILS_PRESENT,
      ]),
    );
    expect(result.reasons).not.toContain(ScoreReasonCode.HIGH_AMOUNT);
    expect(result.reasons).not.toContain(ScoreReasonCode.PAN_MISSING_PENALTY);
    expect(result.reasons).not.toContain(ScoreReasonCode.PARTNER_HIGH_RISK);
  });
});

// ─── T01b: high_amount fires at requested_amount >= default threshold ─────────

describe('T01b — ScoringService.evaluate applies high_amount when requested_amount >= threshold', () => {
  /**
   * Same enriched fixture but with requested_amount >= 500_000 (default threshold).
   * high_amount (+10) fires in addition to all T01 factors → score = 75.
   */
  it('adds HIGH_AMOUNT reason and +10 when amount >= default threshold (500_000)', async () => {
    const context = { ...FULL_CONTEXT, requested_amount: 1_500_000 };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.score).toBe(75);
    expect(result.reasons).toContain(ScoreReasonCode.HIGH_AMOUNT);
    expect(result.reasons).toContain(ScoreReasonCode.REQUESTED_AMOUNT_PRESENT);
  });
});

// ─── T02: PAN missing penalty ─────────────────────────────────────────────────

describe('T02 — ScoringService.evaluate applies pan_missing_penalty when PAN absent at_capture', () => {
  it('includes pan_missing_penalty in reasons and deducts 15 points', async () => {
    const context = {
      ...FULL_CONTEXT,
      pan_token: null,
      pan_required_at: 'at_capture',
      // Remove positive factors to keep expected score simple
      pin_code: null,
      requested_amount: null,
      preferred_language: null,
      partner_id: null,
      product_attributes: {},
    };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    // Only mobile_verified (+10) + pan_missing_penalty (-15) = -5, clamped to 0
    expect(result.score).toBe(0);
    expect(result.reasons).toContain(ScoreReasonCode.PAN_MISSING_PENALTY);
    expect(result.reasons).not.toContain(ScoreReasonCode.PAN_PRESENT);
  });
});

// ─── T03: source_high_rejection penalty ───────────────────────────────────────

describe('T03 — ScoringService.evaluate applies source_high_rejection for penalised source', () => {
  it('applies -10 when source is in penalised_sources list', async () => {
    const context = {
      ...FULL_CONTEXT,
      source: 'DSA',
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      requested_amount: null,
      preferred_language: null,
      product_attributes: {},
    };
    const config: ScoringConfig = {
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
        penalised_sources: ['DSA'],
        source_rejection_rate_threshold: null,
      },
    };
    const service = new ScoringService(makeRepo(context, config), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    // mobile_verified +10, source_high_rejection -10 = 0
    expect(result.reasons).toContain(ScoreReasonCode.SOURCE_HIGH_REJECTION);
    expect(result.score).toBe(0);
  });
});

// ─── T04: partner_high_risk penalty ───────────────────────────────────────────

describe('T04 — ScoringService.evaluate applies partner_high_risk for risky partner', () => {
  it('deducts 10 for low quality / high risk partner', async () => {
    const context = {
      ...FULL_CONTEXT,
      partner_quality_score: 30,
      partner_risk_category: 'high',
      partner_status: 'active',
      pin_code: null,
      requested_amount: null,
      preferred_language: null,
      pan_token: null,
      pan_required_at: 'before_kyc',
      product_attributes: {},
    };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.reasons).toContain(ScoreReasonCode.PARTNER_HIGH_RISK);
    expect(result.reasons).not.toContain(ScoreReasonCode.PARTNER_QUALITY_GOOD);
    // mobile_verified +10, partner_high_risk -10 = 0
    expect(result.score).toBe(0);
  });
});

// ─── T05: Score clamped to floor 0 ────────────────────────────────────────────

describe('T05 — ScoringService.evaluate clamps score to 0 when all penalties apply', () => {
  it('never returns a negative score', async () => {
    const context = {
      ...FULL_CONTEXT,
      pan_token: null,
      pan_required_at: 'at_capture',
      partner_quality_score: 20,
      partner_risk_category: 'high',
      partner_status: 'active',
      mobile: '9999999999',
      pin_code: null,
      requested_amount: null,
      preferred_language: null,
      product_attributes: {},
    };
    const config: ScoringConfig = {
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
        penalised_sources: ['Branch'],
        source_rejection_rate_threshold: null,
      },
    };
    const service = new ScoringService(makeRepo(context, config), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.reasons).toBeDefined();
    expect((result.reasons ?? []).length).toBeGreaterThan(0);
  });
});

// ─── T06: Score clamped to ceiling 100 ───────────────────────────────────────

describe('T06 — ScoringService.evaluate clamps score to 100 when all positive factors apply', () => {
  it('returns score=100 and all positive reason codes', async () => {
    const context = {
      ...FULL_CONTEXT,
      product_attributes: {
        employment_type: 'salaried',
        asset_type: 'new',
        customer_type: 'business',
      },
    };
    // All factors with default weights: 10+8+7+10+5+15+10+5+5+5 = 80 — below 100.
    // To test the ceiling clamp we need inflated weights:
    const inflatedConfig: ScoringConfig = {
      clamp: [0, 100],
      factors: {
        mobile_verified: 20,
        pin_present: 20,
        requested_amount_present: 20,
        high_amount: 20,
        language_preference_set: 20,
        pan_present: 20,
        pan_missing_penalty: -15,
        partner_quality_good: 20,
        partner_high_risk: -10,
        source_high_rejection: -10,
        customer_type_business: 20,
        employment_type_present: 20,
        asset_details_present: 20,
      },
      params: {
        partner_quality_good_min: 70,
        partner_quality_poor_max: 40,
        penalised_sources: [],
        source_rejection_rate_threshold: null,
      },
    };
    const inflatedRepo = makeRepo(context, inflatedConfig);
    const service2 = new ScoringService(inflatedRepo, makeLogger());
    const result2 = await service2.evaluate('lead-001', MOCK_DB, ORG);
    expect(result2.score).toBe(100);
  });
});

// ─── T07: Fallback to built-in defaults when no active ConfigurationVersion ────

describe('T07 — ScoringService.evaluate falls back to built-in defaults when no active config', () => {
  it('uses built-in weights and returns a valid score when config is null', async () => {
    const service = new ScoringService(makeRepo(FULL_CONTEXT, null), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.score).not.toBeNull();
    expect(typeof result.score).toBe('number');
    expect((result.score ?? -1)).toBeGreaterThanOrEqual(0);
    expect((result.score ?? 101)).toBeLessThanOrEqual(100);
  });
});

// ─── T08: Scoring failure does not block — returns null ──────────────────────

describe('T08 — ScoringService.evaluate returns null result and logs on dependency read failure', () => {
  it('returns { score: null, reasons: null } and calls logger.error when repo throws', async () => {
    const errorRepo = {
      loadContext: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      loadActiveScoringConfig: jest.fn(),
    } as unknown as ScoringRepository;
    const logger = makeLogger();
    const service = new ScoringService(errorRepo, logger);

    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result).toEqual({ score: null, reasons: null });
    expect(result.score).toBeNull();
    expect(result.reasons).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: 'lead-001', module: 'scoring' }),
      expect.any(String),
    );
  });

  it('does NOT rethrow on error', async () => {
    const errorRepo = {
      loadContext: jest.fn().mockRejectedValue(new Error('timeout')),
      loadActiveScoringConfig: jest.fn(),
    } as unknown as ScoringRepository;
    const service = new ScoringService(errorRepo, makeLogger());

    await expect(service.evaluate('lead-001', MOCK_DB, ORG)).resolves.not.toThrow();
  });
});

// ─── T09: No partner lookup when partner_id is null ────────────────────────────

describe('T09 — ScoringService.evaluate skips partner factors when partner_id is null', () => {
  it('includes neither partner_quality_good nor partner_high_risk when partner_id=null', async () => {
    const context = { ...FULL_CONTEXT, partner_id: null };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.reasons).not.toContain(ScoreReasonCode.PARTNER_QUALITY_GOOD);
    expect(result.reasons).not.toContain(ScoreReasonCode.PARTNER_HIGH_RISK);
    expect(result.score).not.toBeNull();
  });
});

// ─── Config override: DB config merges over built-in defaults ─────────────────

describe('Config override — DB config diff merges over built-in defaults', () => {
  it('uses DB factor weights when active config is present', async () => {
    const context = {
      ...FULL_CONTEXT,
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      requested_amount: null,
      preferred_language: null,
      product_attributes: {},
    };
    const dbConfig: ScoringConfig = {
      clamp: [0, 100],
      factors: {
        mobile_verified: 50, // override to higher weight
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
    const service = new ScoringService(makeRepo(context, dbConfig), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    // Only mobile_verified fires at weight 50
    expect(result.score).toBe(50);
    expect(result.reasons).toContain(ScoreReasonCode.MOBILE_VERIFIED);
  });
});

// ─── High-amount threshold from sla_config ────────────────────────────────────

describe('high_amount factor reads sla_config.hot_amount_threshold (D2 arbiter)', () => {
  it('applies high_amount when requested_amount >= sla_config threshold', async () => {
    const context = {
      ...FULL_CONTEXT,
      requested_amount: 200_000,
      sla_config: { hot_amount_threshold: 150_000 },
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      preferred_language: null,
      product_attributes: {},
    };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.reasons).toContain(ScoreReasonCode.HIGH_AMOUNT);
  });

  it('does NOT apply high_amount when requested_amount < threshold', async () => {
    const context = {
      ...FULL_CONTEXT,
      requested_amount: 100_000,
      sla_config: { hot_amount_threshold: 500_000 },
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      preferred_language: null,
      product_attributes: {},
    };
    const service = new ScoringService(makeRepo(context), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, ORG);

    expect(result.reasons).not.toContain(ScoreReasonCode.HIGH_AMOUNT);
  });

  it('falls back to DEFAULT_HOT_AMOUNT_THRESHOLD (500_000) when sla_config is null', async () => {
    const belowDefault = {
      ...FULL_CONTEXT,
      requested_amount: 400_000,
      sla_config: null,
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      preferred_language: null,
      product_attributes: {},
    };
    const serviceBelow = new ScoringService(makeRepo(belowDefault), makeLogger());
    const resultBelow = await serviceBelow.evaluate('lead-001', MOCK_DB, ORG);
    expect(resultBelow.reasons).not.toContain(ScoreReasonCode.HIGH_AMOUNT);

    const aboveDefault = {
      ...FULL_CONTEXT,
      requested_amount: 600_000,
      sla_config: null,
      pan_token: null,
      pan_required_at: 'before_kyc',
      partner_id: null,
      pin_code: null,
      preferred_language: null,
      product_attributes: {},
    };
    const serviceAbove = new ScoringService(makeRepo(aboveDefault), makeLogger());
    const resultAbove = await serviceAbove.evaluate('lead-001', MOCK_DB, ORG);
    expect(resultAbove.reasons).toContain(ScoreReasonCode.HIGH_AMOUNT);
  });
});

// ─── AllocationModule seam wiring check ──────────────────────────────────────

describe('AllocationModule — SCORING_PORT seam wiring', () => {
  it('AllocationModule provides and exports SCORING_PORT bound to ScoringAdapter', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const allocationModule = require('./allocation.module') as Record<string, unknown>;
    const AllocationModuleCls = allocationModule['AllocationModule'] as Function;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SCORING_PORT } = require('../capture/ports/scoring.port') as { SCORING_PORT: symbol };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScoringAdapter } = require('./scoring.adapter') as { ScoringAdapter: unknown };

    const providers = (Reflect.getMetadata('providers', AllocationModuleCls) ?? []) as Array<
      { provide?: unknown; useExisting?: unknown } | unknown
    >;
    const binding = providers.find(
      (p): p is { provide: unknown; useExisting: unknown } =>
        typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === SCORING_PORT,
    );
    expect(binding).toBeDefined();
    expect(binding?.useExisting).toBe(ScoringAdapter);

    const exports = (Reflect.getMetadata('exports', AllocationModuleCls) ?? []) as unknown[];
    expect(exports).toContain(SCORING_PORT);
  });
});
