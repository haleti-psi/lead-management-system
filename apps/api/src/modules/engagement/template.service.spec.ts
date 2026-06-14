import { AuditAction, CommCategory, CommChannel, ConfigStatus, DataScope, Lang, RoleCode } from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { TemplateRepository, type TemplateRow } from './template.repository';
import { TemplateService } from './template.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TEMPLATE_ID = '00000000-0000-0000-0001-000000000001';
const ADMIN_ID = '00000000-0000-0000-0003-000000000001';

const ADMIN_USER: AuthUser = {
  userId: ADMIN_ID,
  orgId: ORG_ID,
  role: RoleCode.ADMIN,
  scope: DataScope.A,
  jti: 'jti-admin',
};

function makeTemplateRow(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    template_id: TEMPLATE_ID,
    org_id: ORG_ID,
    code: 'DOC_REQUEST_SMS_EN',
    version: 1,
    channel: CommChannel.SMS,
    language: Lang.ENGLISH,
    category: CommCategory.TRANSACTIONAL,
    product_code: null,
    body: 'Dear {{name}}, please upload.',
    status: ConfigStatus.DRAFT,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: ADMIN_ID,
    updated_by: ADMIN_ID,
    ...overrides,
  } as TemplateRow;
}

function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({ __tx: true })),
    tx: jest.fn(),
    isActive: false,
  } as unknown as UnitOfWork;
}

function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

function fakeRepo(overrides: Partial<TemplateRepository> = {}): TemplateRepository {
  return {
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    insert: jest.fn().mockResolvedValue(makeTemplateRow()),
    findActiveById: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as TemplateRepository;
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeService(repo?: Partial<TemplateRepository>): {
  service: TemplateService;
  audit: AuditAppender;
  uow: UnitOfWork;
} {
  const uow = fakeUow();
  const audit = fakeAudit();
  const r = fakeRepo(repo);
  const service = new TemplateService(r, uow, audit, fakeLogger as never);
  return { service, audit, uow };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplateService', () => {
  describe('list', () => {
    it('returns paginated results from repository', async () => {
      const template = makeTemplateRow();
      const { service } = makeService({
        list: jest.fn().mockResolvedValue({ rows: [template], total: 1 }),
      });

      const result = await service.list(
        { page: 1, limit: 25 },
        ADMIN_USER,
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 1 });
    });

    it('returns empty list when no templates exist', async () => {
      const { service } = makeService();
      const result = await service.list({ page: 1, limit: 25 }, ADMIN_USER);
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('create', () => {
    const validDto = {
      code: 'DOC_REQUEST_SMS_EN',
      version: 1,
      channel: CommChannel.SMS,
      language: Lang.ENGLISH,
      category: CommCategory.TRANSACTIONAL,
      body: 'Dear {{name}}, please upload.',
    } as const;

    it('T01: happy path — creates draft template and emits audit CONFIG_CHANGE', async () => {
      const { service, audit } = makeService();

      const result = await service.create(validDto, ADMIN_USER);

      expect(result.status).toBe(ConfigStatus.DRAFT);
      expect(result.template_id).toBe(TEMPLATE_ID);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CONFIG_CHANGE,
          entity_type: 'communication_templates',
          actor_id: ADMIN_ID,
          detail: expect.objectContaining({ sub_action: 'TEMPLATE_CREATED' }),
        }),
        expect.anything(), // tx
      );
    });

    it('T14: duplicate template version → CONFLICT (409)', async () => {
      const uow: UnitOfWork = {
        run: jest.fn().mockRejectedValue({ code: '23505', detail: 'Key already exists.' }),
        tx: jest.fn(),
        isActive: false,
      } as unknown as UnitOfWork;
      const audit = fakeAudit();
      const repo = fakeRepo();
      const service = new TemplateService(repo, uow, audit, fakeLogger as never);

      await expect(service.create(validDto, ADMIN_USER)).rejects.toThrow(DomainException);
      await expect(service.create(validDto, ADMIN_USER)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('re-throws non-unique errors as-is', async () => {
      const dbError = new Error('connection lost');
      const uow: UnitOfWork = {
        run: jest.fn().mockRejectedValue(dbError),
        tx: jest.fn(),
        isActive: false,
      } as unknown as UnitOfWork;
      const service = new TemplateService(fakeRepo(), uow, fakeAudit(), fakeLogger as never);

      await expect(service.create(validDto, ADMIN_USER)).rejects.toThrow('connection lost');
    });
  });
});
