import {
  AuditAction,
  CommCategory,
  CommChannel,
  ConfigStatus,
  ConsentPurpose,
  DataScope,
  Lang,
  RoleCode,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { UnitOfWork } from '../../core/db';
import type { NotificationChannelPort } from '../../core/integration';
import type { CommunicationRepository, CommLogRow } from './communication.repository';
import { NotificationDispatchService } from './notification-dispatch.service';
import type { TemplateRepository, TemplateRow } from './template.repository';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LEAD_ID = '00000000-0000-0000-0002-000000000001';
const TEMPLATE_ID = '00000000-0000-0000-0001-000000000001';
const COMM_LOG_ID = '00000000-0000-0000-0004-000000000001';
const USER_ID = '00000000-0000-0000-0003-000000000001';

const RM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG_ID,
  role: RoleCode.RM,
  scope: DataScope.O,
  jti: 'jti-rm',
};

function makeTemplateRow(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    template_id: TEMPLATE_ID,
    org_id: ORG_ID,
    code: 'DOC_SMS_V1',
    version: 1,
    channel: CommChannel.SMS,
    language: Lang.ENGLISH,
    category: CommCategory.TRANSACTIONAL,
    product_code: null,
    body: 'Dear {{name}}, upload your docs.',
    status: ConfigStatus.ACTIVE,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: USER_ID,
    updated_by: USER_ID,
    ...overrides,
  } as TemplateRow;
}

function makeCommLogRow(overrides: Partial<CommLogRow> = {}): CommLogRow {
  return {
    communication_log_id: COMM_LOG_ID,
    org_id: ORG_ID,
    lead_id: LEAD_ID,
    template_id: TEMPLATE_ID,
    channel: CommChannel.SMS,
    recipient: '9876543210',
    consent_basis: ConsentPurpose.LEAD_CONTACT,
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

/** Lead row shape as returned by the DB read. */
function makeLeadRow() {
  return {
    lead_id: LEAD_ID,
    org_id: ORG_ID,
    owner_id: USER_ID,
    branch_id: null,
    team_id: null,
  };
}

/** Consent record row — granted. */
function makeConsentRow() {
  return {
    consent_id: '00000000-0000-0000-0005-000000000001',
    state: 'granted' as const,
  };
}

/** Valid send DTO. */
const VALID_DTO = {
  template_id: TEMPLATE_ID,
  channel: CommChannel.SMS,
  consent_basis: ConsentPurpose.LEAD_CONTACT,
  recipient: '9876543210',
} as const;

// ── Mock builders ─────────────────────────────────────────────────────────────

function fakeUow(insertResult?: CommLogRow): UnitOfWork {
  const log = insertResult ?? makeCommLogRow();
  return {
    run: jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn({ __tx: true, result: log })),
    tx: jest.fn(),
    isActive: false,
  } as unknown as UnitOfWork;
}

function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

function fakeTemplateRepo(overrides: Partial<TemplateRepository> = {}): TemplateRepository {
  return {
    findActiveById: jest.fn().mockResolvedValue(makeTemplateRow()),
    findById: jest.fn().mockResolvedValue(makeTemplateRow()),
    list: jest.fn(),
    insert: jest.fn(),
    ...overrides,
  } as unknown as TemplateRepository;
}

function fakeCommRepo(overrides: Partial<CommunicationRepository> = {}): CommunicationRepository {
  return {
    insert: jest.fn().mockResolvedValue(makeCommLogRow()),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(makeCommLogRow()),
    ...overrides,
  } as unknown as CommunicationRepository;
}

function fakeChannel(): NotificationChannelPort {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * Build a DB mock for the service.
 * The dispatch service does three DB reads: lead exists, consent_records, notification_preferences.
 */
function buildDb(opts: {
  leadExists?: boolean;
  consentGranted?: boolean;
  optedOut?: boolean;
} = {}) {
  const { leadExists = true, consentGranted = true, optedOut = false } = opts;

  let queryCount = 0;

  const makeMockQuery = () => ({
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    executeTakeFirst: jest.fn().mockImplementation(() => {
      queryCount++;
      // Query 1: lead lookup
      if (queryCount === 1) {
        return Promise.resolve(leadExists ? makeLeadRow() : undefined);
      }
      // Query 2: consent_records
      if (queryCount === 2) {
        return Promise.resolve(consentGranted ? makeConsentRow() : undefined);
      }
      // Query 3: notification_preferences
      if (queryCount === 3) {
        return Promise.resolve(optedOut ? { opted_in: false } : undefined);
      }
      return Promise.resolve(undefined);
    }),
  });

  return {
    selectFrom: jest.fn().mockReturnValue(makeMockQuery()),
  };
}

function makeService(opts: {
  db?: ReturnType<typeof buildDb>;
  templateRepo?: Partial<TemplateRepository>;
  commRepo?: Partial<CommunicationRepository>;
  channel?: NotificationChannelPort;
  uow?: UnitOfWork;
} = {}) {
  const db = opts.db ?? buildDb();
  const templateRepo = fakeTemplateRepo(opts.templateRepo);
  const commRepo = fakeCommRepo(opts.commRepo);
  const channel = opts.channel ?? fakeChannel();
  const uow = opts.uow ?? fakeUow();
  const audit = fakeAudit();

  const service = new NotificationDispatchService(
    templateRepo,
    commRepo,
    uow,
    audit,
    channel,
    db as never,
    fakeLogger as never,
  );

  return { service, commRepo, templateRepo, channel, uow, audit, db };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationDispatchService', () => {
  describe('T03 / happy path', () => {
    it('returns 202 queued and inserts communication_logs row', async () => {
      const { service, commRepo, audit } = makeService();

      const result = await service.send(LEAD_ID, VALID_DTO, RM_USER);

      expect(result.status).toBe('queued');
      expect(result.communication_log_id).toBe(COMM_LOG_ID);
      expect(commRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: LEAD_ID,
          template_id: TEMPLATE_ID,
          channel: CommChannel.SMS,
          consent_basis: ConsentPurpose.LEAD_CONTACT,
        }),
        expect.anything(), // tx
      );
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.COMM_SEND,
          entity_type: 'communication_logs',
          lead_id: LEAD_ID,
          actor_id: USER_ID,
        }),
        expect.anything(),
      );
    });
  });

  describe('T08 — consent gate: no ConsentRecord', () => {
    it('throws FORBIDDEN with CONSENT_MISSING when consent record absent', async () => {
      const { service } = makeService({ db: buildDb({ consentGranted: false }) });

      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        detail: { reason: 'CONSENT_MISSING' },
      });
    });
  });

  describe('T09 — opted-out preference blocks dispatch', () => {
    it('throws FORBIDDEN with CONSENT_MISSING when opted_in=false', async () => {
      const { service } = makeService({ db: buildDb({ optedOut: true }) });

      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        detail: { reason: 'CONSENT_MISSING' },
      });
    });
  });

  describe('T10 — marketing blocked without marketing consent', () => {
    it('throws FORBIDDEN+CONSENT_MISSING when template.category=marketing but consent_basis != marketing', async () => {
      const marketingTemplate = makeTemplateRow({ category: CommCategory.MARKETING });
      const { service } = makeService({
        templateRepo: { findActiveById: jest.fn().mockResolvedValue(marketingTemplate) },
      });

      const dto = { ...VALID_DTO, consent_basis: ConsentPurpose.LEAD_CONTACT };
      await expect(service.send(LEAD_ID, dto, RM_USER)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        detail: { reason: 'CONSENT_MISSING' },
      });
    });
  });

  describe('T11 — template not active', () => {
    it('throws NOT_FOUND when template is not found or not active', async () => {
      const { service } = makeService({
        templateRepo: { findActiveById: jest.fn().mockResolvedValue(undefined) },
      });

      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('T12 — channel mismatch', () => {
    it('throws VALIDATION_ERROR when template.channel != dto.channel', async () => {
      const emailTemplate = makeTemplateRow({ channel: CommChannel.EMAIL });
      const { service } = makeService({
        templateRepo: { findActiveById: jest.fn().mockResolvedValue(emailTemplate) },
      });

      // dto requests SMS but template is email
      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('Lead not found', () => {
    it('throws NOT_FOUND when lead does not exist', async () => {
      const { service } = makeService({ db: buildDb({ leadExists: false }) });

      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('T17 — transaction rollback on DB error', () => {
    it('propagates error when UOW fails after consent check', async () => {
      const failingUow: UnitOfWork = {
        run: jest.fn().mockRejectedValue(new Error('db error after insert')),
        tx: jest.fn(),
        isActive: false,
      } as unknown as UnitOfWork;

      const { service, commRepo } = makeService({ uow: failingUow });

      await expect(service.send(LEAD_ID, VALID_DTO, RM_USER)).rejects.toThrow('db error after insert');
      // The commRepo.insert should not have been called outside the uow (it's inside the failing fn)
      // The uow.run mock itself fails so insert is never called
      expect(commRepo.insert).not.toHaveBeenCalled();
    });
  });
});
