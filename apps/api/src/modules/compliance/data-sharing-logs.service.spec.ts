/**
 * FR-111 — DataSharingLogsService unit tests (Jest).
 *
 * Covers the DPO-only role assertion (BLOCKER 1 fix):
 *   T-SL-01: DPO → listForLead resolves (role permitted)
 *   T-SL-02: RM  → FORBIDDEN (non-DPO role rejected)
 *   T-SL-03: CUSTOMER → FORBIDDEN (non-DPO role rejected)
 *   T-SL-04: HEAD → FORBIDDEN (HEAD has consent_ledger:A but is NOT DPO)
 *   T-SL-05: ADMIN → FORBIDDEN (ADMIN has consent_ledger:A but is NOT DPO)
 *   T-SL-06: Lead not found → NOT_FOUND (after DPO check passes)
 */

import { ERROR_CODES, RoleCode, DataScope } from '@lms/shared';

import type { KyselyDb } from '../../core/db';
import type { AuthUser } from '../../core/auth';
import { DataSharingLogsService } from './data-sharing-logs.service';
import type { DataSharingLogsRepository } from './data-sharing-logs.repository';

// ── helpers ───────────────────────────────────────────────────────────────────

const LEAD_ID = 'lead-001';
const ORG_ID = 'org-001';

function makeUser(role: string): AuthUser {
  return {
    userId: 'user-001',
    orgId: ORG_ID,
    role: role as AuthUser['role'],
    scope: DataScope.A,
    jti: 'jti-001',
  };
}

/**
 * Build a Kysely db mock. When `leadExists` is true, `executeTakeFirst` returns
 * a minimal lead row; otherwise returns undefined (lead not found).
 */
function buildDbMock(leadExists: boolean): KyselyDb {
  const executeTakeFirst = jest.fn().mockResolvedValue(
    leadExists ? { lead_id: LEAD_ID } : undefined,
  );
  const limit = jest.fn().mockReturnValue({ executeTakeFirst });
  const where3 = jest.fn().mockReturnValue({ limit });
  const where2 = jest.fn().mockReturnValue({ where: where3 });
  const where1 = jest.fn().mockReturnValue({ where: where2 });
  const select = jest.fn().mockReturnValue({ where: where1 });
  const selectFrom = jest.fn().mockReturnValue({ select });
  return { selectFrom } as unknown as KyselyDb;
}

const mockRepo = {
  findByLeadId: jest.fn().mockResolvedValue([]),
  countByLeadId: jest.fn().mockResolvedValue(0),
} as unknown as DataSharingLogsRepository;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DataSharingLogsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── T-SL-01: DPO → allowed ────────────────────────────────────────────────

  it('T-SL-01: resolves for DPO role (permitted)', async () => {
    const db = buildDbMock(true);
    const service = new DataSharingLogsService(db, mockRepo);

    const result = await service.listForLead(LEAD_ID, makeUser(RoleCode.DPO), 1, 25);

    expect(result).toMatchObject({ rows: [], pagination: { page: 1, limit: 25, total: 0 } });
  });

  // ── T-SL-02: RM → FORBIDDEN ───────────────────────────────────────────────

  it('T-SL-02: throws FORBIDDEN for RM role', async () => {
    const db = buildDbMock(true);
    const service = new DataSharingLogsService(db, mockRepo);

    await expect(
      service.listForLead(LEAD_ID, makeUser(RoleCode.RM), 1, 25),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    // DB must NOT have been queried after the role rejection.
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  // ── T-SL-03: CUSTOMER → FORBIDDEN ────────────────────────────────────────

  it('T-SL-03: throws FORBIDDEN for CUSTOMER role', async () => {
    const db = buildDbMock(true);
    const service = new DataSharingLogsService(db, mockRepo);

    await expect(
      service.listForLead(LEAD_ID, makeUser(RoleCode.CUSTOMER), 1, 25),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  // ── T-SL-04: HEAD → FORBIDDEN (has consent_ledger:A but not DPO) ─────────

  it('T-SL-04: throws FORBIDDEN for HEAD role (consent_ledger:A but not DPO)', async () => {
    const db = buildDbMock(true);
    const service = new DataSharingLogsService(db, mockRepo);

    await expect(
      service.listForLead(LEAD_ID, makeUser(RoleCode.HEAD), 1, 25),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  // ── T-SL-05: ADMIN → FORBIDDEN (has consent_ledger:A but not DPO) ────────

  it('T-SL-05: throws FORBIDDEN for ADMIN role (consent_ledger:A but not DPO)', async () => {
    const db = buildDbMock(true);
    const service = new DataSharingLogsService(db, mockRepo);

    await expect(
      service.listForLead(LEAD_ID, makeUser(RoleCode.ADMIN), 1, 25),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });

    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  // ── T-SL-06: DPO + lead not found → NOT_FOUND ────────────────────────────

  it('T-SL-06: throws NOT_FOUND for DPO when lead does not exist', async () => {
    const db = buildDbMock(false);
    const service = new DataSharingLogsService(db, mockRepo);

    await expect(
      service.listForLead(LEAD_ID, makeUser(RoleCode.DPO), 1, 25),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});
