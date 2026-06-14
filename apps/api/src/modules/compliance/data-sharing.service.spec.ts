/**
 * FR-111 — DataSharingService unit tests (Jest).
 * Covers T-01 through T-04 (consent verification + log insert + audit).
 * INV-5 structural: service has no UPDATE/DELETE path.
 */

import {
  AuditAction,
  ConsentPurpose,
  DataCategory,
  ERROR_CODES,
} from '@lms/shared';

import type { AuditAppender } from '../../core/audit';
import { DomainException } from '../../core/http';
import type { DbTransaction } from '../../core/db';
import { DataSharingService, type LogShareInput } from './data-sharing.service';

// ── helpers ───────────────────────────────────────────────────────────────────

const GRANTED_CONSENT = {
  consent_id: 'consent-001',
  state: 'granted',
  expires_at: null,
};

/**
 * Build a minimal Kysely transaction mock.
 * The selectFrom chain returns the consent row (or undefined) from
 * executeTakeFirst. The insertInto chain resolves successfully unless
 * insertShouldThrow is set.
 */
function buildTxMock({
  consentRow,
  insertShouldThrow = false,
}: {
  consentRow?: typeof GRANTED_CONSENT;
  insertShouldThrow?: boolean;
}): DbTransaction {
  const execute = insertShouldThrow
    ? jest.fn().mockRejectedValue(new Error('DB error'))
    : jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ execute });
  const insertInto = jest.fn().mockReturnValue({ values });

  const executeTakeFirst = jest.fn().mockResolvedValue(consentRow ?? undefined);
  const limit = jest.fn().mockReturnValue({ executeTakeFirst });
  const orderBy = jest.fn().mockReturnValue({ limit });

  // Chain: where × 5 + where(eb) → orderBy
  const where6 = jest.fn().mockReturnValue({ orderBy });
  const where5 = jest.fn().mockReturnValue({ where: where6 });
  const where4 = jest.fn().mockReturnValue({ where: where5 });
  const where3 = jest.fn().mockReturnValue({ where: where4 });
  const where2 = jest.fn().mockReturnValue({ where: where3 });
  const where1 = jest.fn().mockReturnValue({ where: where2 });
  const select = jest.fn().mockReturnValue({ where: where1 });
  const selectFrom = jest.fn().mockReturnValue({ select });

  return { selectFrom, insertInto } as unknown as DbTransaction;
}

// ── mock audit ────────────────────────────────────────────────────────────────

const mockAuditAppend = jest.fn().mockResolvedValue(undefined);
const mockAudit = { append: mockAuditAppend } as unknown as AuditAppender;

// ── base input ────────────────────────────────────────────────────────────────

const BASE_INPUT: LogShareInput = {
  leadId: 'lead-001',
  orgId: 'org-001',
  recipient: 'los-provider',
  purpose: ConsentPurpose.LOS_HANDOFF,
  dataCategory: DataCategory.FINANCIAL,
  consentId: null,
  actorId: 'user-001',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DataSharingService', () => {
  let service: DataSharingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataSharingService(mockAudit);
  });

  // ── T-01: happy path ───────────────────────────────────────────────────────

  it('T-01: inserts data_sharing_logs row and emits audit on granted consent', async () => {
    const tx = buildTxMock({ consentRow: GRANTED_CONSENT });

    await service.logShare(BASE_INPUT, tx);

    expect(tx.insertInto).toHaveBeenCalledWith('data_sharing_logs');
    expect(mockAuditAppend).toHaveBeenCalledTimes(1);
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'data_sharing_logs',
        lead_id: BASE_INPUT.leadId,
      }),
      tx,
    );
  });

  // ── T-02: no granted record ────────────────────────────────────────────────

  it('T-02: throws FORBIDDEN with CONSENT_MISSING when no granted consent exists', async () => {
    const tx = buildTxMock({ consentRow: undefined });

    await expect(service.logShare(BASE_INPUT, tx)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      detail: { reason: 'CONSENT_MISSING' },
    });

    // insert must NOT have been called
    expect(tx.insertInto).not.toHaveBeenCalled();
    // audit must NOT have been emitted
    expect(mockAuditAppend).not.toHaveBeenCalled();
  });

  // ── T-03: expired consent (db returns undefined — filter excludes it) ──────

  it('T-03: throws CONSENT_MISSING when consent expires_at filter excludes the record', async () => {
    const tx = buildTxMock({ consentRow: undefined });

    let caught: unknown;
    try {
      await service.logShare(BASE_INPUT, tx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DomainException);
    const de = caught as DomainException;
    expect(de.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(de.detail).toEqual({ reason: 'CONSENT_MISSING' });
  });

  // ── T-04: withdrawn consent (state filter excludes it) ────────────────────

  it('T-04: throws CONSENT_MISSING when consent state is withdrawn (db returns undefined)', async () => {
    const tx = buildTxMock({ consentRow: undefined });

    await expect(service.logShare(BASE_INPUT, tx)).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
      detail: { reason: 'CONSENT_MISSING' },
    });
  });

  // ── INV-5 structural: no UPDATE path ──────────────────────────────────────

  it('INV-5: DataSharingService exposes only logShare (no UPDATE/DELETE path)', () => {
    const proto = DataSharingService.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor',
    );
    expect(methods).toEqual(['logShare']);
  });
});
