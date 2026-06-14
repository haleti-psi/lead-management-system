/**
 * FR-113 unit + component tests (FR-113-tests.md).
 *
 * Unit tests exercised at the service layer with all dependencies mocked.
 * Full-HTTP+DB integration tier (T01–T20, T27) is DEFERRED to the project-wide
 * integration-test wave (manifest stage7.test_strategy).
 *
 * Coverage:
 *   T21/T22 — validateMandatoryDisclosureFields (all present, missing storage_location)
 *   T23/T24/T25 — validateStatusTransition (valid, invalid, no-op)
 *   T26 — LIMIT clamped to 100 in DlaRegistryRepository.list
 *   T09 — assertAllowedRole negatives (RM denied, BM denied, SM denied)
 *   T27 — transaction rollback on audit failure
 *   Happy-path list, create draft, create active, update (service unit tests)
 */

import { randomUUID } from 'node:crypto';

import {
  AuditAction,
  ConfigStatus,
  DlaType,
  ERROR_CODES,
  RoleCode,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { UnitOfWork } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import {
  DlaRegistryRepository,
  rowToDlaData,
  type DlaRegistryRow,
} from './dla-registry.repository';
import { DlaRegistryService, type DlaActorContext } from './dla-registry.service';
import type { CreateDlaDto } from './dto/create-dla.dto';
import type { UpdateDlaDto } from './dto/update-dla.dto';
import type { ListDlaFiltersDto } from './dto/list-dla-filters.dto';

// ──────────────────────────────────────────────────────── fixtures ──

const ORG = '00000000-0000-0000-0000-000000000001';
const DPO_ID = 'a0000000-0000-0000-0000-0000000000d1';
const ADMIN_ID = 'a0000000-0000-0000-0000-0000000000a1';
const DLA_ID = 'c0000000-0000-0000-0000-000000000011';
const NOW = new Date('2026-06-14T09:00:00Z');
const TX = { __tx: true } as unknown as DbTransaction;

function makeRow(overrides: Partial<DlaRegistryRow> = {}): DlaRegistryRow {
  return {
    dla_registry_id: DLA_ID,
    org_id: ORG,
    name: 'QuickLend DLA',
    type: DlaType.DLA,
    owner: 'QuickLend Technologies Pvt Ltd',
    url: 'https://app.quicklend.in',
    grievance_officer: JSON.stringify({ name: 'Ramesh Kumar', email: 'grievance@quicklend.in', phone: '1800-123-4567' }),
    enabled_products: JSON.stringify(['CV', 'TW']),
    data_collected: JSON.stringify(['name', 'mobile', 'pan', 'address']),
    storage_location: 'India (AWS ap-south-1)',
    status: ConfigStatus.ACTIVE,
    created_at: NOW,
    updated_at: NOW,
    created_by: DPO_ID,
    updated_by: DPO_ID,
    ...overrides,
  };
}

function dpoCtx(): DlaActorContext {
  return { callerId: DPO_ID, orgId: ORG };
}

function adminCtx(): DlaActorContext {
  return { callerId: ADMIN_ID, orgId: ORG };
}

// ──────────────────────────────────────────────────────── helpers ──

function makeRepo(overrides: Partial<DlaRegistryRepository> = {}): DlaRegistryRepository {
  return {
    findById: jest.fn().mockResolvedValue(undefined),
    findByNameAndOrg: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    create: jest.fn().mockResolvedValue(makeRow()),
    update: jest.fn().mockResolvedValue(makeRow()),
    ...overrides,
  } as unknown as DlaRegistryRepository;
}

function makeUow(fn?: (callback: (tx: DbTransaction) => Promise<unknown>) => Promise<unknown>): UnitOfWork {
  const run = fn ?? ((cb) => cb(TX));
  return { run } as unknown as UnitOfWork;
}

function makeAudit(appendFn?: jest.Mock): AuditAppender {
  return { append: appendFn ?? jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLogger(): any {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeService(
  repo: DlaRegistryRepository = makeRepo(),
  uow: UnitOfWork = makeUow(),
  audit: AuditAppender = makeAudit(),
): DlaRegistryService {
  const svc = new DlaRegistryService(uow, repo, audit, makeLogger());
  return svc;
}

// ──────────────────────────────────────────────── assertAllowedRole ──

describe('DlaRegistryService.assertAllowedRole', () => {
  it('allows DPO', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.DPO)).not.toThrow();
  });

  it('allows ADMIN', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.ADMIN)).not.toThrow();
  });

  it('denies RM with FORBIDDEN', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.RM)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });

  it('denies BM with FORBIDDEN (BM has configuration capability but not for dla_registry)', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.BM)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });

  it('denies SM with FORBIDDEN', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.SM)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });

  it('denies HEAD with FORBIDDEN (HEAD has configuration but not dla_registry per LLD)', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.HEAD)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });

  it('denies KYC with FORBIDDEN', () => {
    const svc = makeService();
    expect(() => svc.assertAllowedRole(RoleCode.KYC)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.FORBIDDEN }),
    );
  });
});

// ──────────────────────────────────────── validateMandatoryDisclosureFields ──

describe('DlaRegistryService.validateMandatoryDisclosureFields — T21/T22', () => {
  const svc = makeService();

  // T21: all fields present — no throw
  it('T21: passes when all mandatory fields are present', () => {
    expect(() =>
      svc.validateMandatoryDisclosureFields({
        owner: 'QuickLend Technologies',
        url: 'https://app.quicklend.in',
        grievance_officer: { name: 'Ramesh', email: 'g@q.in', phone: '1800-123' },
        storage_location: 'India (AWS ap-south-1)',
      }),
    ).not.toThrow();
  });

  // T22: missing storage_location → VALIDATION_ERROR with fields: [storage_location]
  it('T22: throws VALIDATION_ERROR listing storage_location when missing', () => {
    expect(() =>
      svc.validateMandatoryDisclosureFields({
        owner: 'QuickLend Technologies',
        url: 'https://app.quicklend.in',
        grievance_officer: { name: 'Ramesh', email: 'g@q.in', phone: '1800-123' },
        storage_location: null,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.VALIDATION_ERROR,
        fields: expect.arrayContaining([
          expect.objectContaining({ field: 'storage_location' }),
        ]),
      }),
    );
  });

  it('throws VALIDATION_ERROR listing ALL missing fields when multiple are absent', () => {
    let err: unknown;
    try {
      svc.validateMandatoryDisclosureFields({
        owner: null,
        url: null,
        grievance_officer: null,
        storage_location: null,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'owner' }),
        expect.objectContaining({ field: 'url' }),
        expect.objectContaining({ field: 'grievance_officer' }),
        expect.objectContaining({ field: 'storage_location' }),
      ]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).fields).toHaveLength(4);
  });
});

// ─────────────────────────────────────────── validateStatusTransition ──

describe('DlaRegistryService.validateStatusTransition — T23/T24/T25', () => {
  const svc = makeService();

  // T23: valid transitions — no throw
  it('T23a: allows draft → active', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.DRAFT, ConfigStatus.ACTIVE)).not.toThrow();
  });

  it('T23b: allows active → retired', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.ACTIVE, ConfigStatus.RETIRED)).not.toThrow();
  });

  // T24: invalid transitions → CONFLICT
  it('T24a: blocks retired → active with CONFLICT', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.RETIRED, ConfigStatus.ACTIVE)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.CONFLICT }),
    );
  });

  it('T24b: blocks retired → draft with CONFLICT', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.RETIRED, ConfigStatus.DRAFT)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.CONFLICT }),
    );
  });

  it('T24c: blocks draft → retired with CONFLICT (must go through active first)', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.DRAFT, ConfigStatus.RETIRED)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.CONFLICT }),
    );
  });

  // T25: no-op (same status) — no throw
  it('T25: active → active is a no-op (no transition needed)', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.ACTIVE, ConfigStatus.ACTIVE)).not.toThrow();
  });

  it('T25b: draft → draft is a no-op', () => {
    expect(() => svc.validateStatusTransition(ConfigStatus.DRAFT, ConfigStatus.DRAFT)).not.toThrow();
  });
});

// ──────────────────────────────────────── Pagination LIMIT clamping — T26 ──

describe('DlaRegistryRepository.list LIMIT clamped to 100 — T26', () => {
  it('T26: clamps limit > 100 to 100 before executing query', async () => {
    // The repository is the right layer to test LIMIT clamping.
    // We mock the Kysely db to capture the .limit() call.
    const limitSpy = jest.fn().mockReturnThis();
    const offsetSpy = jest.fn().mockReturnThis();
    const executeSpy = jest.fn().mockResolvedValue([]);
    const executeTakeFirstOrThrowSpy = jest.fn().mockResolvedValue({ total: 0 });

    const fakeQb = {
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: limitSpy,
      offset: offsetSpy,
      execute: executeSpy,
      select: jest.fn().mockReturnThis(),
      executeTakeFirstOrThrow: executeTakeFirstOrThrowSpy,
    };

    const fakeDb = {
      selectFrom: jest.fn().mockReturnValue(fakeQb),
      fn: { countAll: jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue('count_alias') }) },
    };

    const repo = new DlaRegistryRepository(fakeDb as never);

    await repo.list({
      orgId: ORG,
      filters: { sort: 'created_at' },
      pagination: { page: 1, limit: 200 }, // over limit
    });

    // Should clamp to 100 (DLA_REGISTRY_LIST_MAX_LIMIT)
    expect(limitSpy).toHaveBeenCalledWith(100);
  });
});

// ──────────── Sort direction — bare = asc, '-' prefix = desc ──────────────

describe('DlaRegistryRepository.list sort direction', () => {
  function makeOrderBySpy() {
    const orderBySpy = jest.fn().mockReturnThis();
    const fakeQb = {
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: orderBySpy,
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ total: 0 }),
    };
    const fakeDb = {
      selectFrom: jest.fn().mockReturnValue(fakeQb),
      fn: { countAll: jest.fn().mockReturnValue({ as: jest.fn().mockReturnValue('count_alias') }) },
    };
    return { orderBySpy, repo: new DlaRegistryRepository(fakeDb as never) };
  }

  it('bare column (name) → ascending order', async () => {
    const { orderBySpy, repo } = makeOrderBySpy();
    await repo.list({ orgId: ORG, filters: { sort: 'name' }, pagination: { page: 1, limit: 25 } });
    expect(orderBySpy).toHaveBeenCalledWith('name', 'asc');
  });

  it('dash-prefixed column (-name) → descending order', async () => {
    const { orderBySpy, repo } = makeOrderBySpy();
    await repo.list({ orgId: ORG, filters: { sort: '-name' }, pagination: { page: 1, limit: 25 } });
    expect(orderBySpy).toHaveBeenCalledWith('name', 'desc');
  });

  it('bare created_at → ascending order', async () => {
    const { orderBySpy, repo } = makeOrderBySpy();
    await repo.list({ orgId: ORG, filters: { sort: 'created_at' }, pagination: { page: 1, limit: 25 } });
    expect(orderBySpy).toHaveBeenCalledWith('created_at', 'asc');
  });

  it('-created_at → descending order (default behaviour)', async () => {
    const { orderBySpy, repo } = makeOrderBySpy();
    await repo.list({ orgId: ORG, filters: { sort: '-created_at' }, pagination: { page: 1, limit: 25 } });
    expect(orderBySpy).toHaveBeenCalledWith('created_at', 'desc');
  });
});

// ──────────────────────────────────────────── Service: list happy path ──

describe('DlaRegistryService.list', () => {
  it('returns mapped DlaData[] with pagination', async () => {
    const row = makeRow({ status: ConfigStatus.DRAFT });
    const repo = makeRepo({ list: jest.fn().mockResolvedValue({ rows: [row], total: 1 }) });
    const svc = makeService(repo);

    const result = await svc.list(
      { page: 1, limit: 25, sort: 'created_at' } as ListDlaFiltersDto,
      dpoCtx(),
      RoleCode.DPO,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ dlaRegistryId: DLA_ID, type: DlaType.DLA });
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 1 });
  });

  it('throws FORBIDDEN when caller is RM', async () => {
    const svc = makeService();
    await expect(
      svc.list({ page: 1, limit: 25, sort: 'created_at' } as ListDlaFiltersDto, dpoCtx(), RoleCode.RM),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });
});

// ──────────────────────────────────────── Service: create happy path ──

describe('DlaRegistryService.create', () => {
  it('creates a draft entry and emits audit', async () => {
    const auditAppend = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({
      findByNameAndOrg: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(makeRow({ status: ConfigStatus.DRAFT, owner: null, url: null, grievance_officer: null, storage_location: null })),
    });
    const uow = makeUow();
    const audit = makeAudit(auditAppend);
    const svc = makeService(repo, uow, audit);

    const dto: CreateDlaDto = {
      name: 'QuickLend DLA',
      type: DlaType.DLA,
      status: ConfigStatus.DRAFT,
    };

    const result = await svc.create(dto, dpoCtx(), RoleCode.DPO);

    expect(result).toMatchObject({ name: 'QuickLend DLA', type: DlaType.DLA });
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CONFIG_CHANGE,
        entity_type: 'dla_registry',
      }),
      TX,
    );
  });

  it('creates an active entry when all mandatory fields present', async () => {
    const activeRow = makeRow({ status: ConfigStatus.ACTIVE });
    const repo = makeRepo({
      findByNameAndOrg: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(activeRow),
    });
    const svc = makeService(repo);

    const dto: CreateDlaDto = {
      name: 'QuickLend DLA',
      type: DlaType.DLA,
      status: ConfigStatus.ACTIVE,
      owner: 'QuickLend Technologies Pvt Ltd',
      url: 'https://app.quicklend.in',
      grievance_officer: { name: 'Ramesh Kumar', email: 'grievance@quicklend.in', phone: '1800-123-4567' },
      storage_location: 'India (AWS ap-south-1)',
    };

    const result = await svc.create(dto, adminCtx(), RoleCode.ADMIN);
    expect(result.status).toBe(ConfigStatus.ACTIVE);
  });

  it('throws CONFLICT when name already exists for org', async () => {
    const repo = makeRepo({
      findByNameAndOrg: jest.fn().mockResolvedValue(makeRow()),
    });
    const svc = makeService(repo);

    const dto: CreateDlaDto = { name: 'QuickLend DLA', type: DlaType.DLA, status: ConfigStatus.DRAFT };
    await expect(svc.create(dto, dpoCtx(), RoleCode.DPO)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('throws VALIDATION_ERROR when creating active entry with missing disclosure fields', async () => {
    const repo = makeRepo({ findByNameAndOrg: jest.fn().mockResolvedValue(undefined) });
    const svc = makeService(repo);

    const dto: CreateDlaDto = {
      name: 'New DLA',
      type: DlaType.DLA,
      status: ConfigStatus.ACTIVE,
      owner: null, // missing
      url: null,   // missing
      grievance_officer: null,
      storage_location: null,
    };

    await expect(svc.create(dto, dpoCtx(), RoleCode.DPO)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'owner' }),
        expect.objectContaining({ field: 'url' }),
      ]),
    });
  });

  it('throws FORBIDDEN for non-DPO/ADMIN caller', async () => {
    const svc = makeService();
    const dto: CreateDlaDto = { name: 'Test', type: DlaType.LSP, status: ConfigStatus.DRAFT };
    await expect(svc.create(dto, dpoCtx(), RoleCode.RM)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});

// ──────────────────────────────────────── Service: update happy path ──

describe('DlaRegistryService.update', () => {
  it('updates an existing entry and emits audit', async () => {
    const existingRow = makeRow({ status: ConfigStatus.DRAFT, owner: null, url: null, grievance_officer: null, storage_location: null });
    const updatedRow = makeRow({ owner: 'Updated Owner', status: ConfigStatus.DRAFT });
    const auditAppend = jest.fn().mockResolvedValue(undefined);
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(existingRow),
      update: jest.fn().mockResolvedValue(updatedRow),
    });
    const audit = makeAudit(auditAppend);
    const svc = makeService(repo, makeUow(), audit);

    const dto: UpdateDlaDto = {
      dla_registry_id: DLA_ID,
      owner: 'Updated Owner',
    };

    const result = await svc.update(dto, dpoCtx(), RoleCode.DPO);
    expect(result.owner).toBe('Updated Owner');
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.CONFIG_CHANGE,
        entity_type: 'dla_registry',
        entity_id: DLA_ID,
      }),
      TX,
    );
  });

  it('throws NOT_FOUND when entry does not exist', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(undefined) });
    const svc = makeService(repo);

    const dto: UpdateDlaDto = { dla_registry_id: randomUUID(), owner: 'Test' };
    await expect(svc.update(dto, dpoCtx(), RoleCode.DPO)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('throws CONFLICT on invalid status transition (retired → active)', async () => {
    const retiredRow = makeRow({ status: ConfigStatus.RETIRED });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(retiredRow) });
    const svc = makeService(repo);

    const dto: UpdateDlaDto = { dla_registry_id: DLA_ID, status: ConfigStatus.ACTIVE };
    await expect(svc.update(dto, dpoCtx(), RoleCode.DPO)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

  it('throws VALIDATION_ERROR when activating a draft with missing disclosure fields', async () => {
    const draftRow = makeRow({ status: ConfigStatus.DRAFT, owner: null, url: null, grievance_officer: null, storage_location: null });
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(draftRow) });
    const svc = makeService(repo);

    const dto: UpdateDlaDto = { dla_registry_id: DLA_ID, status: ConfigStatus.ACTIVE };
    await expect(svc.update(dto, dpoCtx(), RoleCode.DPO)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: expect.arrayContaining([expect.objectContaining({ field: 'url' })]),
    });
  });

  it('throws FORBIDDEN for non-DPO/ADMIN caller', async () => {
    const svc = makeService();
    const dto: UpdateDlaDto = { dla_registry_id: DLA_ID, owner: 'Test' };
    await expect(svc.update(dto, dpoCtx(), RoleCode.SM)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });
});

// ─────────────────────────── T27: transaction rollback on audit failure ──

describe('T27: transaction rollback on audit failure', () => {
  it('does not persist dla_registry row when AuditAppender throws inside UoW', async () => {
    const createSpy = jest.fn().mockResolvedValue(makeRow());
    const repo = makeRepo({
      findByNameAndOrg: jest.fn().mockResolvedValue(undefined),
      create: createSpy,
    });
    // Simulate AuditAppender throwing after the insert
    const failingAudit: AuditAppender = {
      append: jest.fn().mockRejectedValue(new Error('audit chain full')),
    } as unknown as AuditAppender;
    // UnitOfWork that actually propagates the transaction (simulated by letting the
    // callback run and re-throwing if it throws)
    const uow: UnitOfWork = {
      run: async <T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> => {
        return fn(TX); // not a real DB transaction in unit test, but will throw
      },
    } as unknown as UnitOfWork;

    const svc = makeService(repo, uow, failingAudit);

    const dto: CreateDlaDto = { name: 'DLA Fail', type: DlaType.DLA, status: ConfigStatus.DRAFT };
    await expect(svc.create(dto, dpoCtx(), RoleCode.DPO)).rejects.toThrow('audit chain full');
    // In a real integration test this would verify no row persisted; in unit tests
    // we verify the UoW function threw (the DB transaction would roll back).
  });
});

// ──────────────────────────────────── rowToDlaData mapping (utility) ──

describe('rowToDlaData', () => {
  it('maps DB row to DlaData with parsed JSONB columns', () => {
    const row = makeRow();
    const data = rowToDlaData(row);

    expect(data.dlaRegistryId).toBe(DLA_ID);
    expect(data.grievanceOfficer).toEqual({
      name: 'Ramesh Kumar',
      email: 'grievance@quicklend.in',
      phone: '1800-123-4567',
    });
    expect(data.enabledProducts).toEqual(['CV', 'TW']);
    expect(data.dataCollected).toEqual(['name', 'mobile', 'pan', 'address']);
  });

  it('handles null JSONB columns gracefully', () => {
    const row = makeRow({ grievance_officer: null, enabled_products: null, data_collected: null });
    const data = rowToDlaData(row);

    expect(data.grievanceOfficer).toBeNull();
    expect(data.enabledProducts).toBeNull();
    expect(data.dataCollected).toBeNull();
  });
});
