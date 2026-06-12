import {
  ConsentActor,
  ConsentPurpose,
  ConsentState,
  ConsentStatus,
  CreationChannel,
  ERROR_CODES,
  LeadSource,
  MobileSchema,
  PanTiming,
  RoleCode,
} from '@lms/shared';

import { MaskingService } from '../../core/masking';
import { isDomainException } from '../../core/http';
import type { UnitOfWork } from '../../core/db';
import { CaptureService, sniffImportFileKind, type CreateLeadContext } from './capture.service';
import { CreateLeadDto, SourceInputSchema, type ConsentInput } from './dto/create-lead.dto';
import type { CaptureIdempotencyService } from './capture-idempotency.service';
import type { CodeGenerator } from './code-generator.service';
import type { CustomerProfileRepository } from './customer-profile.repository';
import type { LeadIdentityRepository } from './lead-identity.repository';
import type { LeadService } from './lead.service';
import type { SourceAttributionRepository } from './source-attribution.repository';
import type { AllocationPort } from './ports/allocation.port';
import type { DuplicateCheckPort } from './ports/duplicate-check.port';
import type { ImportFileStorePort } from './ports/import-file-store.port';
import type { ScoringPort } from './ports/scoring.port';

/**
 * FR-010 unit + component tests for {@link CaptureService} — the unit rows
 * U-01..U-11 of FR-010-tests.md plus component-level analogues of the deferred
 * Testcontainers tier (atomic grouping inside one UnitOfWork tx, duplicate
 * block, idempotent replay, partner checks, masking — A/I/M analogues noted
 * inline). All collaborators are mocked; the UnitOfWork fake passes a sentinel
 * tx so "same transaction" is asserted structurally.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const ACTOR = 'a0000000-0000-0000-0000-00000000000a';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';

const grant = (purpose: ConsentPurpose): ConsentInput => ({
  purpose,
  state: ConsentState.GRANTED,
  actor: ConsentActor.RM,
  notice_version: 'v2.1',
  consent_text_version: 'v2.1',
});

function validDto(overrides: Partial<CreateLeadDto> = {}): CreateLeadDto {
  return CreateLeadDto.parse({
    product_code: 'CV',
    identity: { name: 'Ramesh Kumar', mobile: '9876543210' },
    source: { source: 'Branch' },
    consents: [
      {
        purpose: 'lead_contact',
        state: 'granted',
        actor: 'rm',
        notice_version: 'v2.1',
        consent_text_version: 'v2.1',
      },
    ],
    ...overrides,
  });
}

interface Harness {
  service: CaptureService;
  db: { executeTakeFirst: jest.Mock };
  uowRun: jest.Mock;
  leadService: { create: jest.Mock; appendStageHistory: jest.Mock };
  identities: { insert: jest.Mock };
  profiles: { upsertByMobile: jest.Mock };
  attributions: { insert: jest.Mock };
  audit: { append: jest.Mock };
  outbox: { emit: jest.Mock };
  idempotency: { get: jest.Mock; set: jest.Mock };
  entitlements: { loadActorEntitlement: jest.Mock };
  duplicates: { matchSync: jest.Mock; matchAsync: jest.Mock };
  scoring: { evaluateAsync: jest.Mock };
  allocation: { allocate: jest.Mock };
  productDetailInsert: jest.Mock;
  consentInsert: jest.Mock;
}

/**
 * Kysely read stub: returns canned rows per table for the pre-transaction
 * SELECTs (`product_configs`, `branches`, `partners`).
 */
interface SelectChainMock {
  where: jest.Mock;
  select: jest.Mock;
  limit: jest.Mock;
  executeTakeFirst: jest.Mock;
}

function fakeDb(rows: {
  product_config?: { product_config_id: string; pan_required_at: PanTiming } | undefined;
  branch?: { branch_id: string } | undefined;
  partner?: { partner_id: string } | undefined;
}): { executeTakeFirst: jest.Mock; selectFrom: jest.Mock } {
  const executeTakeFirst = jest.fn();
  const selectFrom = jest.fn((table: string) => {
    const chain: SelectChainMock = {
      where: jest.fn(() => chain),
      select: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      executeTakeFirst: jest.fn(async () => {
        if (table === 'product_configs') return rows.product_config;
        if (table === 'branches') return rows.branch;
        if (table === 'partners') return rows.partner;
        return undefined;
      }),
    };
    return chain;
  });
  return { executeTakeFirst, selectFrom } as never;
}

/** Transaction stub recording inserts into lead_product_details / consent_records. */
function fakeTx(harness: Pick<Harness, 'productDetailInsert' | 'consentInsert'>): unknown {
  return {
    insertInto: jest.fn((table: string) => {
      const execute =
        table === 'lead_product_details' ? harness.productDetailInsert : harness.consentInsert;
      return { values: jest.fn(() => ({ execute })) };
    }),
  };
}

function makeHarness(opts: {
  productConfig?: { product_config_id: string; pan_required_at: PanTiming };
  branch?: { branch_id: string };
  partner?: { partner_id: string };
  cachedIdempotent?: unknown;
  dupResult?: { blocked: boolean; matches: unknown[] };
  partnerEntitlement?: { partnerId: string | null } | undefined;
  /** FR-030 in-tx allocation outcome; defaults to the no-match pass-through. */
  allocationOutcome?: Record<string, unknown>;
} = {}): Harness {
  const productDetailInsert = jest.fn().mockResolvedValue(undefined);
  const consentInsert = jest.fn().mockResolvedValue(undefined);
  const tx = fakeTx({ productDetailInsert, consentInsert });

  const uowRun = jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  const leadService = {
    create: jest.fn().mockResolvedValue({ lead_id: LEAD_ID }),
    appendStageHistory: jest.fn().mockResolvedValue(undefined),
  };
  const identities = { insert: jest.fn().mockResolvedValue('identity-1') };
  const profiles = { upsertByMobile: jest.fn().mockResolvedValue('profile-1') };
  const attributions = { insert: jest.fn().mockResolvedValue('attribution-1') };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const idempotency = {
    get: jest.fn().mockResolvedValue(opts.cachedIdempotent),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const entitlements = {
    loadActorEntitlement: jest.fn().mockResolvedValue(opts.partnerEntitlement),
  };
  const duplicates = {
    matchSync: jest.fn().mockResolvedValue(opts.dupResult ?? { blocked: false, matches: [] }),
    matchAsync: jest.fn().mockResolvedValue(undefined),
  };
  const scoring = { evaluateAsync: jest.fn().mockResolvedValue(undefined) };
  const allocation = {
    allocate: jest.fn().mockResolvedValue(
      opts.allocationOutcome ?? {
        ownerId: null,
        teamId: null,
        stage: 'captured',
        version: 1,
        reason: 'no_rule_match',
        method: null,
        allocationRuleId: null,
      },
    ),
  };
  const codeGenerator = { nextLeadCode: jest.fn().mockResolvedValue('LD-2026-000123') };
  const files: ImportFileStorePort = {
    put: jest.fn().mockResolvedValue('imports/x/source.csv'),
    get: jest.fn(),
  } as never;
  const config = { get: jest.fn(() => 10), isProduction: false };
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

  const db = fakeDb({
    // 'productConfig' explicitly present (even as undefined) overrides the default.
    product_config:
      'productConfig' in opts
        ? opts.productConfig
        : { product_config_id: 'pc-1', pan_required_at: PanTiming.BEFORE_KYC },
    branch: opts.branch,
    partner: opts.partner,
  });

  const service = new CaptureService(
    db as never,
    { run: uowRun } as unknown as UnitOfWork,
    leadService as unknown as LeadService,
    identities as unknown as LeadIdentityRepository,
    profiles as unknown as CustomerProfileRepository,
    attributions as unknown as SourceAttributionRepository,
    codeGenerator as unknown as CodeGenerator,
    audit as never,
    outbox as never,
    new MaskingService(),
    idempotency as unknown as CaptureIdempotencyService,
    entitlements as never,
    config as never,
    duplicates as unknown as DuplicateCheckPort,
    scoring as unknown as ScoringPort,
    files,
    allocation as unknown as AllocationPort,
    logger as never,
  );

  return {
    service,
    db: db as never,
    uowRun,
    leadService,
    identities,
    profiles,
    attributions,
    audit,
    outbox,
    idempotency,
    entitlements,
    duplicates,
    scoring,
    allocation,
    productDetailInsert,
    consentInsert,
  };
}

function ctx(overrides: Partial<CreateLeadContext> = {}): CreateLeadContext {
  return {
    actorId: ACTOR,
    orgId: ORG,
    actorRole: RoleCode.RM,
    channel: CreationChannel.MANUAL,
    requestMeta: { ip: '10.0.0.1', userAgent: 'jest' },
    ...overrides,
  };
}

// ── consent_status derivation (U-01..U-03) ───────────────────────────────────

describe('CaptureService.deriveConsentStatus', () => {
  const service = makeHarness().service;

  it('U-01: derives consent_status=pending when no consents provided', () => {
    expect(service.deriveConsentStatus([])).toBe(ConsentStatus.PENDING);
    expect(service.deriveConsentStatus(undefined)).toBe(ConsentStatus.PENDING);
  });

  it('U-02: derives consent_status=partial when lead_contact granted', () => {
    expect(service.deriveConsentStatus([grant(ConsentPurpose.LEAD_CONTACT)])).toBe(
      ConsentStatus.PARTIAL,
    );
  });

  it('U-03: derives consent_status=captured when all required purposes granted', () => {
    const all = [
      ConsentPurpose.LEAD_CONTACT,
      ConsentPurpose.PRODUCT_ELIGIBILITY,
      ConsentPurpose.KYC,
      ConsentPurpose.DOCUMENT_PROCESSING,
      ConsentPurpose.LOS_HANDOFF,
    ].map(grant);
    expect(service.deriveConsentStatus(all)).toBe(ConsentStatus.CAPTURED);
  });

  it('derives consent_status=withdrawn for a lone withdrawn/denied lead_contact', () => {
    expect(
      service.deriveConsentStatus([
        { ...grant(ConsentPurpose.LEAD_CONTACT), state: ConsentState.WITHDRAWN },
      ]),
    ).toBe(ConsentStatus.WITHDRAWN);
    expect(
      service.deriveConsentStatus([
        { ...grant(ConsentPurpose.LEAD_CONTACT), state: ConsentState.DENIED },
      ]),
    ).toBe(ConsentStatus.WITHDRAWN);
  });
});

// ── PAN timing (U-04/U-05) ───────────────────────────────────────────────────

describe('CaptureService.validatePanTiming', () => {
  const service = makeHarness().service;

  it('U-04: throws VALIDATION_ERROR on identity.pan_token when pan_required_at=at_capture', () => {
    try {
      service.validatePanTiming(PanTiming.AT_CAPTURE, undefined);
      fail('expected VALIDATION_ERROR');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) {
        expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
        expect(err.fields).toEqual([
          { field: 'identity.pan_token', issue: 'PAN is required at capture for this product.' },
        ]);
      }
    }
  });

  it('U-05: allows PAN absent when pan_required_at=before_kyc', () => {
    expect(() => service.validatePanTiming(PanTiming.BEFORE_KYC, undefined)).not.toThrow();
  });

  it('passes when pan_required_at=at_capture and a token is present', () => {
    expect(() => service.validatePanTiming(PanTiming.AT_CAPTURE, 'tok_abc')).not.toThrow();
  });
});

// ── Zod schema rules (U-06..U-11) ────────────────────────────────────────────

describe('CreateLeadDto / shared schemas', () => {
  it('U-06: requires partner_code when source is DSA', () => {
    const parsed = SourceInputSchema.safeParse({ source: LeadSource.DSA });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('partner_code');
    }
  });

  it('U-07: requires partner_code when source is Dealer', () => {
    const parsed = SourceInputSchema.safeParse({ source: LeadSource.DEALER });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('partner_code');
    }
  });

  it('U-08: partner_code optional when source is Branch', () => {
    expect(SourceInputSchema.safeParse({ source: LeadSource.BRANCH }).success).toBe(true);
  });

  it('U-09: mobile regex rejects 5-digit number', () => {
    expect(MobileSchema.safeParse('12345').success).toBe(false);
  });

  it('U-10: mobile regex rejects number starting with 1', () => {
    expect(MobileSchema.safeParse('1234567890').success).toBe(false);
  });

  it('U-11: mobile regex accepts valid Indian mobile', () => {
    expect(MobileSchema.safeParse('9876543210').success).toBe(true);
  });

  it('A-14 analogue: rejects a source outside the lead_source enum', () => {
    const parsed = CreateLeadDto.safeParse({
      product_code: 'CV',
      identity: { name: 'X', mobile: '9876543210' },
      source: { source: 'Instagram' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('source.source');
    }
  });

  it('A-16 analogue: rejects a product_code outside the enum', () => {
    const parsed = CreateLeadDto.safeParse({
      product_code: 'BOAT',
      identity: { name: 'X', mobile: '9876543210' },
      source: { source: 'Branch' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('product_code');
    }
  });

  it('A-18 analogue: rejects a malformed pin_code', () => {
    const parsed = CreateLeadDto.safeParse({
      product_code: 'CV',
      identity: { name: 'X', mobile: '9876543210' },
      source: { source: 'Branch' },
      pin_code: 'ABC123',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path.join('.')).toBe('pin_code');
    }
  });
});

// ── createLead orchestration (component analogues of the deferred API tier) ──

describe('CaptureService.createLead', () => {
  it('A-01 analogue: writes all capture rows + audit + outbox in ONE transaction and returns masked payload', async () => {
    const h = makeHarness();
    const result = await h.service.createLead(validDto(), ctx());

    expect(h.uowRun).toHaveBeenCalledTimes(1);
    // Same sentinel tx flows to every write (atomicity, architecture §11).
    expect(h.identities.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ insertInto: expect.any(Function) }));
    expect(h.leadService.create).toHaveBeenCalledTimes(1);
    const createInput = h.leadService.create.mock.calls[0]?.[0];
    expect(createInput).toMatchObject({
      org_id: ORG,
      lead_code: 'LD-2026-000123',
      product_code: 'CV',
      owner_id: ACTOR, // RM owns own leads (scope O)
      channel_created_by: CreationChannel.MANUAL,
      consent_status: ConsentStatus.PARTIAL,
      import_job_id: null,
    });

    // E7 stage history: null → captured (A-11 analogue).
    expect(h.leadService.appendStageHistory).toHaveBeenCalledWith(
      expect.objectContaining({ from_stage: null, to_stage: 'captured', reason: 'Initial capture' }),
      expect.anything(),
    );
    // E8 audit lead_create (A-10 analogue) — entry-first signature, same tx.
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead_create',
        entity_type: 'leads',
        entity_id: LEAD_ID,
        lead_id: LEAD_ID,
        org_id: ORG,
        actor_id: ACTOR,
      }),
      expect.anything(),
    );
    // E9 outbox LEAD_CREATED (A-09 analogue) — OBJECT event form, same tx.
    expect(h.outbox.emit).toHaveBeenCalledWith(
      {
        event_code: 'LEAD_CREATED',
        aggregate_type: 'leads',
        aggregate_id: LEAD_ID,
        payload: { lead_id: LEAD_ID, lead_code: 'LD-2026-000123', product_code: 'CV', stage: 'captured' },
      },
      expect.anything(),
    );
    // E10 consent rows (A-08 analogue): one insert per consent provided.
    expect(h.consentInsert).toHaveBeenCalledTimes(1);
    // E6 product-detail stub.
    expect(h.productDetailInsert).toHaveBeenCalledTimes(1);

    // M-01/M-02: masked response, raw PII absent.
    expect(result.replayed).toBe(false);
    expect(result.data).toMatchObject({
      lead_id: LEAD_ID,
      lead_code: 'LD-2026-000123',
      stage: 'captured',
      duplicate_status: 'none',
      score: null,
      is_hot: false,
      mobile_masked: '98xxxxxx10',
      name_masked: 'Ramesh Kumar',
    });
    expect(JSON.stringify(result.data)).not.toContain('9876543210');

    // 5i/5j post-commit hooks fired.
    expect(h.scoring.evaluateAsync).toHaveBeenCalledWith(LEAD_ID);
    expect(h.duplicates.matchAsync).toHaveBeenCalledWith(LEAD_ID);
  });

  it('T34 analogue (FR-030): triggers allocation INSIDE the creating tx and reflects the assigned stage', async () => {
    const h = makeHarness({
      allocationOutcome: {
        ownerId: 'owner-rm-1',
        teamId: 'team-1',
        stage: 'assigned',
        version: 2,
        reason: 'rule:CV Branch Rule',
        method: 'round_robin',
        allocationRuleId: 'rule-1',
      },
    });

    const result = await h.service.createLead(validDto(), ctx());

    // E11: system-actor trigger with the fresh lead's version, same sentinel tx.
    expect(h.allocation.allocate).toHaveBeenCalledTimes(1);
    expect(h.allocation.allocate).toHaveBeenCalledWith(
      {
        leadId: LEAD_ID,
        orgId: ORG,
        actorId: '00000000-0000-0000-0000-000000000000',
        expectedVersion: 1,
      },
      expect.objectContaining({ insertInto: expect.any(Function) }),
    );
    // The 201 payload reflects the post-allocation stage (captured → assigned).
    expect(result.data.stage).toBe('assigned');
  });

  it('FR-030: an allocation failure inside the tx propagates (rollback) — no partial capture survives', async () => {
    const h = makeHarness();
    h.allocation.allocate.mockRejectedValueOnce(new Error('allocation exploded'));

    await expect(
      h.service.createLead(validDto(), ctx({ idempotencyKey: 'idem-fr030' })),
    ).rejects.toThrow('allocation exploded');
    // The throw happened inside uow.run — the real UnitOfWork rolls back; the
    // idempotency cache and post-commit hooks must not run.
    expect(h.idempotency.set).not.toHaveBeenCalled();
    expect(h.scoring.evaluateAsync).not.toHaveBeenCalled();
  });

  it('I-01/A-03 analogue: replays the cached payload without touching the DB', async () => {
    const cached = { lead_id: LEAD_ID, lead_code: 'LD-2026-000123' };
    const h = makeHarness({ cachedIdempotent: cached });

    const result = await h.service.createLead(validDto(), ctx({ idempotencyKey: 'idem-1' }));

    expect(result.replayed).toBe(true);
    expect(result.data).toEqual(cached);
    // I-02: no second lead/audit/outbox row.
    expect(h.uowRun).not.toHaveBeenCalled();
    expect(h.leadService.create).not.toHaveBeenCalled();
    expect(h.audit.append).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
    expect(h.idempotency.set).not.toHaveBeenCalled();
  });

  it('caches the response under the Idempotency-Key after a successful create', async () => {
    const h = makeHarness();
    await h.service.createLead(validDto(), ctx({ idempotencyKey: 'idem-2' }));
    expect(h.idempotency.set).toHaveBeenCalledWith(
      'create_lead',
      'idem-2',
      expect.objectContaining({ lead_id: LEAD_ID }),
    );
  });

  it('A-27 analogue: strong duplicate block → CONFLICT/DUPLICATE_BLOCKED, nothing persisted', async () => {
    const matches = [
      { lead_id: 'dup-1', lead_code: 'LD-2026-000100', confidence: 'strong', matched_on: ['mobile', 'pan'] },
    ];
    const h = makeHarness({ dupResult: { blocked: true, matches } });

    await expect(h.service.createLead(validDto(), ctx())).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      detail: { reason: 'DUPLICATE_BLOCKED', matches },
    });
    // Thrown inside uow.run → transaction rolls back; no lead insert happened.
    expect(h.leadService.create).not.toHaveBeenCalled();
    expect(h.outbox.emit).not.toHaveBeenCalled();
    expect(h.idempotency.set).not.toHaveBeenCalled();
  });

  it('A-28 analogue: weak/medium (non-blocking) duplicate result lets the lead through', async () => {
    const h = makeHarness({
      dupResult: { blocked: false, matches: [{ lead_id: 'x', lead_code: 'LD-1', confidence: 'weak', matched_on: ['name'] }] },
    });
    const result = await h.service.createLead(validDto(), ctx());
    expect(result.data.duplicate_status).toBe('none');
    expect(h.leadService.create).toHaveBeenCalledTimes(1);
  });

  it('A-30/A-31 analogue: outbox/audit failure inside the tx propagates (rollback) and skips the idempotency cache', async () => {
    const h = makeHarness();
    h.outbox.emit.mockRejectedValue(new Error('outbox insert failed'));

    await expect(
      h.service.createLead(validDto(), ctx({ idempotencyKey: 'idem-3' })),
    ).rejects.toThrow('outbox insert failed');
    // The throw happened inside uow.run — the real UnitOfWork rolls back; the
    // post-commit steps must not run.
    expect(h.idempotency.set).not.toHaveBeenCalled();
    expect(h.scoring.evaluateAsync).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR on product_code when no active ProductConfig exists', async () => {
    const h = makeHarness({ productConfig: undefined as never });
    await expect(h.service.createLead(validDto(), ctx())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'product_code', issue: 'No active configuration for this product.' }],
    });
  });

  it('A-17 analogue: PAN required at_capture but absent → VALIDATION_ERROR identity.pan_token', async () => {
    const h = makeHarness({ productConfig: { product_config_id: 'pc-1', pan_required_at: PanTiming.AT_CAPTURE } });
    await expect(h.service.createLead(validDto(), ctx())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'identity.pan_token', issue: 'PAN is required at capture for this product.' }],
    });
  });

  it('rejects an unknown/inactive branch_code with VALIDATION_ERROR', async () => {
    const h = makeHarness({ branch: undefined });
    await expect(
      h.service.createLead(validDto({ branch_code: 'NOPE-001' } as never), ctx()),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'branch_code', issue: 'Branch code not found or inactive.' }],
    });
  });

  it('A-02 analogue: resolves the partner for source=DSA and stores partner_id on the attribution', async () => {
    const h = makeHarness({ partner: { partner_id: 'partner-9' } });
    await h.service.createLead(
      validDto({ source: { source: LeadSource.DSA, partner_code: 'DSA-001' } } as never),
      ctx({ actorRole: RoleCode.BM }),
    );
    expect(h.attributions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ partner_id: 'partner-9', source: LeadSource.DSA }),
      expect.anything(),
    );
  });

  it('rejects an inactive/unknown partner with VALIDATION_ERROR "Partner is not active."', async () => {
    const h = makeHarness({ partner: undefined });
    await expect(
      h.service.createLead(
        validDto({ source: { source: LeadSource.DSA, partner_code: 'DSA-XXX' } } as never),
        ctx(),
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'source.partner_code', issue: 'Partner is not active.' }],
    });
  });

  it("A-24 analogue: PARTNER user submitting another partner's code → FORBIDDEN", async () => {
    const h = makeHarness({
      partner: { partner_id: 'partner-9' },
      partnerEntitlement: { partnerId: 'partner-OTHER' },
    });
    await expect(
      h.service.createLead(
        validDto({ source: { source: LeadSource.DSA, partner_code: 'DSA-001' } } as never),
        ctx({ actorRole: RoleCode.PARTNER }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(h.leadService.create).not.toHaveBeenCalled();
  });

  it('PARTNER user submitting their own partner_code is allowed', async () => {
    const h = makeHarness({
      partner: { partner_id: 'partner-9' },
      partnerEntitlement: { partnerId: 'partner-9' },
    });
    const result = await h.service.createLead(
      validDto({ source: { source: LeadSource.DSA, partner_code: 'DSA-001' } } as never),
      ctx({ actorRole: RoleCode.PARTNER }),
    );
    expect(result.replayed).toBe(false);
    // PARTNER is not RM — owner stays null for allocation.
    expect(h.leadService.create.mock.calls[0]?.[0]).toMatchObject({ owner_id: null });
  });

  it('non-RM roles do not self-assign ownership at capture', async () => {
    const h = makeHarness();
    await h.service.createLead(validDto(), ctx({ actorRole: RoleCode.BM }));
    expect(h.leadService.create.mock.calls[0]?.[0]).toMatchObject({ owner_id: null });
  });

  it('post-commit hook failures are logged, never thrown into the 201 path', async () => {
    const h = makeHarness();
    h.scoring.evaluateAsync.mockRejectedValue(new Error('queue down'));
    h.duplicates.matchAsync.mockRejectedValue(new Error('scan down'));
    await expect(h.service.createLead(validDto(), ctx())).resolves.toMatchObject({
      replayed: false,
    });
  });
});

// ── bulk accept (A-19/A-20/B-04 analogues) ───────────────────────────────────

describe('CaptureService.acceptBulkImport', () => {
  const csv = Buffer.from('product_code,name,mobile,source\nCV,Asha,9876543210,Branch\n', 'utf8');

  it('accepts a CSV and creates a queued import job', async () => {
    const h = makeHarness();
    // import_jobs insert goes through uow.run with a tx exposing insertInto →
    // returning → executeTakeFirstOrThrow; extend the fake tx for this call.
    const jobTx = {
      insertInto: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(() => ({
            executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ import_job_id: 'job-1' }),
          })),
        })),
      })),
    };
    h.uowRun.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(jobTx));

    const result = await h.service.acceptBulkImport(
      { size: csv.byteLength, buffer: csv },
      'idem-imp-1',
      { actorId: ACTOR, orgId: ORG },
    );
    expect(result).toEqual({
      replayed: false,
      job: { import_job_id: 'job-1', status: 'queued', total_rows: null },
    });
    expect(h.idempotency.set).toHaveBeenCalledWith(
      'import_leads',
      'idem-imp-1',
      expect.objectContaining({ import_job_id: 'job-1' }),
    );
  });

  it('B-04 analogue: same Idempotency-Key replays the original job, no second insert', async () => {
    const cached = { import_job_id: 'job-1', status: 'queued', total_rows: null };
    const h = makeHarness({ cachedIdempotent: cached });
    const result = await h.service.acceptBulkImport(
      { size: csv.byteLength, buffer: csv },
      'idem-imp-1',
      { actorId: ACTOR, orgId: ORG },
    );
    expect(result).toEqual({ replayed: true, job: cached });
    expect(h.uowRun).not.toHaveBeenCalled();
  });

  it('A-19 analogue: file above MAX_UPLOAD_MB → PAYLOAD_TOO_LARGE', async () => {
    const h = makeHarness();
    const big = { size: 11 * 1024 * 1024, buffer: Buffer.from('a') };
    await expect(
      h.service.acceptBulkImport(big, undefined, { actorId: ACTOR, orgId: ORG }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYLOAD_TOO_LARGE });
  });

  it('A-20 analogue: a PDF (binary, non-zip) → UNSUPPORTED_MEDIA', async () => {
    const h = makeHarness();
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x00, 0x01]),
    ]);
    await expect(
      h.service.acceptBulkImport({ size: pdf.byteLength, buffer: pdf }, undefined, {
        actorId: ACTOR,
        orgId: ORG,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.UNSUPPORTED_MEDIA });
  });

  it('missing file → VALIDATION_ERROR on field file', async () => {
    const h = makeHarness();
    await expect(
      h.service.acceptBulkImport(undefined, undefined, { actorId: ACTOR, orgId: ORG }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: [{ field: 'file', issue: 'File is required.' }],
    });
  });
});

// ── content sniffing ─────────────────────────────────────────────────────────

describe('sniffImportFileKind', () => {
  it('detects CSV text', () => {
    expect(sniffImportFileKind(Buffer.from('a,b,c\n1,2,3\n'))).toBe('csv');
  });

  it('detects XLSX by ZIP magic bytes', () => {
    expect(sniffImportFileKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe('xlsx');
  });

  it('rejects binary content (PDF) and empty buffers', () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from([0xe2, 0xe3, 0x00])]);
    expect(sniffImportFileKind(pdf)).toBeUndefined();
    expect(sniffImportFileKind(Buffer.alloc(0))).toBeUndefined();
  });
});
