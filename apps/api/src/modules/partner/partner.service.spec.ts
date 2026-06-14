import { ERROR_CODES, PartnerStatus, PartnerType, RiskBand, RoleCode } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { DbTransaction, UnitOfWork } from '../../core/db';
import { PartnerService, type PartnerActorContext } from './partner.service';
import type { PartnerRepository, PartnerRow } from './partner.repository';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';

const ORG = '00000000-0000-0000-0000-000000000001';
const PID = 'p0000000-0000-0000-0000-00000000000p';
const USER = 'a0000000-0000-0000-0000-0000000000a1';
const TX = { __tx: true } as unknown as DbTransaction;

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function partnerRow(overrides: Partial<PartnerRow> = {}): PartnerRow {
  return {
    partner_id: PID,
    org_id: ORG,
    partner_code: 'DSA-001',
    type: PartnerType.DSA,
    legal_name: 'Acme DSA',
    branch_id: 'b1',
    products: ['home_loan'],
    contact_person: 'Ravi',
    contact_mobile: '9876543210',
    status: PartnerStatus.ACTIVE,
    agreement_ref: 'AGR-1',
    commission_flag: true,
    mapped_rm_id: null,
    risk_category: RiskBand.LOW,
    quality_score: 82,
    valid_until: '2027-03-31',
    created_at: new Date('2026-01-15T10:00:00Z'),
    updated_at: new Date('2026-05-01T08:30:00Z'),
    created_by: USER,
    updated_by: USER,
    ...overrides,
  } as PartnerRow;
}
function admin(overrides: Partial<PartnerActorContext> = {}): PartnerActorContext {
  return { userId: USER, orgId: ORG, role: RoleCode.ADMIN, predicate: { type: 'all', orgId: ORG }, ...overrides };
}
function bm(branchId = 'b1'): PartnerActorContext {
  return { userId: USER, orgId: ORG, role: RoleCode.BM, predicate: { type: 'branch', branchId } };
}

interface Deps {
  service: PartnerService;
  repo: { list: jest.Mock; count: jest.Mock; findById: jest.Mock; create: jest.Mock; update: jest.Mock };
  audit: { append: jest.Mock };
}
function build(): Deps {
  const repo = {
    list: jest.fn(async () => [partnerRow()]),
    count: jest.fn(async () => 1),
    findById: jest.fn(async () => partnerRow()),
    create: jest.fn(async () => partnerRow()),
    update: jest.fn(async () => partnerRow()),
  };
  const audit = { append: jest.fn(async () => undefined) };
  const service = new PartnerService(
    fakeUow(),
    repo as unknown as PartnerRepository,
    audit as unknown as AuditAppender,
  );
  return { service, repo, audit };
}

const listQuery = { page: 1, limit: 25, sort: { field: 'created_at' as const, dir: 'desc' as const }, filter: {} };

describe('PartnerService.list', () => {
  it('masks contact_mobile and returns pagination meta', async () => {
    const d = build();
    const result = await d.service.list(listQuery, admin());
    expect(result.data[0].contactMobile).toBe('98xxxxxx10');
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 1 });
  });

  it('applies the BM branch scope', async () => {
    const d = build();
    await d.service.list(listQuery, bm('b1'));
    expect(d.repo.list).toHaveBeenCalledWith(ORG, {}, { branchId: 'b1' }, expect.any(Object), 1, 25);
  });

  it('applies no branch scope for ADMIN', async () => {
    const d = build();
    await d.service.list(listQuery, admin());
    expect(d.repo.list).toHaveBeenCalledWith(ORG, {}, {}, expect.any(Object), 1, 25);
  });
});

const createDto = (): CreatePartnerDto =>
  CreatePartnerDto.parse({ partnerCode: 'DSA-002', type: 'DSA', legalName: 'Beta DSA', contactMobile: '9876543210' });

describe('PartnerService.create', () => {
  it('creates a partner and audits config_change', async () => {
    const d = build();
    const result = await d.service.create(createDto(), admin());
    expect(result.partnerCode).toBe('DSA-001');
    expect(result.status).toBe('active');
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'config_change', entity_type: 'partners' }),
      TX,
    );
    // No raw PII in the audit chain — contact_mobile is masked.
    const detail = (d.audit.append.mock.calls[0][0] as { detail: { after: { contact_mobile: string } } }).detail;
    expect(detail.after.contact_mobile).toBe('98xxxxxx10');
  });

  it('maps a duplicate partner_code (23505) to CONFLICT', async () => {
    const d = build();
    d.repo.create.mockRejectedValue({ code: '23505' });
    await expect(d.service.create(createDto(), admin())).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });
});

describe('PartnerService.update', () => {
  it('updates metadata for an in-scope partner (BM)', async () => {
    const d = build();
    const result = await d.service.update(PID, { legalName: 'Renamed DSA' } as UpdatePartnerDto, bm('b1'));
    expect(result.partnerId).toBe(PID);
    expect(d.repo.update).toHaveBeenCalledWith(PID, ORG, expect.objectContaining({ legal_name: 'Renamed DSA' }), USER, TX);
  });

  it('lets ADMIN suspend an active partner', async () => {
    const d = build();
    d.repo.update.mockResolvedValue(partnerRow({ status: PartnerStatus.SUSPENDED }));
    const result = await d.service.update(
      PID,
      { status: PartnerStatus.SUSPENDED, statusReason: 'review' } as UpdatePartnerDto,
      admin(),
    );
    expect(result.status).toBe('suspended');
  });

  it('forbids BM from changing status', async () => {
    const d = build();
    await expect(
      d.service.update(PID, { status: PartnerStatus.SUSPENDED, statusReason: 'x' } as UpdatePartnerDto, bm('b1')),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('rejects an invalid status transition (expired → active)', async () => {
    const d = build();
    d.repo.findById.mockResolvedValue(partnerRow({ status: PartnerStatus.EXPIRED }));
    await expect(
      d.service.update(PID, { status: PartnerStatus.ACTIVE } as UpdatePartnerDto, admin()),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
  });

  it('returns NOT_FOUND when the partner is absent', async () => {
    const d = build();
    d.repo.findById.mockResolvedValue(undefined);
    await expect(d.service.update(PID, { legalName: 'x' } as UpdatePartnerDto, admin())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('returns NOT_FOUND for a BM acting on an out-of-branch partner', async () => {
    const d = build();
    d.repo.findById.mockResolvedValue(partnerRow({ branch_id: 'other-branch' }));
    await expect(d.service.update(PID, { legalName: 'x' } as UpdatePartnerDto, bm('b1'))).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});

describe('Partner DTOs', () => {
  it('rejects an invalid partner type', () => {
    expect(CreatePartnerDto.safeParse({ partnerCode: 'X', type: 'Bad', legalName: 'L' }).success).toBe(false);
  });
  it('rejects an immutable partnerCode on update', () => {
    expect(UpdatePartnerDto.safeParse({ partnerCode: 'NEW' }).success).toBe(false);
  });
  it('requires statusReason when suspending', () => {
    const r = UpdatePartnerDto.safeParse({ status: 'suspended' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toContain('statusReason');
  });
});
