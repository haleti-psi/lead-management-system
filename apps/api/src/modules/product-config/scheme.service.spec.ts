import { DataScope, ProductCode, RoleCode } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import type { CreateSchemeDto } from './dto/create-scheme.dto';
import { SchemeRepository, type SchemeRow } from './scheme.repository';
import { SchemeService } from './scheme.service';

/**
 * FR-042 unit tests for {@link SchemeService}: the validity/active/product rules of
 * `validateAndResolveScheme` (TC-042-U1..U5 + boundary TC-042-21/22), and the
 * create path — scope-A enforcement (TC-042-17 at the service layer), the
 * insert+audit transaction with `action=config_change` (TC-042-01), and the
 * unique-violation → CONFLICT mapping (TC-042-11). Collaborators are mocked; the
 * UnitOfWork mock runs the callback with a sentinel tx so atomic grouping is
 * asserted without a DB.
 */

const ORG_ID = '00000000-0000-0000-0000-000000000001';

const ADMIN: AuthUser = {
  userId: 'admin-1',
  orgId: ORG_ID,
  role: RoleCode.ADMIN,
  scope: DataScope.A,
  jti: 'jti-1',
};

const CREATE_DTO: CreateSchemeDto = {
  code: 'DIVALI-CV-26',
  name: 'Divali CV Scheme 2026',
  product_code: ProductCode.CV,
  subvention_flag: false,
  valid_from: '2026-10-01',
  valid_to: '2026-11-15',
};

/**
 * Test override shape. `valid_from`/`valid_to` are typed `string | Date` because a
 * Postgres `DATE` column is returned as a `YYYY-MM-DD` string at runtime even
 * though the Kysely `Selectable` read type is `Date`; the service's `toDateString`
 * handles both, and these fixtures exercise that.
 */
type SchemeRowOverrides = Partial<Omit<SchemeRow, 'valid_from' | 'valid_to'>> & {
  valid_from?: string | Date;
  valid_to?: string | Date;
};

function makeScheme(overrides: SchemeRowOverrides = {}): SchemeRow {
  return {
    scheme_id: 'sch-1',
    org_id: ORG_ID,
    code: 'DIVALI-CV-26',
    name: 'Divali CV Scheme 2026',
    product_code: ProductCode.CV,
    subvention_flag: false,
    valid_from: '2026-10-01',
    valid_to: '2026-11-15',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'admin-1',
    updated_by: 'admin-1',
    ...overrides,
  } as unknown as SchemeRow;
}

/** UnitOfWork mock that invokes the callback with a sentinel transaction. */
function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true })),
  } as unknown as UnitOfWork;
}

function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('SchemeService.validateAndResolveScheme', () => {
  function serviceWithScheme(scheme: SchemeRow | undefined): {
    service: SchemeService;
    repo: SchemeRepository;
  } {
    const repo = {
      findByCode: jest.fn().mockResolvedValue(scheme),
    } as unknown as SchemeRepository;
    const service = new SchemeService(repo, fakeUow(), fakeAudit());
    return { service, repo };
  }

  it('returns the scheme when valid_to equals today (TC-042-U1 / TC-042-21)', async () => {
    const today = todayStr();
    const scheme = makeScheme({ valid_from: today, valid_to: today, is_active: true });
    const { service } = serviceWithScheme(scheme);

    const result = await service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, today);

    expect(result).toEqual(scheme);
  });

  it('throws VALIDATION_ERROR when scheme valid_to is before today (TC-042-U2)', async () => {
    const scheme = makeScheme({ valid_to: shiftDays(-1), is_active: true });
    const { service } = serviceWithScheme(scheme);

    await expect(
      service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, todayStr()),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
  });

  it('passes product match when scheme.product_code is null (TC-042-U3 / TC-042-22)', async () => {
    const scheme = makeScheme({ product_code: null, valid_to: '2099-12-31', is_active: true });
    const { service } = serviceWithScheme(scheme);

    await expect(
      service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, '2026-06-09'),
    ).resolves.toEqual(scheme);
  });

  it('throws VALIDATION_ERROR when scheme product does not match lead product (TC-042-U4)', async () => {
    const scheme = makeScheme({ product_code: ProductCode.TW, valid_to: '2099-12-31', is_active: true });
    const { service } = serviceWithScheme(scheme);

    await expect(
      service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, '2026-06-09'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
  });

  it('throws VALIDATION_ERROR when scheme is_active is false (TC-042-U5)', async () => {
    const scheme = makeScheme({ is_active: false, valid_to: '2099-12-31' });
    const { service } = serviceWithScheme(scheme);

    await expect(
      service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, '2026-06-09'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [{ field: 'scheme_code' }] });
  });

  it('throws VALIDATION_ERROR "not found" when no scheme matches the code (TC-042-09)', async () => {
    const { service } = serviceWithScheme(undefined);

    await expect(
      service.validateAndResolveScheme('DOES-NOT-EXIST', ProductCode.CV, ORG_ID, '2026-06-09'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: [{ field: 'scheme_code', issue: 'Scheme not found' }],
    });
  });

  it('normalises a Date-typed valid_to before the expiry comparison', async () => {
    // The Kysely read type for a DATE column is Date; assert the boundary holds.
    const scheme = makeScheme({ valid_to: new Date('2026-06-09T00:00:00.000Z') });
    const { service } = serviceWithScheme(scheme);

    await expect(
      service.validateAndResolveScheme('CODE', ProductCode.CV, ORG_ID, '2026-06-09'),
    ).resolves.toEqual(scheme);
  });
});

describe('SchemeService.create', () => {
  it('inserts the scheme + audit in one transaction with action=config_change (TC-042-01)', async () => {
    const inserted = makeScheme({ scheme_id: 'sch-9' });
    const repo = {
      insert: jest.fn().mockResolvedValue(inserted),
    } as unknown as SchemeRepository;
    const uow = fakeUow();
    const audit = fakeAudit();
    const service = new SchemeService(repo, uow, audit);

    const result = await service.create(CREATE_DTO, ADMIN, DataScope.A);

    expect(uow.run).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DIVALI-CV-26', product_code: ProductCode.CV }),
      'admin-1',
      expect.anything(),
    );
    expect(audit.append).toHaveBeenCalledTimes(1);
    const auditArg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(auditArg.action).toBe('config_change');
    expect(auditArg.entity_type).toBe('schemes');
    expect(auditArg.entity_id).toBe('sch-9');
    expect(result).toEqual(inserted);
  });

  it('rejects a scope-B caller with FORBIDDEN before any write (TC-042-17)', async () => {
    const repo = { insert: jest.fn() } as unknown as SchemeRepository;
    const uow = fakeUow();
    const service = new SchemeService(repo, uow, fakeAudit());

    await expect(service.create(CREATE_DTO, ADMIN, DataScope.B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(uow.run).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('maps a unique-violation (23505) to CONFLICT and appends no audit (TC-042-11)', async () => {
    const repo = {
      insert: jest.fn().mockRejectedValue({ code: '23505' }),
    } as unknown as SchemeRepository;
    const audit = fakeAudit();
    const service = new SchemeService(repo, fakeUow(), audit);

    try {
      await service.create(CREATE_DTO, ADMIN, DataScope.A);
      fail('expected CONFLICT');
    } catch (err) {
      expect(isDomainException(err) && err.code).toBe('CONFLICT');
    }
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('rethrows a non-unique DB fault unchanged (becomes INTERNAL_ERROR upstream)', async () => {
    const dbErr = new Error('connection reset');
    const repo = { insert: jest.fn().mockRejectedValue(dbErr) } as unknown as SchemeRepository;
    const service = new SchemeService(repo, fakeUow(), fakeAudit());

    await expect(service.create(CREATE_DTO, ADMIN, DataScope.A)).rejects.toBe(dbErr);
  });
});

describe('SchemeService.list', () => {
  it('returns rows with pagination meta (TC-042-02)', async () => {
    const rows = [makeScheme({ scheme_id: 's1' }), makeScheme({ scheme_id: 's2' })];
    const repo = {
      list: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(2),
    } as unknown as SchemeRepository;
    const service = new SchemeService(repo, fakeUow(), fakeAudit());

    const result = await service.list({
      page: 1,
      limit: 25,
      product_code: undefined,
      is_active: undefined,
    });

    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 2 });
    expect(repo.list).toHaveBeenCalledWith(
      { product_code: undefined, is_active: undefined },
      { page: 1, limit: 25 },
    );
  });

  it('forwards product_code + is_active filters to the repository (TC-042-03)', async () => {
    const repo = {
      list: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as SchemeRepository;
    const service = new SchemeService(repo, fakeUow(), fakeAudit());

    await service.list({ page: 2, limit: 10, product_code: ProductCode.TW, is_active: true });

    expect(repo.list).toHaveBeenCalledWith(
      { product_code: ProductCode.TW, is_active: true },
      { page: 2, limit: 10 },
    );
    expect(repo.count).toHaveBeenCalledWith({ product_code: ProductCode.TW, is_active: true });
  });
});
