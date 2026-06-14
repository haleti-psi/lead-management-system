import { ERROR_CODES, PartnerStatus, PartnerType } from '@lms/shared';

import type { PartnerRepository, PartnerRow } from './partner.repository';
import type { PartnerQualityRepository } from './partner-quality.repository';
import { PartnerQualityService, type PartnerQualityActor } from './partner-quality.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const PID = 'p0000000-0000-0000-0000-00000000000p';
const RM_ID = 'a0000000-0000-0000-0000-0000000000a1';
const USER = 'u0000000-0000-0000-0000-0000000000u1';

function partnerRow(overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    partner_id: PID,
    org_id: ORG,
    partner_code: 'DSA-001',
    type: PartnerType.DSA,
    legal_name: 'Sharma Finance DSA',
    branch_id: 'b1',
    products: [],
    contact_person: null,
    contact_mobile: null,
    status: PartnerStatus.ACTIVE,
    agreement_ref: null,
    commission_flag: false,
    mapped_rm_id: RM_ID,
    risk_category: null,
    quality_score: null,
    valid_until: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: USER,
    updated_by: USER,
    ...overrides,
  } as PartnerRow;
}

function head(): PartnerQualityActor {
  return { userId: USER, orgId: ORG, predicate: { type: 'all', orgId: ORG } };
}

interface Deps {
  service: PartnerQualityService;
  partners: { findById: jest.Mock };
  repo: {
    getLeadCounts: jest.Mock;
    getDocCounts: jest.Mock;
    getKycMismatchLeads: jest.Mock;
    getThisPartnerAvgTatHours: jest.Mock;
    getAllPartnersMinAvgTatHours: jest.Mock;
    updateQualityScore: jest.Mock;
  };
}
function build(): Deps {
  const partners = { findById: jest.fn(async () => partnerRow()) };
  const repo = {
    getLeadCounts: jest.fn(async () => ({
      total_leads: 45,
      contactable_leads: 38,
      duplicate_leads: 4,
      rejected_leads: 6,
      handed_off_leads: 18,
    })),
    getDocCounts: jest.fn(async () => ({ uploaded_docs: 90, verified_docs_first_time: 72 })),
    getKycMismatchLeads: jest.fn(async () => 3),
    getThisPartnerAvgTatHours: jest.fn(async () => 10),
    getAllPartnersMinAvgTatHours: jest.fn(async () => 9.12),
    updateQualityScore: jest.fn(async () => undefined),
  };
  const logger = { warn: jest.fn() };
  const service = new PartnerQualityService(
    partners as unknown as PartnerRepository,
    repo as unknown as PartnerQualityRepository,
    logger as never,
  );
  return { service, partners, repo };
}

describe('PartnerQualityService.compute', () => {
  it('computes factors + a clamped score and caches it', async () => {
    const d = build();
    const result = await d.service.compute(head(), PID, {});

    expect(result.insufficient_data).toBe(false);
    expect(result.factors.contactability_index).toBeCloseTo(84.44, 2);
    expect(result.factors.handoff_index).toBeCloseTo(40, 2);
    expect(result.factors.document_quality_index).toBeCloseTo(80, 2);
    expect(result.factors.speed_index).toBeCloseTo(91.2, 1);
    expect(result.metrics.kyc_mismatch_leads).toBe(3);
    // weighted: .25*84.44 + .30*40 + .20*80 + .15*91.2 - .05*8.89 - .05*13.33 ≈ 61.6 → 62
    expect(result.quality_score).toBe(62);
    expect(d.repo.updateQualityScore).toHaveBeenCalledWith(PID, ORG, 62, USER);
  });

  it('returns insufficient_data (null score + null factors) below the volume threshold', async () => {
    const d = build();
    d.repo.getLeadCounts.mockResolvedValue({
      total_leads: 5,
      contactable_leads: 4,
      duplicate_leads: 0,
      rejected_leads: 1,
      handed_off_leads: 2,
    });
    const result = await d.service.compute(head(), PID, {});
    expect(result.insufficient_data).toBe(true);
    expect(result.quality_score).toBeNull();
    expect(result.factors.contactability_index).toBeNull();
    expect(result.metrics.total_leads).toBe(5); // raw counts still returned
    expect(d.repo.updateQualityScore).not.toHaveBeenCalled();
  });

  it('renders a factor null when its denominator is zero (no docs)', async () => {
    const d = build();
    d.repo.getDocCounts.mockResolvedValue({ uploaded_docs: 0, verified_docs_first_time: 0 });
    const result = await d.service.compute(head(), PID, {});
    expect(result.factors.document_quality_index).toBeNull();
    expect(result.factors.contactability_index).not.toBeNull();
  });

  it('speed_index is null without TAT data', async () => {
    const d = build();
    d.repo.getThisPartnerAvgTatHours.mockResolvedValue(null);
    const result = await d.service.compute(head(), PID, {});
    expect(result.factors.speed_index).toBeNull();
  });

  it('partner not found → NOT_FOUND', async () => {
    const d = build();
    d.partners.findById.mockResolvedValue(undefined);
    await expect(d.service.compute(head(), PID, {})).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it('PARTNER can read own; another partner → FORBIDDEN', async () => {
    const d = build();
    const own: PartnerQualityActor = { userId: USER, orgId: ORG, predicate: { type: 'partner', partnerId: PID } };
    await expect(d.service.compute(own, PID, {})).resolves.toBeDefined();
    const other: PartnerQualityActor = { userId: USER, orgId: ORG, predicate: { type: 'partner', partnerId: 'OTHER' } };
    await expect(d.service.compute(other, PID, {})).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('RM (own predicate) → FORBIDDEN', async () => {
    const d = build();
    const rm: PartnerQualityActor = { userId: RM_ID, orgId: ORG, predicate: { type: 'own', userId: RM_ID } };
    await expect(d.service.compute(rm, PID, {})).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('BM in-branch passes; out-of-branch → FORBIDDEN', async () => {
    const d = build();
    const inBranch: PartnerQualityActor = { userId: USER, orgId: ORG, predicate: { type: 'branch', branchId: 'b1' } };
    await expect(d.service.compute(inBranch, PID, {})).resolves.toBeDefined();
    const outBranch: PartnerQualityActor = { userId: USER, orgId: ORG, predicate: { type: 'branch', branchId: 'b2' } };
    await expect(d.service.compute(outBranch, PID, {})).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('cache-write failure does not fail the response', async () => {
    const d = build();
    d.repo.updateQualityScore.mockRejectedValue(new Error('db down'));
    const result = await d.service.compute(head(), PID, {});
    expect(result.quality_score).toBe(62);
  });
});
