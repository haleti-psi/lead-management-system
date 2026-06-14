import 'reflect-metadata';

import {
  CommChannel,
  DataScope,
  RoleCode,
} from '@lms/shared';

import { IS_PUBLIC_KEY } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import type { CommunicationRepository, CommLogRow } from './communication.repository';
import { CommunicationController } from './communication.controller';
import type { NotificationDispatchService } from './notification-dispatch.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = '00000000-0000-0000-0002-000000000001';
const COMM_LOG_ID = '00000000-0000-0000-0004-000000000001';
const TEMPLATE_ID = '00000000-0000-0000-0001-000000000001';
const USER_ID = '00000000-0000-0000-0003-000000000001';

const RM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG_ID,
  role: RoleCode.RM,
  scope: DataScope.O,
  jti: 'jti-rm',
};

const BM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG_ID,
  role: RoleCode.BM,
  scope: DataScope.B,
  jti: 'jti-bm',
};

function makeCommLogRow(overrides: Partial<CommLogRow> = {}): CommLogRow {
  return {
    communication_log_id: COMM_LOG_ID,
    org_id: ORG_ID,
    lead_id: LEAD_ID,
    template_id: TEMPLATE_ID,
    channel: CommChannel.SMS,
    recipient: '9876543210',
    consent_basis: 'lead_contact',
    status: 'queued',
    provider_ref: null,
    failure_reason: null,
    sent_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: USER_ID,
    updated_by: USER_ID,
    ...overrides,
  } as CommLogRow;
}

function makeController(opts: {
  listByLeadResult?: { rows: CommLogRow[]; total: number };
} = {}) {
  const { listByLeadResult = { rows: [makeCommLogRow()], total: 1 } } = opts;

  const commRepo: Partial<CommunicationRepository> = {
    listByLead: jest.fn().mockResolvedValue(listByLeadResult),
  };

  const dispatchService: Partial<NotificationDispatchService> = {
    send: jest.fn().mockResolvedValue({ communication_log_id: COMM_LOG_ID, status: 'queued' }),
  };

  const controller = new CommunicationController(
    dispatchService as NotificationDispatchService,
    commRepo as CommunicationRepository,
  );

  return { controller, commRepo, dispatchService };
}

// ── @Public absence assertions ─────────────────────────────────────────────────

describe('CommunicationController metadata', () => {
  it('no handler opts out of the global JwtAuthGuard (@Public absent)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CommunicationController)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, CommunicationController.prototype.list),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, CommunicationController.prototype.send),
    ).toBeUndefined();
  });
});

// ── GET /leads/:id/communications ─────────────────────────────────────────────

describe('CommunicationController.list', () => {
  describe('GET communications — happy path', () => {
    it('delegates to commRepo.listByLead with correct params', async () => {
      const { controller, commRepo } = makeController();

      const result = await controller.list(
        { id: LEAD_ID },
        { page: 1, limit: 25 },
        RM_USER,
      );

      expect(commRepo.listByLead).toHaveBeenCalledWith(
        LEAD_ID,
        ORG_ID,
        { page: 1, limit: 25 },
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, limit: 25, total: 1 });
    });
  });

  describe('GET communications — masking: recipient is always null in response', () => {
    it('strips recipient field from every log row in the response', async () => {
      const { controller } = makeController({
        listByLeadResult: { rows: [makeCommLogRow({ recipient: '9876543210' })], total: 1 },
      });

      const result = await controller.list(
        { id: LEAD_ID },
        { page: 1, limit: 25 },
        RM_USER,
      );

      expect(result.data[0].recipient).toBeNull();
    });
  });

  describe('GET communications — scope: BM user passes their orgId to repo', () => {
    it('uses user.orgId for org-scoping', async () => {
      const { controller, commRepo } = makeController();

      await controller.list({ id: LEAD_ID }, { page: 1, limit: 25 }, BM_USER);

      expect(commRepo.listByLead).toHaveBeenCalledWith(
        LEAD_ID,
        ORG_ID,
        { page: 1, limit: 25 },
      );
    });
  });

  describe('GET communications — empty result', () => {
    it('returns empty data array with total=0 when no logs exist', async () => {
      const { controller } = makeController({
        listByLeadResult: { rows: [], total: 0 },
      });

      const result = await controller.list({ id: LEAD_ID }, { page: 1, limit: 25 }, RM_USER);

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });
});
