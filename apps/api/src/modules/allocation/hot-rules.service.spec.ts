/**
 * FR-031 unit tests — hot-lead flag & hot-rule engine.
 * Tests FR-031-tests.md T-01 through T-09 (unit tier; T-07/T-10–T-15 are API
 * integration / Testcontainers tier, deferred per manifest.json stage7.test_strategy).
 *
 * All tests run in-memory without a DB or NestJS container.
 */

import 'reflect-metadata';

import { HotReasonCode, EventCode } from '@lms/shared';

import type { PinoLogger } from 'nestjs-pino';
import { ScoringService } from './scoring.service';
import type { ScoringContext, ScoringRepository, ScoringConfig } from './scoring.repository';
import type { KyselyDb, DbTransaction } from '../../core/db';
import type { LeadService } from '../capture/lead.service';
import type { OutboxService } from '../../core/outbox';
import { ScoringAdapter } from './scoring.adapter';
import type { UnitOfWork } from '../../core/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger(): PinoLogger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger;
}

function makeRepo(context: ScoringContext, config: ScoringConfig | null = null): ScoringRepository {
  return {
    loadContext: jest.fn().mockResolvedValue(context),
    loadActiveScoringConfig: jest.fn().mockResolvedValue(config),
  } as unknown as ScoringRepository;
}

/** Minimal valid ScoringContext with all hot-rule fields set to NON-firing values. */
function baseCtx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    lead_id: 'lead-001',
    org_id: 'org-001',
    product_config_id: 'pc-001',
    pin_code: null,
    requested_amount: null,
    priority: 'normal',
    is_hot: false,
    pan_token: null,
    mobile: '9876543210',
    preferred_language: null,
    source: 'Branch',
    partner_id: null,
    pan_required_at: 'before_kyc',
    sla_config: null,
    partner_quality_score: null,
    partner_risk_category: null,
    partner_status: null,
    product_attributes: {},
    is_existing_customer: null,
    customer_doc_count: 0,
    has_positive_eligibility: false,
    has_callback_task: false,
    ...overrides,
  };
}

const MOCK_DB = {} as KyselyDb;

// ─── T-02: Each hot rule fires independently ─────────────────────────────────

describe('T-02 — each hot rule fires independently (H1–H8)', () => {
  it('H1 — PRIORITY_HIGH fires when priority=high', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ priority: 'high' });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.PRIORITY_HIGH);
  });

  it('H2 — AMOUNT_ABOVE_THRESHOLD fires when amount > product threshold', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({
      requested_amount: 600_000,
      sla_config: { hot_amount_threshold: 500_000 },
    });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.AMOUNT_ABOVE_THRESHOLD);
    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD);
  });

  it('H3 — RETURNING_CUSTOMER fires when is_existing_customer=true', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ is_existing_customer: true });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.RETURNING_CUSTOMER);
  });

  it('H4 — PARTNER_VERIFIED fires when partner has quality_score >= 70 and is active', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({
      partner_id: 'partner-001',
      partner_quality_score: 75,
      partner_status: 'active',
    });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.PARTNER_VERIFIED);
  });

  it('H5 — CUSTOMER_SUBMITTED_DOCS fires when customer_doc_count > 0', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ customer_doc_count: 1 });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.CUSTOMER_SUBMITTED_DOCS);
  });

  it('H6 — POSITIVE_LOS_INDICATIVE fires when has_positive_eligibility=true', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ has_positive_eligibility: true });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.POSITIVE_LOS_INDICATIVE);
  });

  it('H7 — HIGH_INTENT_EVENT fires when has_callback_task=true', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ has_callback_task: true });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.HIGH_INTENT_EVENT);
  });

  it('H8 — AMOUNT_ABOVE_DEFAULT_THRESHOLD fires when no product threshold and amount > 500k', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    // sla_config=null → falls back to default threshold
    const ctx = baseCtx({ requested_amount: 600_000, sla_config: null });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD);
    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_THRESHOLD);
  });

  it('no bleed — H1 fixture does not fire H2–H8', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ priority: 'high' });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_THRESHOLD);
    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD);
    expect(result.hotReasons).not.toContain(HotReasonCode.RETURNING_CUSTOMER);
    expect(result.hotReasons).not.toContain(HotReasonCode.PARTNER_VERIFIED);
    expect(result.hotReasons).not.toContain(HotReasonCode.CUSTOMER_SUBMITTED_DOCS);
    expect(result.hotReasons).not.toContain(HotReasonCode.POSITIVE_LOS_INDICATIVE);
    expect(result.hotReasons).not.toContain(HotReasonCode.HIGH_INTENT_EVENT);
  });
});

// ─── T-01: Score and hot flag set on create — priority high ──────────────────

describe('T-01 — evaluateHotRules: priority high + amount above threshold → isHot=true', () => {
  it('returns isHot=true with PRIORITY_HIGH and AMOUNT_ABOVE_THRESHOLD', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({
      priority: 'high',
      requested_amount: 1_000_000,
      sla_config: { hot_amount_threshold: 500_000 },
    });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.PRIORITY_HIGH);
    expect(result.hotReasons).toContain(HotReasonCode.AMOUNT_ABOVE_THRESHOLD);
  });
});

// ─── T-03: Lead cools when no rule fires ─────────────────────────────────────

describe('T-03 — cool-down path: no rule fires → isHot=false, COOLED reason', () => {
  it('returns isHot=false with COOLED reason when no rule fires', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    // All hot-rule fields are safe non-firing defaults in baseCtx()
    const ctx = baseCtx({ priority: 'normal', requested_amount: 100_000 });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(false);
    expect(result.hotReasons).toContain(HotReasonCode.COOLED);
  });
});

// ─── T-09: Product config missing hot_threshold — default applied ─────────────

describe('T-09 — default threshold when product config absent', () => {
  it('applies AMOUNT_ABOVE_DEFAULT_THRESHOLD when sla_config is null and amount > 500k', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ requested_amount: 600_000, sla_config: null });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(true);
    expect(result.hotReasons).toContain(HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD);
  });

  it('does NOT fire when sla_config is null and amount <= 500k', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ requested_amount: 400_000, sla_config: null });
    const result = service.evaluateHotRules(ctx);

    expect(result.isHot).toBe(false);
    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_DEFAULT_THRESHOLD);
    expect(result.hotReasons).not.toContain(HotReasonCode.AMOUNT_ABOVE_THRESHOLD);
  });
});

// ─── H4: Partner negative paths ──────────────────────────────────────────────

describe('H4 — PARTNER_VERIFIED negative paths', () => {
  it('does not fire when partner quality_score < 70', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({
      partner_id: 'partner-001',
      partner_quality_score: 60,
      partner_status: 'active',
    });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.PARTNER_VERIFIED);
  });

  it('does not fire when partner is not active', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({
      partner_id: 'partner-001',
      partner_quality_score: 80,
      partner_status: 'suspended',
    });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.PARTNER_VERIFIED);
  });

  it('does not fire when partner_id is null', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ partner_id: null, partner_quality_score: 90, partner_status: 'active' });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.PARTNER_VERIFIED);
  });
});

// ─── T-04, T-05, T-06: ScoringAdapter HOT_LEAD outbox transition tests ───────

describe('T-04/T-05/T-06 — ScoringAdapter HOT_LEAD outbox emission', () => {
  function makeOutbox(): OutboxService {
    return { emit: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
  }

  function makeLeads(): LeadService {
    return {
      setScore: jest.fn().mockResolvedValue(undefined),
      setHotFlag: jest.fn().mockResolvedValue(undefined),
    } as unknown as LeadService;
  }

  function makeUow(): UnitOfWork {
    // Simulate UnitOfWork.run by invoking the callback with a mock transaction
    const tx = {} as unknown as DbTransaction;
    return {
      run: jest.fn().mockImplementation(async (fn: (tx: DbTransaction) => Promise<void>) => {
        await fn(tx);
      }),
    } as unknown as UnitOfWork;
  }

  /**
   * Build a ScoringAdapter with mocked dependencies where repo.loadContext
   * returns the provided ScoringContext.
   */
  function makeAdapter(context: ScoringContext): {
    adapter: ScoringAdapter;
    outbox: OutboxService;
    leads: LeadService;
    outboxEmit: jest.MockedFunction<OutboxService['emit']>;
    leadsSetHotFlag: jest.MockedFunction<LeadService['setHotFlag']>;
  } {
    const scoring = new ScoringService(makeRepo(context), makeLogger());
    const repo = makeRepo(context);
    const outbox = makeOutbox();
    const leads = makeLeads();
    const uow = makeUow();
    const logger = makeLogger();

    const adapter = new ScoringAdapter(scoring, repo, uow, leads, outbox, logger);
    return {
      adapter,
      outbox,
      leads,
      outboxEmit: outbox.emit as jest.MockedFunction<OutboxService['emit']>,
      leadsSetHotFlag: leads.setHotFlag as jest.MockedFunction<LeadService['setHotFlag']>,
    };
  }

  it('T-04 — HOT_LEAD emitted on false→true transition (priority high, was not hot)', async () => {
    const context = baseCtx({ priority: 'high', is_hot: false });
    const { adapter, outboxEmit, leadsSetHotFlag } = makeAdapter(context);

    await adapter.evaluateAsync('lead-001');

    expect(leadsSetHotFlag).toHaveBeenCalledWith(
      'lead-001',
      true,
      expect.arrayContaining([HotReasonCode.PRIORITY_HIGH]),
      expect.anything(), // tx
    );
    expect(outboxEmit).toHaveBeenCalledTimes(1);
    expect(outboxEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_code: EventCode.HOT_LEAD,
        aggregate_id: 'lead-001',
        payload: expect.objectContaining({ triggered_by: 'scoring' }),
      }),
      expect.anything(), // tx
    );
  });

  it('T-05 — HOT_LEAD NOT emitted when already hot (idempotent re-score)', async () => {
    // Lead is already hot (is_hot=true), scoring resolves hot=true again
    const context = baseCtx({ priority: 'high', is_hot: true });
    const { adapter, outboxEmit, leadsSetHotFlag } = makeAdapter(context);

    await adapter.evaluateAsync('lead-001');

    // setHotFlag is still called (refreshes reasons)
    expect(leadsSetHotFlag).toHaveBeenCalledWith(
      'lead-001',
      true,
      expect.arrayContaining([HotReasonCode.PRIORITY_HIGH]),
      expect.anything(),
    );
    // But HOT_LEAD event must NOT be re-emitted
    expect(outboxEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_code: EventCode.HOT_LEAD }),
      expect.anything(),
    );
  });

  it('T-06 — HOT_LEAD NOT emitted on cool-down (was hot, no rule fires)', async () => {
    // Lead was hot (is_hot=true) but now no rule fires (priority normal, low amount)
    const context = baseCtx({ priority: 'normal', requested_amount: 100_000, is_hot: true });
    const { adapter, outboxEmit, leadsSetHotFlag } = makeAdapter(context);

    await adapter.evaluateAsync('lead-001');

    expect(leadsSetHotFlag).toHaveBeenCalledWith(
      'lead-001',
      false,
      expect.arrayContaining([HotReasonCode.COOLED]),
      expect.anything(),
    );
    // No HOT_LEAD event on cool-down
    expect(outboxEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_code: EventCode.HOT_LEAD }),
      expect.anything(),
    );
  });

  it('T-07 — scoring adapter error never throws (evaluateAsync returns null result)', async () => {
    // Repo throws → evaluateAsync must catch and return null result
    const repo = {
      loadContext: jest.fn().mockRejectedValue(new Error('DB timeout')),
      loadActiveScoringConfig: jest.fn(),
    } as unknown as ScoringRepository;
    const scoring = new ScoringService(repo, makeLogger());
    const outbox = makeOutbox();
    const leads = makeLeads();
    const uow = {
      run: jest.fn().mockImplementation(async (fn: (tx: DbTransaction) => Promise<void>) => {
        await fn({} as unknown as DbTransaction);
      }),
    } as unknown as UnitOfWork;
    const adapter = new ScoringAdapter(scoring, repo, uow, leads, outbox, makeLogger());

    const result = await adapter.evaluateAsync('lead-001');

    expect(result).toEqual({ score: null, reasons: null });
    // Must not throw
    await expect(adapter.evaluateAsync('lead-001')).resolves.not.toThrow();
  });
});

// ─── FR-011 shared-engine concern (owned by scoring.service.spec.ts) ────────
// T-08 below verifies that FR-031 hot-rule inputs do not perturb the FR-011
// clamp behaviour when all signals fire together. The canonical clamping tests
// live in scoring.service.spec.ts (T05/T06); this is the cross-FR integration
// check that hot-rule context fields do not break the ceiling.
// ────────────────────────────────────────────────────────────────────────────

describe('T-08 — hot rules do not affect score clamp (ScoringService.evaluate)', () => {
  it('score is clamped to 100 even when all signals fire', async () => {
    const context = baseCtx({
      priority: 'high',
      requested_amount: 1_000_000,
      sla_config: { hot_amount_threshold: 500_000 },
      pan_token: 'BBBPK1234C',
      pin_code: '411001',
      preferred_language: 'Hindi',
      partner_id: 'p1',
      partner_quality_score: 90,
      partner_status: 'active',
      product_attributes: { employment_type: 'salaried', asset_type: 'new', customer_type: 'business' },
    });
    const config: ScoringConfig = {
      clamp: [0, 100],
      factors: {
        mobile_verified: 50, pin_present: 50, requested_amount_present: 50,
        high_amount: 50, language_preference_set: 50, pan_present: 50,
        pan_missing_penalty: -15, partner_quality_good: 50, partner_high_risk: -10,
        source_high_rejection: -10, customer_type_business: 50, employment_type_present: 50,
        asset_details_present: 50,
      },
      params: {
        partner_quality_good_min: 70, partner_quality_poor_max: 40,
        penalised_sources: [], source_rejection_rate_threshold: null,
      },
    };
    const service = new ScoringService(makeRepo(context, config), makeLogger());
    const result = await service.evaluate('lead-001', MOCK_DB, 'org-001');

    expect(result.score).toBe(100);
  });
});

// ─── H3: Returning customer negative paths ───────────────────────────────────

describe('H3 — RETURNING_CUSTOMER negative paths', () => {
  it('does not fire when is_existing_customer is null (no customer profile)', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ is_existing_customer: null });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.RETURNING_CUSTOMER);
  });

  it('does not fire when is_existing_customer is false', () => {
    const service = new ScoringService(makeRepo(baseCtx()), makeLogger());
    const ctx = baseCtx({ is_existing_customer: false });
    const result = service.evaluateHotRules(ctx);

    expect(result.hotReasons).not.toContain(HotReasonCode.RETURNING_CUSTOMER);
  });
});

// ─── AllocationModule seam: ScoringAdapter constructor includes ScoringRepository ──

describe('AllocationModule wiring — ScoringAdapter includes ScoringRepository', () => {
  it('ScoringRepository is listed in AllocationModule providers', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const allocationModule = require('./allocation.module') as Record<string, unknown>;
    const AllocationModuleCls = allocationModule['AllocationModule'] as Function;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScoringRepository: ScoringRepoClass } = require('./scoring.repository') as { ScoringRepository: unknown };

    const providers = (Reflect.getMetadata('providers', AllocationModuleCls) ?? []) as unknown[];
    expect(providers).toContain(ScoringRepoClass);
  });
});
