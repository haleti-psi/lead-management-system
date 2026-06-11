import { ConfigStatus, DataScope, RoleCode } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import type { CreateProductConfigDto } from './dto/create-product-config.dto';
import type { UpdateProductConfigDto } from './dto/update-product-config.dto';
import {
  ProductConfigRepository,
  type ProductConfigRow,
} from './product-config.repository';
import { ProductConfigService } from './product-config.service';

/**
 * FR-040 unit tests for {@link ProductConfigService} (LLD §Test Cases TC-U01–U13,
 * U15). Collaborators are mocked; the UnitOfWork mock runs the callback with a
 * sentinel tx so atomic grouping (config row + version + audit + outbox) is
 * asserted without a DB. Activation (TC-U07/U14) is the activator's job and is
 * covered in product-config.activator.spec.ts.
 */

const ORG = '00000000-0000-0000-0000-000000000001';

const ADMIN: AuthUser = {
  userId: 'admin-1',
  orgId: ORG,
  role: RoleCode.ADMIN,
  scope: DataScope.A,
  jti: 'jti-1',
};

const FIELD_SCHEMA = {
  groups: [
    {
      id: 'asset',
      label: 'Asset Details',
      fields: [
        { key: 'vehicle_type', label: 'Vehicle Type', type: 'select', mandatory: true, options: ['LCV', 'HCV'] },
        { key: 'make_model', label: 'Make/Model', type: 'text', mandatory: false },
      ],
    },
  ],
};

const CREATE_DTO: CreateProductConfigDto = {
  product_code: 'CV',
  name: 'Commercial Vehicle v3',
  field_schema: FIELD_SCHEMA,
  document_checklist: { items: [{ doc_type: 'id', mandatory: true, applicant_scope: 'applicant' }] },
  sla_config: { capture_to_contact_hours: 4 },
  eligibility_mapping: { fields: [{ lms_field: 'vehicle_type', los_field: 'assetType' }] },
  pan_required_at: 'before_kyc',
} as CreateProductConfigDto;

function configRow(overrides: Partial<ProductConfigRow> = {}): ProductConfigRow {
  return {
    product_config_id: 'pc-1',
    org_id: ORG,
    product_code: 'CV',
    name: 'Commercial Vehicle v3',
    version: 3,
    status: ConfigStatus.ACTIVE,
    field_schema: FIELD_SCHEMA,
    document_checklist: { items: [{ doc_type: 'id', mandatory: true, applicant_scope: 'applicant' }] },
    sla_config: { capture_to_contact_hours: 4 },
    eligibility_mapping: { fields: [{ lms_field: 'vehicle_type', los_field: 'assetType' }] },
    pan_required_at: 'before_kyc',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'admin-0',
    updated_by: 'admin-0',
    ...overrides,
  } as ProductConfigRow;
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

function fakeOutbox(): OutboxService {
  return { emit: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
}

interface RepoMock {
  maxVersion: jest.Mock;
  insertDraft: jest.Mock;
  insertConfigVersion: jest.Mock;
  findById: jest.Mock;
  retireActive: jest.Mock;
  list: jest.Mock;
  count: jest.Mock;
}

function fakeRepo(overrides: Partial<RepoMock> = {}): { repo: ProductConfigRepository; mock: RepoMock } {
  const mock: RepoMock = {
    maxVersion: jest.fn().mockResolvedValue(2),
    insertDraft: jest.fn().mockResolvedValue({ product_config_id: 'pc-new', version: 3 }),
    insertConfigVersion: jest.fn().mockResolvedValue('cv-1'),
    findById: jest.fn(),
    retireActive: jest.fn().mockResolvedValue(1),
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
  return { repo: mock as unknown as ProductConfigRepository, mock };
}

describe('ProductConfigService.createDraft', () => {
  it('TC-U01 — inserts draft + pending version + audit + outbox in one transaction', async () => {
    const { repo, mock } = fakeRepo({ maxVersion: jest.fn().mockResolvedValue(2) });
    const uow = fakeUow();
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const service = new ProductConfigService(repo, uow, audit, outbox);

    const result = await service.createDraft(CREATE_DTO, ADMIN, DataScope.A);

    expect(uow.run).toHaveBeenCalledTimes(1);
    // product_configs INSERT: version = max(2) + 1 = 3, status draft, maker = actor.
    const [fields, version, actorId] = mock.insertDraft.mock.calls[0];
    expect(version).toBe(3);
    expect(actorId).toBe('admin-1');
    expect(fields.product_code).toBe('CV');
    // configuration_versions INSERT: config_type product_config, pending, maker.
    expect(mock.insertConfigVersion).toHaveBeenCalledWith('pc-new', 3, expect.any(Object), 'admin-1', expect.anything());
    // audit (config_change) + outbox (CONFIG_CHANGED) each once.
    expect((audit.append as jest.Mock).mock.calls[0][0].action).toBe('config_change');
    expect((audit.append as jest.Mock).mock.calls[0][0].entity_type).toBe('product_config');
    expect((outbox.emit as jest.Mock).mock.calls[0][0].event_code).toBe('CONFIG_CHANGED');
    expect(result).toMatchObject({
      product_config_id: 'pc-new',
      version: 3,
      status: ConfigStatus.DRAFT,
      configuration_version_id: 'cv-1',
      config_version_status: 'pending',
    });
  });

  it('TC-U02 — first version for a product_code assigns version 1', async () => {
    const { repo, mock } = fakeRepo({ maxVersion: jest.fn().mockResolvedValue(0) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    const result = await service.createDraft(CREATE_DTO, ADMIN, DataScope.A);

    expect(mock.insertDraft.mock.calls[0][1]).toBe(1);
    expect(result.version).toBe(1);
  });

  it('rejects a scope-B caller with FORBIDDEN before any write', async () => {
    const { repo, mock } = fakeRepo();
    const uow = fakeUow();
    const service = new ProductConfigService(repo, uow, fakeAudit(), fakeOutbox());

    await expect(service.createDraft(CREATE_DTO, ADMIN, DataScope.B)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(uow.run).not.toHaveBeenCalled();
    expect(mock.insertDraft).not.toHaveBeenCalled();
  });

  it('records eligibility_mapping_changed=true in the version diff', async () => {
    const { repo, mock } = fakeRepo();
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await service.createDraft(CREATE_DTO, ADMIN, DataScope.A);

    const diff = mock.insertConfigVersion.mock.calls[0][2];
    expect(diff).toMatchObject({ action: 'create', eligibility_mapping_changed: true });
  });
});

describe('ProductConfigService.update — editActive', () => {
  it('TC-U04 — creates a new draft row without mutating the active row', async () => {
    const existing = configRow({ product_config_id: 'pc-old', version: 3, status: ConfigStatus.ACTIVE });
    const { repo, mock } = fakeRepo({
      findById: jest.fn().mockResolvedValue(existing),
      insertDraft: jest.fn().mockResolvedValue({ product_config_id: 'pc-new', version: 4 }),
    });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    const dto: UpdateProductConfigDto = { name: 'CV v4 (revised)' } as UpdateProductConfigDto;
    const result = await service.update('pc-old', dto, ADMIN, DataScope.A);

    // INSERT new draft at version 4; original row never updated.
    expect(mock.insertDraft.mock.calls[0][1]).toBe(4);
    expect(mock.insertDraft.mock.calls[0][0].status).toBeUndefined(); // write-fields carry no status
    expect(mock.retireActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      product_config_id: 'pc-new',
      version: 4,
      status: ConfigStatus.DRAFT,
      based_on_version: 3,
      config_version_status: 'pending',
    });
  });

  it('TC-U05 — blocked when target config is draft (not active) → CONFLICT', async () => {
    const existing = configRow({ status: ConfigStatus.DRAFT });
    const { repo, mock } = fakeRepo({ findById: jest.fn().mockResolvedValue(existing) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(
      service.update('pc-1', { name: 'x' } as UpdateProductConfigDto, ADMIN, DataScope.A),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mock.insertDraft).not.toHaveBeenCalled();
  });

  it('TC-U06 — blocked when target config is retired → CONFLICT', async () => {
    const existing = configRow({ status: ConfigStatus.RETIRED });
    const { repo } = fakeRepo({ findById: jest.fn().mockResolvedValue(existing) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(
      service.update('pc-1', { name: 'x' } as UpdateProductConfigDto, ADMIN, DataScope.A),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('NOT_FOUND when the target config is absent / another org', async () => {
    const { repo } = fakeRepo({ findById: jest.fn().mockResolvedValue(undefined) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(
      service.update('missing', { name: 'x' } as UpdateProductConfigDto, ADMIN, DataScope.A),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects eligibility_mapping referencing an undeclared field on a partial edit → VALIDATION_ERROR', async () => {
    const existing = configRow({ status: ConfigStatus.ACTIVE });
    const { repo, mock } = fakeRepo({ findById: jest.fn().mockResolvedValue(existing) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    // Only eligibility_mapping changes; field_schema comes from the existing row.
    const dto = {
      eligibility_mapping: { fields: [{ lms_field: 'unknown_field', los_field: 'x' }] },
    } as UpdateProductConfigDto;

    try {
      await service.update('pc-1', dto, ADMIN, DataScope.A);
      fail('expected VALIDATION_ERROR');
    } catch (err) {
      expect(isDomainException(err) && err.code).toBe('VALIDATION_ERROR');
      if (isDomainException(err)) {
        expect(err.fields?.[0].field).toBe('eligibility_mapping.fields[0].lms_field');
      }
    }
    expect(mock.insertDraft).not.toHaveBeenCalled();
  });
});

describe('ProductConfigService.update — retire', () => {
  it('TC-U12 — retires an active config (status-only) with audit + outbox', async () => {
    const existing = configRow({ product_config_id: 'pc-1', status: ConfigStatus.ACTIVE });
    const { repo, mock } = fakeRepo({ findById: jest.fn().mockResolvedValue(existing) });
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const service = new ProductConfigService(repo, fakeUow(), audit, outbox);

    const result = await service.update('pc-1', { status: ConfigStatus.RETIRED } as UpdateProductConfigDto, ADMIN, DataScope.A);

    expect(mock.retireActive).toHaveBeenCalledWith('pc-1', 'admin-1', expect.anything());
    expect((audit.append as jest.Mock).mock.calls[0][0].detail.operation).toBe('retire');
    expect((outbox.emit as jest.Mock).mock.calls[0][0].payload.status).toBe(ConfigStatus.RETIRED);
    expect(result).toEqual({ product_config_id: 'pc-1', status: ConfigStatus.RETIRED });
  });

  it('TC-U13 — retire blocked when config is not active → CONFLICT', async () => {
    const existing = configRow({ status: ConfigStatus.DRAFT });
    const { repo, mock } = fakeRepo({ findById: jest.fn().mockResolvedValue(existing) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(
      service.update('pc-1', { status: ConfigStatus.RETIRED } as UpdateProductConfigDto, ADMIN, DataScope.A),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mock.retireActive).not.toHaveBeenCalled();
  });
});

describe('ProductConfigService.update — scope + transaction', () => {
  it('rejects a scope-B caller with FORBIDDEN before any read/write', async () => {
    const { repo, mock } = fakeRepo();
    const uow = fakeUow();
    const service = new ProductConfigService(repo, uow, fakeAudit(), fakeOutbox());

    await expect(
      service.update('pc-1', { name: 'x' } as UpdateProductConfigDto, ADMIN, DataScope.B),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(uow.run).not.toHaveBeenCalled();
    expect(mock.findById).not.toHaveBeenCalled();
  });

  it('TC-U15 — an outbox failure propagates so the UnitOfWork rolls back', async () => {
    const { repo } = fakeRepo();
    const outbox = { emit: jest.fn().mockRejectedValue(new Error('outbox down')) } as unknown as OutboxService;
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), outbox);

    await expect(service.createDraft(CREATE_DTO, ADMIN, DataScope.A)).rejects.toThrow('outbox down');
  });
});

describe('ProductConfigService.get / list', () => {
  it('returns the full row from get', async () => {
    const row = configRow();
    const { repo } = fakeRepo({ findById: jest.fn().mockResolvedValue(row) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(service.get('pc-1')).resolves.toBe(row);
  });

  it('throws NOT_FOUND from get when absent', async () => {
    const { repo } = fakeRepo({ findById: jest.fn().mockResolvedValue(undefined) });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    await expect(service.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns rows with pagination meta and maps bracketed filters + signed sort', async () => {
    const { repo, mock } = fakeRepo({
      list: jest.fn().mockResolvedValue([{ product_config_id: 'p1' }, { product_config_id: 'p2' }]),
      count: jest.fn().mockResolvedValue(2),
    });
    const service = new ProductConfigService(repo, fakeUow(), fakeAudit(), fakeOutbox());

    const result = await service.list({
      page: 1,
      limit: 25,
      'filter[status]': ConfigStatus.DRAFT,
      'filter[product_code]': undefined,
      sort: '-version',
    } as never);

    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 2 });
    expect(mock.list).toHaveBeenCalledWith(
      { status: ConfigStatus.DRAFT, product_code: undefined },
      { page: 1, limit: 25, sort: 'version', direction: 'desc' },
    );
  });
});
