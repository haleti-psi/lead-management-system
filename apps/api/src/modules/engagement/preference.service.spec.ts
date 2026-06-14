import {
  AuditAction,
  CommChannel,
  ConsentPurpose,
  DataScope,
  ERROR_CODES,
  RoleCode,
  SubjectType,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import type { UnitOfWork } from '../../core/db';
import type { PreferenceRow } from './preference.repository';
import { PreferenceRepository } from './preference.repository';
import { PreferenceService } from './preference.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUBJECT_REF = '00000000-0000-0000-0001-000000000001';
const USER_ID = '00000000-0000-0000-0003-000000000001';
const PREF_ID = '00000000-0000-0000-0004-000000000001';

const BM_USER: AuthUser = {
  userId: USER_ID,
  orgId: ORG_ID,
  role: RoleCode.BM,
  scope: DataScope.B,
  jti: 'jti-bm',
};

function makePrefRow(
  channel: CommChannel,
  purpose: ConsentPurpose,
  optedIn: boolean,
): PreferenceRow {
  return {
    notification_preference_id: PREF_ID,
    channel,
    purpose,
    opted_in: optedIn,
    updated_at: new Date('2026-06-10T09:00:00.000Z'),
  };
}

/** UnitOfWork mock: invokes the callback synchronously with a sentinel tx. */
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

function fakeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as import('nestjs-pino').PinoLogger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PreferenceService (FR-103)', () => {
  // ── T17/T18/T19 — Unit tier ─────────────────────────────────────────────────

  describe('upsertBatch', () => {
    it('T19 — deduplicates (channel, purpose) pairs; last item wins', async () => {
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn().mockResolvedValue(
          makePrefRow(CommChannel.WHATSAPP, ConsentPurpose.MARKETING, false),
        ),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [
            { channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: true },
            { channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: false },
          ],
        },
        BM_USER,
      );

      // After dedup, only one upsert call (the last value: opted_in=false).
      expect(repo.upsertOne).toHaveBeenCalledTimes(1);
      expect(repo.upsertOne).toHaveBeenCalledWith(
        ORG_ID,
        SubjectType.CUSTOMER,
        SUBJECT_REF,
        CommChannel.WHATSAPP,
        ConsentPurpose.MARKETING,
        false,
        USER_ID,
        { __tx: true },
      );
    });

    it('T18 — transaction rollback on DB error: no partial state', async () => {
      const uow: UnitOfWork = {
        run: jest.fn(async (_fn: (tx: object) => Promise<unknown>) => {
          throw new Error('DB connection lost');
        }),
        tx: jest.fn(),
        isActive: false,
      } as unknown as UnitOfWork;

      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      await expect(
        service.upsertBatch(
          {
            subject_type: SubjectType.CUSTOMER,
            subject_ref: SUBJECT_REF,
            preferences: [
              { channel: CommChannel.EMAIL, purpose: ConsentPurpose.KYC, opted_in: true },
              { channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false },
              { channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.DOCUMENT_PROCESSING, opted_in: true },
            ],
          },
          BM_USER,
        ),
      ).rejects.toThrow('DB connection lost');

      // No upsert calls reached — the error was in the tx wrapper.
      expect(repo.upsertOne).not.toHaveBeenCalled();
    });

    it('happy path — single opt-out; returns saved row and no warnings', async () => {
      const savedRow = makePrefRow(CommChannel.WHATSAPP, ConsentPurpose.MARKETING, false);
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn().mockResolvedValue(savedRow),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      const { result, warnings } = await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [
            { channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.MARKETING, opted_in: false },
          ],
        },
        BM_USER,
      );

      expect(result.subject_type).toBe(SubjectType.CUSTOMER);
      expect(result.subject_ref).toBe(SUBJECT_REF);
      expect(result.preferences).toHaveLength(1);
      expect(result.preferences[0].opted_in).toBe(false);
      // Marketing opt-out does NOT trigger transactional warning.
      expect(warnings).toHaveLength(0);
    });

    it('T14 — transactional opt-out warning on document_processing', async () => {
      const savedRow = makePrefRow(CommChannel.EMAIL, ConsentPurpose.DOCUMENT_PROCESSING, false);
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn().mockResolvedValue(savedRow),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      const { warnings } = await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [
            { channel: CommChannel.EMAIL, purpose: ConsentPurpose.DOCUMENT_PROCESSING, opted_in: false },
          ],
        },
        BM_USER,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('KYC/document reminders');
    });

    it('T14 — transactional opt-out warning on kyc', async () => {
      const savedRow = makePrefRow(CommChannel.SMS, ConsentPurpose.KYC, false);
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn().mockResolvedValue(savedRow),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      const { warnings } = await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.KYC, opted_in: false }],
        },
        BM_USER,
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].field).toBe('preferences[0]');
    });

    it('no warning when opted_in=true for transactional purpose', async () => {
      const savedRow = makePrefRow(CommChannel.SMS, ConsentPurpose.KYC, true);
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn().mockResolvedValue(savedRow),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      const { warnings } = await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.KYC, opted_in: true }],
        },
        BM_USER,
      );

      expect(warnings).toHaveLength(0);
    });

    it('audit is written inside the transaction', async () => {
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest
          .fn()
          .mockResolvedValue(makePrefRow(CommChannel.SMS, ConsentPurpose.MARKETING, false)),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [
            { channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false },
          ],
        },
        BM_USER,
      );

      expect(audit.append).toHaveBeenCalledTimes(1);
      const [auditEntry, tx] = (audit.append as jest.Mock).mock.calls[0];
      expect(auditEntry.action).toBe(AuditAction.LEAD_UPDATE);
      expect(auditEntry.entity_type).toBe('notification_preferences');
      expect(auditEntry.detail.op).toBe('pref_change');
      expect(auditEntry.detail.subject_ref).toBe(SUBJECT_REF);
      // Audit was called with the UoW transaction sentinel.
      expect(tx).toEqual({ __tx: true });
    });

    it('batch of 3 produces one audit entry covering all changes', async () => {
      const uow = fakeUow();
      const audit = fakeAudit();
      let callCount = 0;
      const repo = {
        upsertOne: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(
            makePrefRow(CommChannel.EMAIL, ConsentPurpose.MARKETING, false),
          );
        }),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [
            { channel: CommChannel.EMAIL, purpose: ConsentPurpose.MARKETING, opted_in: false },
            { channel: CommChannel.SMS, purpose: ConsentPurpose.LEAD_CONTACT, opted_in: true },
            { channel: CommChannel.WHATSAPP, purpose: ConsentPurpose.COMMUNICATION, opted_in: true },
          ],
        },
        BM_USER,
      );

      expect(repo.upsertOne).toHaveBeenCalledTimes(3);
      // One audit entry per batch (not per row).
      expect(audit.append).toHaveBeenCalledTimes(1);
      const [auditEntry] = (audit.append as jest.Mock).mock.calls[0];
      expect(auditEntry.detail.changes).toHaveLength(3);
    });

    it('detail does not contain PII (only UUIDs and enum values)', async () => {
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest
          .fn()
          .mockResolvedValue(makePrefRow(CommChannel.SMS, ConsentPurpose.MARKETING, false)),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      await service.upsertBatch(
        {
          subject_type: SubjectType.CUSTOMER,
          subject_ref: SUBJECT_REF,
          preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
        },
        BM_USER,
      );

      const [auditEntry] = (audit.append as jest.Mock).mock.calls[0];
      // Must not contain PII: names, emails, phone numbers.
      expect(JSON.stringify(auditEntry.detail)).not.toMatch(/\+91|@|name/i);
    });

    it('MAJOR-4 — throws INTERNAL_ERROR when actor.orgId is null/undefined', async () => {
      const uow = fakeUow();
      const audit = fakeAudit();
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, uow, audit, fakeLogger());

      // Actor with undefined orgId (e.g. misconfigured token).
      const actorNoOrg = { ...BM_USER, orgId: undefined as unknown as string };

      await expect(
        service.upsertBatch(
          {
            subject_type: SubjectType.CUSTOMER,
            subject_ref: SUBJECT_REF,
            preferences: [{ channel: CommChannel.SMS, purpose: ConsentPurpose.MARKETING, opted_in: false }],
          },
          actorNoOrg,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL_ERROR });

      // No DB call should have been made.
      expect(repo.upsertOne).not.toHaveBeenCalled();
    });
  });

  // ── T17 — Default opted_in values ───────────────────────────────────────────

  describe('isAllowed (FR-101 seam)', () => {
    it('T17 — absent row + marketing purpose → false (opted-out by default)', async () => {
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn().mockResolvedValue(undefined),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const allowed = await service.isAllowed(
        SUBJECT_REF,
        CommChannel.WHATSAPP,
        ConsentPurpose.MARKETING,
        ORG_ID,
      );
      expect(allowed).toBe(false);
    });

    it('T17 — absent row + transactional purpose → true (opted-in by default)', async () => {
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn().mockResolvedValue(undefined),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const allowed = await service.isAllowed(
        SUBJECT_REF,
        CommChannel.SMS,
        ConsentPurpose.DOCUMENT_PROCESSING,
        ORG_ID,
      );
      expect(allowed).toBe(true);
    });

    it('existing row opted_in=false → false regardless of purpose', async () => {
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn().mockResolvedValue({ opted_in: false }),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const allowed = await service.isAllowed(
        SUBJECT_REF,
        CommChannel.SMS,
        ConsentPurpose.LEAD_CONTACT,
        ORG_ID,
      );
      expect(allowed).toBe(false);
    });

    it('existing row opted_in=true → true', async () => {
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn(),
        findOne: jest.fn().mockResolvedValue({ opted_in: true }),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const allowed = await service.isAllowed(
        SUBJECT_REF,
        CommChannel.WHATSAPP,
        ConsentPurpose.MARKETING,
        ORG_ID,
      );
      expect(allowed).toBe(true);
    });
  });

  // ── getBySubject ─────────────────────────────────────────────────────────────

  describe('getBySubject', () => {
    it('returns empty array when no preferences exist', async () => {
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const result = await service.getBySubject(SubjectType.CUSTOMER, SUBJECT_REF, ORG_ID);

      expect(result.preferences).toHaveLength(0);
      expect(result.subject_type).toBe(SubjectType.CUSTOMER);
      expect(result.subject_ref).toBe(SUBJECT_REF);
    });

    it('returns saved preferences from repo', async () => {
      const rows = [
        makePrefRow(CommChannel.WHATSAPP, ConsentPurpose.MARKETING, false),
        makePrefRow(CommChannel.EMAIL, ConsentPurpose.LEAD_CONTACT, true),
      ];
      const repo = {
        upsertOne: jest.fn(),
        findBySubject: jest.fn().mockResolvedValue(rows),
        findOne: jest.fn(),
      } as unknown as PreferenceRepository;

      const service = new PreferenceService(repo, fakeUow(), fakeAudit(), fakeLogger());

      const result = await service.getBySubject(SubjectType.CUSTOMER, SUBJECT_REF, ORG_ID);

      expect(result.preferences).toHaveLength(2);
      expect(result.preferences[0].opted_in).toBe(false);
      expect(result.preferences[1].opted_in).toBe(true);
    });
  });
});
