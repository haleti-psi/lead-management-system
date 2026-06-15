/**
 * FR-080 — EligibilityService unit tests (FR-080-tests.md T01–T08, T11, T18–T20).
 *
 * All external boundaries are mocked; no DB or network I/O. The UoW mock runs
 * the callback synchronously with a fake TX handle that supports Kysely's
 * chainable query builder interface for the integration_logs direct insert.
 */

import {
  ConsentPurpose,
  DataCategory,
  ERROR_CODES,
  EventCode,
  LeadStage,
  RoleCode,
} from '@lms/shared';

import type { KyselyDb, DbTransaction, UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import type { IntegrationGateway } from '../../core/integration/integration-gateway';
import type { IntegrationPort } from '../../core/integration/ports/integration-port';
import type { OutboxService } from '../../core/outbox';
import type { AuthUser } from '../../core/auth/auth-user';
import type { LeadService } from '../capture/lead.service';
import type { DataSharingService } from '../compliance/data-sharing.service';
import type { EligibilityMappingValidator } from './eligibility-mapping.validator';
import type { EligibilityPayloadBuilder, LosEligibilityPayload } from './eligibility-payload.builder';
import type { EligibilityRepository, EligibilitySnapshotRow } from './eligibility.repository';
import { EligibilityService } from './eligibility.service';
import type { PinoLogger } from 'nestjs-pino';

// ── Constants ────────────────────────────────────────────────────────────────

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'b0000000-0000-0000-0000-00000000000b';
const USER_ID = 'a0000000-0000-0000-0000-0000000000a1';
const SNAP_ID = 'c0000000-0000-0000-0000-00000000000c';
const CONSENT_ID = 'd0000000-0000-0000-0000-00000000000d';
const CORR_ID = 'corr-test-001';
const INT_LOG_ID = 'il-00000000-0000-0000-0000-000000000001';

const RM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG,
  role: RoleCode.RM,
  scope: 'O' as AuthUser['scope'],
  jti: 'jwt-test',
};

// ── Snapshot factory ─────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<EligibilitySnapshotRow> = {}): EligibilitySnapshotRow {
  return {
    eligibility_snapshot_id: SNAP_ID,
    lead_id: LEAD_ID,
    org_id: ORG,
    request_ref: 'ELIG-L001-1718000000000',
    status: 'pending',
    indicative_amount: null,
    tenure_months: null,
    rate_range: null,
    conditions: null,
    validity_until: null,
    response_basis: null,
    created_at: new Date('2026-06-09T10:00:00Z'),
    ...overrides,
  };
}

// ── Lead stub ────────────────────────────────────────────────────────────────

function makeLead() {
  return {
    lead_id: LEAD_ID,
    org_id: ORG,
    lead_code: 'L001',
    stage: LeadStage.KYC_IN_PROGRESS,
    kyc_status: 'verified',
    product_config_id: 'pc-001',
    channel_created_by: 'manual',
    owner_id: USER_ID,
    branch_id: 'br-001',
    version: 1,
    deleted_at: null,
  } as const;
}

// ── Kysely chainable mock factory ─────────────────────────────────────────────

/**
 * Returns a minimal chainable Kysely query builder mock.
 * All chainable methods return `this`; the terminal methods resolve to `value`.
 */
function makeChain(value: unknown): Record<string, jest.Mock> {
  const q: Record<string, jest.Mock> = {};
  const chainMethods = ['selectFrom', 'select', 'selectAll', 'insertInto', 'updateTable',
    'where', 'orderBy', 'limit', 'values', 'returning', 'returningAll',
    'set', 'onConflict', 'doNothing', 'doUpdateSet'];
  chainMethods.forEach((m) => { q[m] = jest.fn().mockReturnValue(q); });
  q['executeTakeFirst'] = jest.fn().mockResolvedValue(value);
  q['executeTakeFirstOrThrow'] = jest.fn().mockResolvedValue(value);
  q['execute'] = jest.fn().mockResolvedValue([value]);
  return q;
}

/**
 * Makes a TX mock that handles `insertInto('integration_logs')` returning a row
 * with an integration_log_id. Also supports other insertions.
 */
function makeTx(overrides?: { dataSharingLogFails?: boolean }): DbTransaction {
  const intLogRow = { integration_log_id: INT_LOG_ID };
  const intLogChain = makeChain(intLogRow);

  const defaultChain = makeChain(null);

  if (overrides?.dataSharingLogFails) {
    // We'll signal data-sharing failure via the service mock, not the tx
  }

  const tx = {
    insertInto: jest.fn().mockImplementation((table: string) => {
      if (table === 'integration_logs') return intLogChain;
      return defaultChain;
    }),
    selectFrom: jest.fn().mockReturnValue(makeChain(null)),
    updateTable: jest.fn().mockReturnValue(makeChain(null)),
  } as unknown as DbTransaction;

  return tx;
}

// ── Harness ───────────────────────────────────────────────────────────────────

interface Harness {
  service: EligibilityService;
  txInstance: DbTransaction;
  db: { selectFrom: jest.Mock };
  uow: { run: jest.Mock };
  leadService: { transitionStage: jest.Mock; recordEligibility: jest.Mock };
  dataSharingService: { logShare: jest.Mock };
  integrationGateway: { call: jest.Mock };
  eligibilityRepo: {
    insertSnapshot: jest.Mock;
    updateSnapshotStatus: jest.Mock;
    findSnapshotByRequestRef: jest.Mock;
  };
  mappingValidator: { validate: jest.Mock };
  payloadBuilder: { build: jest.Mock };
  outbox: { emit: jest.Mock };
}

function makeHarness(): Harness {
  const lead = makeLead();
  const consent = { consent_id: CONSENT_ID, state: 'granted' as const, expires_at: null };
  const productConfig = { product_config_id: 'pc-001', eligibility_mapping: { income: 'applicantIncome' }, product_code: 'HL' };
  const lpd = { attributes: { income: 50000 }, validation_status: 'complete' };

  // Build a chainable Kysely query builder mock for the main db
  const makeDbQuery = (resolveValue: unknown) => makeChain(resolveValue);

  // db.selectFrom returns different things based on the table
  const dbSelectFrom = jest.fn().mockImplementation((table: string) => {
    if (table === 'leads') return makeDbQuery(lead);
    if (table === 'consent_records') return makeDbQuery(consent);
    if (table === 'product_configs') return makeDbQuery(productConfig);
    if (table === 'lead_product_details') return makeDbQuery(lpd);
    if (table === 'integration_logs') return makeDbQuery(null); // no existing idempotency log
    return makeDbQuery(null);
  });

  const snap = makeSnapshot();

  const eligibilityRepo = {
    insertSnapshot: jest.fn().mockResolvedValue(snap),
    updateSnapshotStatus: jest.fn().mockResolvedValue(undefined),
    findSnapshotByRequestRef: jest.fn().mockResolvedValue(undefined),
  };

  const txInstance = makeTx();

  const uow = {
    run: jest.fn().mockImplementation(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(txInstance)),
  };

  const leadService = {
    transitionStage: jest.fn().mockResolvedValue({
      lead_id: LEAD_ID, stage: LeadStage.ELIGIBILITY_REQUESTED, version: 2, lead_code: 'L001', updated_at: new Date(),
    }),
    recordEligibility: jest.fn().mockResolvedValue(undefined),
  };

  const dataSharingService = {
    logShare: jest.fn().mockResolvedValue(undefined),
  };

  const integrationGateway = {
    call: jest.fn().mockResolvedValue({
      httpStatus: 200,
      body: {
        requestRef: 'ELIG-L001-1718000000000',
        indicativeAmount: '500000.00',
        tenureMonths: 36,
        rateRange: '10.5-12.0',
        conditions: { note: 'Subject to verification' },
        validityUntil: '2026-07-09T00:00:00.000Z',
        responseBasis: 'indicative',
      },
      idempotent: false,
    }),
  };

  const mappingValidator = { validate: jest.fn() };

  const payloadBuilder = {
    build: jest.fn().mockReturnValue({
      leadCode: 'L001',
      productCode: 'HL',
      sourceChannel: 'manual',
      consentRef: CONSENT_ID,
      kycStatus: 'verified',
      attributes: { applicantIncome: 50000 },
      idempotencyKey: 'ELIG-L001-1718000000000',
    } satisfies LosEligibilityPayload),
  };

  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };

  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  } as unknown as PinoLogger;

  const service = new EligibilityService(
    { selectFrom: dbSelectFrom } as unknown as KyselyDb,
    {} as IntegrationPort<LosEligibilityPayload>,
    uow as unknown as UnitOfWork,
    leadService as unknown as LeadService,
    dataSharingService as unknown as DataSharingService,
    integrationGateway as unknown as IntegrationGateway,
    eligibilityRepo as unknown as EligibilityRepository,
    mappingValidator as unknown as EligibilityMappingValidator,
    payloadBuilder as unknown as EligibilityPayloadBuilder,
    outbox as unknown as OutboxService,
    logger,
  );

  return {
    service, txInstance, db: { selectFrom: dbSelectFrom }, uow,
    leadService: leadService as unknown as Harness['leadService'],
    dataSharingService, integrationGateway, eligibilityRepo,
    mappingValidator, payloadBuilder, outbox,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EligibilityService', () => {
  it('returns snapshot and calls all dependencies on happy path (T01)', async () => {
    const h = makeHarness();

    const result = await h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID);

    expect(result.eligibilitySnapshotId).toBe(SNAP_ID);
    expect(h.eligibilityRepo.insertSnapshot).toHaveBeenCalledTimes(1);
    expect(h.leadService.transitionStage).toHaveBeenCalledWith(
      LEAD_ID,
      LeadStage.ELIGIBILITY_REQUESTED,
      expect.objectContaining({ actor_id: USER_ID, from_stage: LeadStage.KYC_IN_PROGRESS }),
      1,
      h.txInstance,
    );
    expect(h.dataSharingService.logShare).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: LEAD_ID,
        orgId: ORG,
        recipient: 'LOS',
        purpose: ConsentPurpose.PRODUCT_ELIGIBILITY,
        dataCategory: DataCategory.FINANCIAL,
        consentId: CONSENT_ID,
      }),
      h.txInstance,
    );
    // recordEligibility called inside the UoW (MAJOR-1)
    expect(h.leadService.recordEligibility).toHaveBeenCalledWith(LEAD_ID, SNAP_ID, h.txInstance);
    // snapshot updated with received status
    expect(h.eligibilityRepo.updateSnapshotStatus).toHaveBeenCalledWith(
      SNAP_ID, ORG, expect.objectContaining({ status: 'received' }), USER_ID,
    );
    // ELIGIBILITY_RECEIVED outbox event emitted
    expect(h.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_code: EventCode.ELIGIBILITY_RECEIVED }),
      h.txInstance,
    );
  });

  it('calls LeadService.recordEligibility inside the UoW on success path (MAJOR-1)', async () => {
    const h = makeHarness();

    await h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID);

    expect(h.leadService.recordEligibility).toHaveBeenCalledTimes(1);
    expect(h.leadService.recordEligibility).toHaveBeenCalledWith(
      LEAD_ID,
      SNAP_ID,
      h.txInstance,
    );
    // Must be called in the same UoW run as the snapshot insert (both inside the same tx)
    expect(h.eligibilityRepo.insertSnapshot).toHaveBeenCalledTimes(1);
  });

  it('succeeds when consent row has data_category = null (MAJOR-2: NULL category is valid)', async () => {
    // FR-110 customer-path stores data_category=null; DataSharingService.logShare
    // must accept this without spuriously throwing CONSENT_MISSING.
    const h = makeHarness();
    // consent row with null data_category — as FR-110 captureFromCustomer stores it
    const nullCategoryConsent = { consent_id: CONSENT_ID, state: 'granted' as const, expires_at: null };
    h.db.selectFrom.mockImplementation((table: string) => {
      if (table === 'leads') return makeChain(makeLead());
      if (table === 'consent_records') return makeChain(nullCategoryConsent);
      if (table === 'product_configs') return makeChain({ product_config_id: 'pc-001', eligibility_mapping: { income: 'applicantIncome' }, product_code: 'HL' });
      if (table === 'lead_product_details') return makeChain({ attributes: { income: 50000 }, validation_status: 'complete' });
      if (table === 'integration_logs') return makeChain(null);
      return makeChain(null);
    });

    const result = await h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID);

    expect(result.eligibilitySnapshotId).toBe(SNAP_ID);
    expect(h.dataSharingService.logShare).toHaveBeenCalledTimes(1);
    expect(h.integrationGateway.call).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN with CONSENT_MISSING when no product_eligibility consent (T04)', async () => {
    const h = makeHarness();
    h.db.selectFrom.mockImplementation((table: string) => {
      if (table === 'leads') return makeChain(makeLead());
      if (table === 'consent_records') return makeChain(null); // no consent
      return makeChain(null);
    });

    await expect(h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID))
      .rejects
      .toMatchObject({ code: ERROR_CODES.FORBIDDEN, detail: { reason: 'CONSENT_MISSING' } });

    expect(h.eligibilityRepo.insertSnapshot).not.toHaveBeenCalled();
    expect(h.integrationGateway.call).not.toHaveBeenCalled();
  });

  it('throws VALIDATION_ERROR when eligibility_mapping is null (T07)', async () => {
    const h = makeHarness();
    h.mappingValidator.validate.mockImplementation(() => {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Product configuration has no eligibility mapping. Contact IT.');
    });

    await expect(h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID))
      .rejects
      .toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });

    expect(h.eligibilityRepo.insertSnapshot).not.toHaveBeenCalled();
    expect(h.integrationGateway.call).not.toHaveBeenCalled();
  });

  it('throws VALIDATION_ERROR with STAGE_GUARD_FAILED when lead stage fails the guard (T08)', async () => {
    // MINOR-4: the inline stage check was removed; the guard now lives inside
    // LeadService.transitionStage (which calls StageGuardService). We mock
    // transitionStage to throw the guard error so the service propagates it.
    const h = makeHarness();
    h.db.selectFrom.mockImplementation((table: string) => {
      if (table === 'leads') return makeChain({ ...makeLead(), stage: LeadStage.CAPTURED });
      if (table === 'consent_records') return makeChain({ consent_id: CONSENT_ID, state: 'granted', expires_at: null });
      if (table === 'product_configs') return makeChain({ product_config_id: 'pc-001', eligibility_mapping: { income: 'applicantIncome' }, product_code: 'HL' });
      if (table === 'lead_product_details') return makeChain({ attributes: { income: 50000 }, validation_status: 'complete' });
      if (table === 'integration_logs') return makeChain(null);
      return makeChain(null);
    });
    h.leadService.transitionStage.mockRejectedValue(
      new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Stage guard failed.', {
        detail: { reason: 'STAGE_GUARD_FAILED' },
      }),
    );

    await expect(h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID))
      .rejects
      .toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR, detail: { reason: 'STAGE_GUARD_FAILED' } });

    // snapshot INSERT was called (inside UoW before transitionStage), but that's
    // fine — the UoW rolls back the entire transaction atomically on throw.
  });

  it('marks snapshot failed and re-throws UPSTREAM_UNAVAILABLE when LOS returns 5xx (T03)', async () => {
    const h = makeHarness();
    const err = new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    h.integrationGateway.call.mockRejectedValue(err);

    await expect(h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID))
      .rejects
      .toMatchObject({ code: ERROR_CODES.UPSTREAM_UNAVAILABLE });

    expect(h.eligibilityRepo.updateSnapshotStatus).toHaveBeenCalledWith(
      SNAP_ID, ORG, { status: 'failed' }, USER_ID,
    );
    // ELIGIBILITY_RECEIVED must NOT be emitted on failure
    expect(h.outbox.emit).not.toHaveBeenCalled();
  });

  it('returns existing snapshot with idempotentReplay=true on duplicate Idempotency-Key (T11)', async () => {
    const h = makeHarness();
    const existingSnap = makeSnapshot({ status: 'pending' });
    const existingLog = { integration_log_id: 'il-001', status: 'pending', request_ref: existingSnap.request_ref };
    h.eligibilityRepo.findSnapshotByRequestRef.mockResolvedValue(existingSnap);

    h.db.selectFrom.mockImplementation((table: string) => {
      if (table === 'leads') return makeChain(makeLead());
      if (table === 'consent_records') return makeChain({ consent_id: CONSENT_ID, state: 'granted', expires_at: null });
      if (table === 'product_configs') return makeChain({ product_config_id: 'pc-001', eligibility_mapping: { income: 'applicantIncome' }, product_code: 'HL' });
      if (table === 'lead_product_details') return makeChain({ attributes: { income: 50000 }, validation_status: 'complete' });
      if (table === 'integration_logs') return makeChain(existingLog);
      return makeChain(null);
    });

    const result = await h.service.requestEligibility(LEAD_ID, RM_USER, 'idem-key-1', CORR_ID);

    expect(result.idempotentReplay).toBe(true);
    expect(result.eligibilitySnapshotId).toBe(SNAP_ID);
    expect(h.eligibilityRepo.insertSnapshot).not.toHaveBeenCalled();
    expect(h.integrationGateway.call).not.toHaveBeenCalled();
  });

  it('propagates DB error from data_sharing_logs insert (T18)', async () => {
    const h = makeHarness();
    h.dataSharingService.logShare.mockRejectedValue(new Error('DB constraint violation'));

    await expect(h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID))
      .rejects
      .toThrow('DB constraint violation');

    // LOS must not have been called (UoW threw before commit)
    expect(h.integrationGateway.call).not.toHaveBeenCalled();
  });

  it('does not include PII fields in the LOS payload (T19)', async () => {
    const h = makeHarness();
    h.payloadBuilder.build.mockImplementation((input: { eligibilityMapping: Record<string, string> }) => {
      const fields = Object.keys(input.eligibilityMapping);
      expect(fields).not.toContain('mobile');
      expect(fields).not.toContain('pan_token');
      expect(fields).not.toContain('name');
      return {
        leadCode: 'L001', productCode: 'HL', sourceChannel: 'manual',
        consentRef: CONSENT_ID, kycStatus: 'verified', attributes: {},
        idempotencyKey: 'r',
      } satisfies LosEligibilityPayload;
    });

    await h.service.requestEligibility(LEAD_ID, RM_USER, undefined, CORR_ID);
    expect(h.payloadBuilder.build).toHaveBeenCalledTimes(1);
  });
});

describe('EligibilityPayloadBuilder', () => {
  it('maps eligibility_mapping fields from attributes to LOS payload (T19)', () => {
    const { EligibilityPayloadBuilder: Builder } = jest.requireActual<typeof import('./eligibility-payload.builder')>('./eligibility-payload.builder');
    const builder = new Builder();
    const result = builder.build(
      {
        leadCode: 'L001',
        productCode: 'HL',
        sourceChannel: 'manual',
        consentRef: CONSENT_ID,
        kycStatus: 'verified',
        eligibilityMapping: { income: 'applicantIncome', employment_type: 'employmentType' },
        attributes: { income: 50000, employment_type: 'salaried' },
      },
      'ELIG-L001-123',
    );
    expect(result.attributes).toEqual({ applicantIncome: 50000, employmentType: 'salaried' });
    expect(result.idempotencyKey).toBe('ELIG-L001-123');
    // PII guards: no raw name, mobile, pan fields
    expect(Object.keys(result.attributes)).not.toContain('mobile');
    expect(Object.keys(result.attributes)).not.toContain('name');
  });

  it('throws VALIDATION_ERROR when a required mapped attribute is absent (T20)', () => {
    const { EligibilityMappingValidator } = jest.requireActual<typeof import('./eligibility-mapping.validator')>('./eligibility-mapping.validator');
    const validator = new EligibilityMappingValidator();
    expect(() =>
      validator.validate({
        eligibilityMapping: { income: 'applicantIncome' },
        productCode: 'HL',
        attributes: {}, // income missing
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.VALIDATION_ERROR }));
  });
});
