import 'reflect-metadata';

import {
  CommCategory,
  CommChannel,
  ConfigStatus,
  DataScope,
  Lang,
  RoleCode,
} from '@lms/shared';

import { IS_PUBLIC_KEY } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import type { TemplateRow } from './template.repository';
import { TemplateController } from './template.controller';
import type { TemplateService, TemplateListResult } from './template.service';

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

function makeTemplateRow(): TemplateRow {
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
  } as TemplateRow;
}

function fakeService(): TemplateService {
  const row = makeTemplateRow();
  return {
    list: jest.fn().mockResolvedValue({
      data: [row],
      meta: { page: 1, limit: 25, total: 1 },
    } as TemplateListResult),
    create: jest.fn().mockResolvedValue(row),
  } as unknown as TemplateService;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplateController metadata', () => {
  it('no handler opts out of the global JwtAuthGuard (@Public absent)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, TemplateController)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, TemplateController.prototype.list),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, TemplateController.prototype.create),
    ).toBeUndefined();
  });
});

describe('TemplateController', () => {
  let controller: TemplateController;
  let service: TemplateService;

  beforeEach(() => {
    service = fakeService();
    controller = new TemplateController(service);
  });

  describe('T02 — list templates with filters', () => {
    it('delegates to TemplateService.list and returns result', async () => {
      const result = await controller.list({ page: 1, limit: 25 }, ADMIN_USER);
      expect(service.list).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('T01 — create template', () => {
    it('delegates to TemplateService.create and returns draft row', async () => {
      const dto = {
        code: 'DOC_REQUEST_SMS_EN',
        version: 1,
        channel: CommChannel.SMS,
        language: Lang.ENGLISH,
        category: CommCategory.TRANSACTIONAL,
        body: 'Dear {{name}}, upload.',
      } as const;

      const result = await controller.create(dto, ADMIN_USER);
      expect(service.create).toHaveBeenCalledWith(dto, ADMIN_USER);
      expect(result.status).toBe(ConfigStatus.DRAFT);
    });
  });
});
