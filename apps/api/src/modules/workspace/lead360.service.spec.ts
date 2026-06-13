import { ConsentPurpose, ConsentState, DocStatus, KycCheckStatus, RoleCode } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { MaskingService } from '../../core/masking';
import { DPO_VIEW_AUDIT_ACTION, DPO_VIEW_AUDIT_OP } from './workspace.constants';
import {
  type Lead360ConsentRow,
  type Lead360CoreRow,
  type Lead360Repository,
} from './lead360.repository';
import { Lead360Service } from './lead360.service';
import type { WorkspaceScopeContext } from './lead-list.service';

/**
 * FR-051 — unit tests per FR-051-tests.md. TC-051-12 (consent de-duplication)
 * runs verbatim; the API-integration cases (TC-051-01/02/03/06/07/08/09/10/11)
 * run as service-level analogues because the Testcontainers tier is deferred
 * (manifest stage7.test_strategy). The repository SQL (scope-in-SQL,
 * soft-delete, LIMIT bounds — TC-051-03/08/10's row cut) is asserted by the
 * compile-level `lead360.repository.spec.ts`.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = 'f6b7c1de-0000-4000-8000-000000000051';

const rm: AuthUser = { userId: 'rm-a', orgId: ORG, role: RoleCode.RM, scope: 'O', jti: 'j1' };
const dpo: AuthUser = { userId: 'dpo-1', orgId: ORG, role: RoleCode.DPO, scope: 'M', jti: 'j2' };
const partner: AuthUser = { userId: 'pu-1', orgId: ORG, role: RoleCode.PARTNER, scope: 'P', jti: 'j3' };

const rmCtx: WorkspaceScopeContext = {
  effectiveScope: 'O',
  predicate: { type: 'own', userId: 'rm-a' },
  maskingLevel: 'partial',
};
const dpoCtx: WorkspaceScopeContext = {
  effectiveScope: 'M',
  predicate: { type: 'masked', orgId: ORG },
  maskingLevel: 'strict',
};
const partnerCtx: WorkspaceScopeContext = {
  effectiveScope: 'P',
  predicate: { type: 'partner', partnerId: 'p-1' },
  maskingLevel: 'partial',
};

function coreRow(overrides: Partial<Lead360CoreRow> = {}): Lead360CoreRow {
  return {
    lead_id: LEAD_ID,
    lead_code: 'LD-2026-000042',
    stage: 'kyc_in_progress',
    priority: 'high',
    is_hot: true,
    score: 72,
    score_reasons: { income_level: 30, product_fit: 22, contact_quality: 20 },
    requested_amount: '500000.00',
    channel_created_by: 'manual',
    consent_status: 'captured',
    kyc_status: 'in_progress',
    duplicate_status: 'none',
    los_application_id: null,
    sla_first_contact_due_at: new Date('2026-06-11T03:30:00Z'),
    reopened_count: 0,
    nurture_next_at: null,
    created_at: new Date('2026-06-10T08:00:00Z'),
    updated_at: new Date('2026-06-10T14:00:00Z'),
    version: 5,
    product_code: 'CV',
    branch_id: 'branch-1',
    owner_id: 'rm-a',
    team_id: 'team-1',
    lead_identity_id: 'li-1',
    name: 'Rajesh Kumar',
    mobile: '9812345610',
    email: 'rajesh@example.com',
    pan_masked: 'ABCxxxx1F',
    gstin: null,
    dob: new Date('1990-01-15T00:00:00Z'),
    preferred_language: 'Hindi',
    customer_profile_id: 'cp-1',
    display_name: 'Rajesh Kumar',
    customer_type: 'individual',
    is_existing_customer: false,
    source: 'DSA',
    sub_source: 'field_visit',
    partner_id: 'p-1',
    campaign_code: null,
    utm: null,
    lead_product_detail_id: 'lpd-1',
    product_config_id: 'pc-1',
    attributes: { vehicle_type: 'truck' },
    validation_status: 'valid',
    branch_name: 'Mumbai North',
    owner_full_name: 'Anita RM',
    team_name: 'Mumbai North Team A',
    partner_code: 'DSA-001',
    partner_legal_name: 'Sunshine DSA Pvt Ltd',
    partner_status: 'active',
    partner_type: 'DSA',
    ...overrides,
  };
}

interface RepoMock {
  fetchCore: jest.Mock;
  fetchStageHistory: jest.Mock;
  fetchLatestEligibilitySnapshot: jest.Mock;
  fetchLatestLosMirror: jest.Mock;
  fetchDocumentStatusCounts: jest.Mock;
  fetchKycStatusCounts: jest.Mock;
  fetchOpenTaskCount: jest.Mock;
  fetchConsentRows: jest.Mock;
  fetchNotes: jest.Mock;
  fetchOpenDuplicateMatches: jest.Mock;
}

interface Harness {
  service: Lead360Service;
  repo: RepoMock;
  audit: { append: jest.Mock };
  logger: { error: jest.Mock };
}

/** `core: null` = the scope SQL returned no row (absent / deleted / out of scope). */
function makeHarness(core: Lead360CoreRow | null = coreRow()): Harness {
  const repo: RepoMock = {
    fetchCore: jest.fn().mockResolvedValue(core ?? undefined),
    fetchStageHistory: jest.fn().mockResolvedValue([
      {
        stage_history_id: 'sh-1',
        from_stage: 'assigned',
        to_stage: 'kyc_in_progress',
        actor_id: 'rm-a',
        reason: null,
        occurred_at: new Date('2026-06-10T10:00:00Z'),
      },
    ]),
    fetchLatestEligibilitySnapshot: jest.fn().mockResolvedValue(undefined),
    fetchLatestLosMirror: jest.fn().mockResolvedValue(undefined),
    fetchDocumentStatusCounts: jest.fn().mockResolvedValue([]),
    fetchKycStatusCounts: jest.fn().mockResolvedValue([]),
    fetchOpenTaskCount: jest.fn().mockResolvedValue(2),
    fetchConsentRows: jest.fn().mockResolvedValue([
      { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.GRANTED, created_at: new Date('2026-06-10T09:00:00Z') },
    ]),
    fetchNotes: jest.fn().mockResolvedValue([
      {
        note_id: 'n-1',
        author_id: 'rm-a',
        body: 'Applicant confirmed vehicle details.',
        is_internal: true,
        created_at: new Date('2026-06-10T11:00:00Z'),
      },
    ]),
    fetchOpenDuplicateMatches: jest.fn().mockResolvedValue([]),
  };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  const service = new Lead360Service(
    repo as unknown as Lead360Repository,
    new MaskingService(),
    audit as unknown as AuditAppender,
    logger as unknown as ConstructorParameters<typeof Lead360Service>[3],
  );
  return { service, repo, audit, logger };
}

describe('Lead360Service.getAggregate', () => {
  it('TC-051-01: returns the 360 aggregate for an RM viewing their own lead', async () => {
    const { service, repo } = makeHarness();
    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);

    expect(repo.fetchCore).toHaveBeenCalledWith(ORG, rmCtx.predicate, LEAD_ID);
    expect(dto.leadId).toBe(LEAD_ID);
    expect(dto.leadCode).toBe('LD-2026-000042');
    expect(dto.stage).toBe('kyc_in_progress');
    expect(dto.identity.mobile).toMatch(/^[6-9]\d{0,1}x+\d{2}$/); // masked
    expect(dto.identity.mobile).toBe('98xxxxxx10');
    expect(dto.identity.panMasked).toBe('ABCxxxx1F');
    expect(dto.identity.email).toBe('ra****@example.com');
    expect(dto.identity.name).toBe('Rajesh Kumar'); // partial level keeps full name
    expect(dto.identity.dob).toEqual(new Date('1990-01-15T00:00:00Z'));
    expect(dto.stageHistory).toHaveLength(1);
    expect(dto.stageHistory[0]).toEqual({
      stageHistoryId: 'sh-1',
      fromStage: 'assigned',
      toStage: 'kyc_in_progress',
      actorId: 'rm-a',
      reason: null,
      occurredAt: new Date('2026-06-10T10:00:00Z'),
    });
    expect(dto.openTaskCount).toBe(2);
    expect(dto.consentSummary).toEqual([
      { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.GRANTED },
    ]);
    expect(dto.branch).toEqual({ branchId: 'branch-1', name: 'Mumbai North' });
    expect(dto.owner).toEqual({ userId: 'rm-a', displayName: 'Anita RM' });
    expect(dto.team).toEqual({ teamId: 'team-1', name: 'Mumbai North Team A' });
    expect(dto.partner).toEqual({
      partnerId: 'p-1',
      partnerCode: 'DSA-001',
      legalName: 'Sunshine DSA Pvt Ltd',
      type: 'DSA',
      status: 'active',
    });
    expect(dto.productDetail).toEqual({
      leadProductDetailId: 'lpd-1',
      productCode: 'CV',
      productConfigId: 'pc-1',
      attributes: { vehicle_type: 'truck' },
      validationStatus: 'valid',
    });
    expect(dto.sourceAttribution).toEqual({
      source: 'DSA',
      subSource: 'field_visit',
      partnerId: 'p-1',
      campaignCode: null,
      utm: null,
    });
    expect(dto.version).toBe(5);
  });

  it('raw name/mobile/email are NEVER serialised; sensitive identity keys are never present', async () => {
    const { service } = makeHarness();
    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);

    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain('9812345610'); // raw mobile
    expect(serialised).not.toContain('rajesh@example.com'); // raw email
    const identityKeys = Object.keys(dto.identity);
    expect(identityKeys).not.toContain('pan_token');
    expect(identityKeys).not.toContain('aadhaar_ref_token');
    expect(identityKeys).not.toContain('ckyc_id');
    expect(identityKeys).not.toContain('address');
  });

  it('TC-051-02: throws NOT_FOUND when no row matches (lead absent)', async () => {
    const { service, repo } = makeHarness(null);
    await expect(service.getAggregate(rm, LEAD_ID, rmCtx)).rejects.toMatchObject({
      name: 'DomainException',
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect(repo.fetchStageHistory).not.toHaveBeenCalled();
    expect(repo.fetchNotes).not.toHaveBeenCalled();
  });

  it('TC-051-03/08/10: out-of-scope, cross-partner and soft-deleted leads are cut by the scope SQL → same NOT_FOUND (existence hidden, never FORBIDDEN)', async () => {
    // The repository compiles the predicate + deleted_at filter into the WHERE
    // (lead360.repository.spec.ts); the service sees "no row" for all three.
    const { service } = makeHarness(null);
    await expect(service.getAggregate(partner, LEAD_ID, partnerCtx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('deny-by-default: a missing scope predicate is rejected before any read (NOT_FOUND, never FORBIDDEN)', async () => {
    const { service, repo } = makeHarness();
    await expect(service.getAggregate(rm, LEAD_ID, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect(repo.fetchCore).not.toHaveBeenCalled();
  });

  it('TC-051-06: DPO (strict) — dob omitted, notes empty, mobile/email masked, name reduced to first name', async () => {
    const { service, repo } = makeHarness();
    const dto = await service.getAggregate(dpo, LEAD_ID, dpoCtx);

    expect(dto.identity.dob).toBeUndefined();
    expect(Object.keys(dto.identity)).not.toContain('dob');
    expect(dto.notes).toHaveLength(0);
    expect(repo.fetchNotes).not.toHaveBeenCalled(); // no notes read for DPO
    expect(dto.identity.mobile).toMatch(/x/);
    expect(dto.identity.mobile).toBe('98xxxxxx10');
    expect(dto.identity.email).toBe('ra****@example.com');
    expect(dto.identity.name).toBe('Rajesh'); // strict reduces to first name
    expect(dto.customerProfile?.displayName).toBe('Rajesh'); // same rule for the profile name
  });

  it('TC-051-07: DPO access appends a view_sensitive audit intent for the lead', async () => {
    const { service, audit } = makeHarness();
    await service.getAggregate(dpo, LEAD_ID, dpoCtx);

    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: DPO_VIEW_AUDIT_ACTION,
        entity_type: 'leads',
        entity_id: LEAD_ID,
        actor_id: dpo.userId,
        org_id: ORG,
        lead_id: LEAD_ID,
        detail: expect.objectContaining({ op: DPO_VIEW_AUDIT_OP, role: RoleCode.DPO }),
      }),
    );
  });

  it('non-DPO access appends NO audit event (read path stays write-free)', async () => {
    const { service, audit } = makeHarness();
    await service.getAggregate(rm, LEAD_ID, rmCtx);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('a DPO-audit sink failure is logged and never converts the 200 into a 500', async () => {
    const { service, audit, logger } = makeHarness();
    audit.append.mockRejectedValueOnce(new Error('sink down'));
    const dto = await service.getAggregate(dpo, LEAD_ID, dpoCtx);
    expect(dto.leadId).toBe(LEAD_ID);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('TC-051-09: PARTNER callers read only non-internal notes (filter pushed into SQL)', async () => {
    const { service, repo } = makeHarness();
    repo.fetchNotes.mockResolvedValueOnce([
      {
        note_id: 'n-2',
        author_id: 'rm-a',
        body: 'Customer note',
        is_internal: false,
        created_at: new Date('2026-06-10T12:00:00Z'),
      },
    ]);
    const dto = await service.getAggregate(partner, LEAD_ID, partnerCtx);

    expect(repo.fetchNotes).toHaveBeenCalledWith(LEAD_ID, true);
    expect(dto.notes).toHaveLength(1);
    expect(dto.notes[0]?.body).toBe('Customer note');
  });

  it('internal staff read all notes (externalOnly=false)', async () => {
    const { service, repo } = makeHarness();
    await service.getAggregate(rm, LEAD_ID, rmCtx);
    expect(repo.fetchNotes).toHaveBeenCalledWith(LEAD_ID, false);
  });

  it('TC-051-11: empty sub-sections are empty arrays/nulls/zero summaries — not errors', async () => {
    const { service, repo } = makeHarness(
      coreRow({
        customer_profile_id: null,
        display_name: null,
        customer_type: null,
        is_existing_customer: null,
        lead_product_detail_id: null,
        product_config_id: null,
        attributes: null,
        validation_status: null,
        branch_id: null,
        branch_name: null,
        owner_id: null,
        owner_full_name: null,
        team_id: null,
        team_name: null,
        partner_id: null,
        partner_code: null,
        partner_legal_name: null,
        partner_type: null,
        partner_status: null,
      }),
    );
    repo.fetchStageHistory.mockResolvedValueOnce([]);
    repo.fetchConsentRows.mockResolvedValueOnce([]);
    repo.fetchNotes.mockResolvedValueOnce([]);
    repo.fetchOpenTaskCount.mockResolvedValueOnce(0);

    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);

    expect(dto.stageHistory).toEqual([]);
    expect(dto.eligibilitySnapshot).toBeNull();
    expect(dto.losApplicationMirror).toBeNull();
    expect(dto.notes).toEqual([]);
    expect(dto.duplicateMatches).toEqual([]);
    expect(dto.consentSummary).toEqual([]);
    expect(dto.documentSummary).toEqual({ total: 0, verified: 0, pending: 0, mismatch: 0 });
    expect(dto.kycSummary).toEqual({ total: 0, success: 0, failed: 0, exception: 0, initiated: 0 });
    expect(dto.openTaskCount).toBe(0);
    expect(dto.customerProfile).toBeNull();
    expect(dto.productDetail).toBeNull();
    expect(dto.branch).toBeNull();
    expect(dto.owner).toBeNull();
    expect(dto.team).toBeNull();
    expect(dto.partner).toBeNull();
  });

  it('reduces document/KYC status counts (unmapped statuses count toward total only)', async () => {
    const { service, repo } = makeHarness();
    repo.fetchDocumentStatusCounts.mockResolvedValueOnce([
      { status: DocStatus.VERIFIED, cnt: '3' },
      { status: DocStatus.PENDING, cnt: '2' },
      { status: DocStatus.MISMATCH, cnt: '1' },
      { status: DocStatus.UPLOADED, cnt: '4' }, // total-only
    ]);
    repo.fetchKycStatusCounts.mockResolvedValueOnce([
      { status: KycCheckStatus.SUCCESS, cnt: '1' },
      { status: KycCheckStatus.EXCEPTION, cnt: '1' },
      { status: KycCheckStatus.WAIVED, cnt: '1' }, // total-only
    ]);

    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);
    expect(dto.documentSummary).toEqual({ total: 10, verified: 3, pending: 2, mismatch: 1 });
    expect(dto.kycSummary).toEqual({ total: 3, success: 1, failed: 0, exception: 1, initiated: 0 });
  });

  it('maps the latest eligibility snapshot and LOS mirror when present', async () => {
    const { service, repo } = makeHarness();
    repo.fetchLatestEligibilitySnapshot.mockResolvedValueOnce({
      eligibility_snapshot_id: 'es-1',
      indicative_amount: '480000.00',
      tenure_months: 48,
      rate_range: '14-16%',
      conditions: { ltv: 0.8 },
      validity_until: new Date('2026-06-24T00:00:00Z'),
      status: 'received',
      created_at: new Date('2026-06-10T12:00:00Z'),
    });
    repo.fetchLatestLosMirror.mockResolvedValueOnce({
      los_mirror_id: 'lm-1',
      los_application_id: 'LOS-2026-9900',
      status: 'under_review',
      status_date: new Date('2026-06-10T13:00:00Z'),
    });

    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);
    expect(dto.eligibilitySnapshot).toEqual({
      eligibilitySnapshotId: 'es-1',
      indicativeAmount: '480000.00',
      tenureMonths: 48,
      rateRange: '14-16%',
      conditions: { ltv: 0.8 },
      validityUntil: new Date('2026-06-24T00:00:00Z'),
      status: 'received',
      createdAt: new Date('2026-06-10T12:00:00Z'),
    });
    expect(dto.losApplicationMirror).toEqual({
      losMirrorId: 'lm-1',
      losApplicationId: 'LOS-2026-9900',
      status: 'under_review',
      statusDate: new Date('2026-06-10T13:00:00Z'),
    });
  });

  it('maps open duplicate matches with the matched lead code', async () => {
    const { service, repo } = makeHarness();
    repo.fetchOpenDuplicateMatches.mockResolvedValueOnce([
      {
        duplicate_match_id: 'dm-1',
        matched_lead_id: 'lead-other',
        matched_lead_code: 'LD-2026-000035',
        confidence: 'strong',
        status: 'open',
        action: 'warned',
      },
    ]);
    const dto = await service.getAggregate(rm, LEAD_ID, rmCtx);
    expect(dto.duplicateMatches).toEqual([
      {
        duplicateMatchId: 'dm-1',
        matchedLeadId: 'lead-other',
        matchedLeadCode: 'LD-2026-000035',
        confidence: 'strong',
        status: 'open',
        action: 'warned',
      },
    ]);
  });
});

describe('Lead360Service.deduplicateConsents (TC-051-12)', () => {
  // Purposes use the schema `consent_purpose` enum (the LLD sample's
  // `data_processing`/`eligibility_check` literals predate the enum pinning).
  it('returns the newest state per purpose when multiple rows exist', () => {
    const { service } = makeHarness();
    const rows: Lead360ConsentRow[] = [
      {
        purpose: ConsentPurpose.DOCUMENT_PROCESSING,
        state: ConsentState.WITHDRAWN,
        created_at: new Date('2026-06-09T00:00:00Z'),
      },
      {
        purpose: ConsentPurpose.DOCUMENT_PROCESSING,
        state: ConsentState.GRANTED,
        created_at: new Date('2026-06-10T00:00:00Z'),
      },
      {
        purpose: ConsentPurpose.PRODUCT_ELIGIBILITY,
        state: ConsentState.GRANTED,
        created_at: new Date('2026-06-08T00:00:00Z'),
      },
    ];

    const result = service.deduplicateConsents(rows);

    expect(result).toHaveLength(2);
    const dp = result.find((r) => r.purpose === ConsentPurpose.DOCUMENT_PROCESSING);
    expect(dp?.state).toBe(ConsentState.GRANTED); // newest row wins
    const pe = result.find((r) => r.purpose === ConsentPurpose.PRODUCT_ELIGIBILITY);
    expect(pe?.state).toBe(ConsentState.GRANTED);
  });

  it('does not assume the input is pre-sorted (sorts by created_at internally)', () => {
    const { service } = makeHarness();
    const result = service.deduplicateConsents([
      {
        purpose: ConsentPurpose.LEAD_CONTACT,
        state: ConsentState.GRANTED,
        created_at: new Date('2026-06-10T00:00:00Z'),
      },
      {
        purpose: ConsentPurpose.LEAD_CONTACT,
        state: ConsentState.WITHDRAWN,
        created_at: new Date('2026-06-11T00:00:00Z'),
      },
    ]);
    expect(result).toEqual([
      { purpose: ConsentPurpose.LEAD_CONTACT, state: ConsentState.WITHDRAWN },
    ]);
  });
});
