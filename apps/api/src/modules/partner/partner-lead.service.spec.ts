import { ERROR_CODES, PartnerStatus, PartnerType, ProductCode } from '@lms/shared';

import { DomainException } from '../../core/http';
import type { CaptureService, LeadCaptureData } from '../capture/capture.service';
import type { PartnerRepository, PartnerRow } from './partner.repository';
import type { PartnerLeadRepository, PartnerLeadRow } from './partner-lead.repository';
import { PartnerLeadService, type PartnerLeadActor } from './partner-lead.service';
import type { PartnerLeadCreateDto } from './dto/partner-lead-create.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const USER = 'a0000000-0000-0000-0000-0000000000a1';
const PARTNER = 'p0000000-0000-0000-0000-00000000000p';

function partnerRow(overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    partner_id: PARTNER,
    org_id: ORG,
    partner_code: 'DSA-001',
    type: PartnerType.DSA,
    legal_name: 'Acme DSA',
    branch_id: 'b1',
    products: [],
    contact_person: null,
    contact_mobile: null,
    status: PartnerStatus.ACTIVE,
    agreement_ref: null,
    commission_flag: false,
    mapped_rm_id: null,
    risk_category: null,
    quality_score: null,
    valid_until: new Date('2099-12-31'),
    created_at: new Date(),
    updated_at: new Date(),
    created_by: USER,
    updated_by: USER,
    ...overrides,
  } as PartnerRow;
}

function leadCaptureData(): LeadCaptureData {
  return {
    lead_id: 'lead-1',
    lead_code: 'LD-2026-000123',
    stage: 'captured',
    product_code: ProductCode.CV,
    consent_status: 'pending',
    duplicate_status: 'none',
    kyc_status: 'not_started',
    score: null,
    is_hot: false,
    channel_created_by: 'partner',
    name_masked: 'Ramesh xxxxx',
    mobile_masked: '98xxxxxx10',
  } as LeadCaptureData;
}

function actor(): PartnerLeadActor {
  return { userId: USER, orgId: ORG, partnerId: PARTNER, requestMeta: { ip: '1.2.3.4', userAgent: 'jest' } };
}
function dto(over: Partial<PartnerLeadCreateDto> = {}): PartnerLeadCreateDto {
  return {
    product_code: ProductCode.CV,
    identity: { name: 'Ramesh Kumar', mobile: '9876543210' },
    ...over,
  } as PartnerLeadCreateDto;
}

interface Deps {
  service: PartnerLeadService;
  capture: { createLead: jest.Mock };
  partners: { findById: jest.Mock };
  repo: { listOwn: jest.Mock; countOwn: jest.Mock };
}
function build(): Deps {
  const capture = { createLead: jest.fn(async () => ({ replayed: false, data: leadCaptureData() })) };
  const partners = { findById: jest.fn(async () => partnerRow()) };
  const repo = { listOwn: jest.fn(async () => []), countOwn: jest.fn(async () => 0) };
  const service = new PartnerLeadService(
    capture as unknown as CaptureService,
    partners as unknown as PartnerRepository,
    repo as unknown as PartnerLeadRepository,
  );
  return { service, capture, partners, repo };
}

describe('PartnerLeadService.submit', () => {
  it('forces source=DSA + partner_code and delegates to CaptureService', async () => {
    const d = build();
    const result = await d.service.submit(actor(), dto({ sub_source: 'showroom-A' }), 'idem-1');

    expect(result.lead_code).toBe('LD-2026-000123');
    expect(result.name_masked).toBe('Ramesh xxxxx');
    const [forcedDto, ctx] = d.capture.createLead.mock.calls[0];
    expect(forcedDto.source).toEqual({ source: 'DSA', partner_code: 'DSA-001', sub_source: 'showroom-A' });
    expect(ctx).toMatchObject({ actorRole: 'PARTNER', channel: 'partner', idempotencyKey: 'idem-1', orgId: ORG });
  });

  it('forces source=Dealer for a non-DSA partner type', async () => {
    const d = build();
    d.partners.findById.mockResolvedValue(partnerRow({ type: PartnerType.CONNECTOR }));
    await d.service.submit(actor(), dto(), undefined);
    expect(d.capture.createLead.mock.calls[0][0].source.source).toBe('Dealer');
  });

  it('rejects when the partner is not found → FORBIDDEN', async () => {
    const d = build();
    d.partners.findById.mockResolvedValue(undefined);
    await expect(d.service.submit(actor(), dto(), undefined)).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(d.capture.createLead).not.toHaveBeenCalled();
  });

  it('rejects a suspended partner → FORBIDDEN', async () => {
    const d = build();
    d.partners.findById.mockResolvedValue(partnerRow({ status: PartnerStatus.SUSPENDED }));
    await expect(d.service.submit(actor(), dto(), undefined)).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('rejects an expired (past valid_until) partner → FORBIDDEN', async () => {
    const d = build();
    d.partners.findById.mockResolvedValue(partnerRow({ valid_until: new Date('2000-01-01') }));
    await expect(d.service.submit(actor(), dto(), undefined)).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('strips other-customer match details from a duplicate CONFLICT (no PII leak)', async () => {
    const d = build();
    d.capture.createLead.mockRejectedValue(
      new DomainException(ERROR_CODES.CONFLICT, 'blocked', {
        detail: { reason: 'DUPLICATE_BLOCKED', matches: [{ lead_id: 'other-lead', lead_code: 'LD-9999' }] },
      }),
    );
    await expect(d.service.submit(actor(), dto(), undefined)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
      detail: { reason: 'DUPLICATE_BLOCKED' },
    });
    // The re-thrown error must NOT carry the matched leads.
    const caught = await d.service.submit(actor(), dto(), undefined).catch((e: unknown) => e);
    expect((caught as { detail?: Record<string, unknown> }).detail).not.toHaveProperty('matches');
  });
});

describe('PartnerLeadService.listOwn', () => {
  it('returns masked, partner-scoped rows with pagination', async () => {
    const d = build();
    const row: PartnerLeadRow = {
      lead_id: 'lead-1',
      lead_code: 'LD-2026-000123',
      stage: 'assigned',
      product_code: 'CV',
      duplicate_status: 'none',
      created_at: new Date('2026-06-09T10:00:00Z'),
      name: 'Ramesh Kumar',
      mobile: '9876543210',
    };
    d.repo.listOwn.mockResolvedValue([row]);
    d.repo.countOwn.mockResolvedValue(1);

    const result = await d.service.listOwn({ orgId: ORG, partnerId: PARTNER }, { page: 1, limit: 25 });

    expect(result.data[0].name_masked).toBe('Ramesh xxxxx');
    expect(result.data[0].mobile_masked).toBe('98xxxxxx10');
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 1 });
    expect(d.repo.listOwn).toHaveBeenCalledWith(ORG, PARTNER, expect.objectContaining({ page: 1, limit: 25 }));
  });
});
