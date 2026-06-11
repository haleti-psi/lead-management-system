import { Logger } from 'nestjs-pino';

import { AuditAction, DataScope, RoleCode } from '@lms/shared';

import { AuditAppender, AuditChainConsumer } from '../../core/audit';
import {
  computeAfterHash,
  GENESIS_PREV_HASH,
  type CanonicalAuditRow,
} from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { MaskingService } from '../../core/masking';
import { isDomainException } from '../../core/http';
import { AuditExplorerService } from './audit-explorer.service';
import {
  AuditExplorerRepository,
  type AuditExplorerRow,
  type ActiveGrant,
  type AuditDetailRow,
} from './audit-explorer.repository';
import type { AuditExplorerQueryDto } from './dto/audit-explorer-query.dto';
import type { AuditUnmaskDto } from './dto/audit-unmask.dto';

/**
 * FR-123 unit tests for {@link AuditExplorerService}: badge computation
 * (not_checked / intact / broken+warn), ADMIN scope (lead_id zeroing + action
 * filter + lead_id-filter rejection), masking of `detail` PII, `ip_device`
 * exclusion, role authorisation (DPO/ADMIN only), and the audited single-field
 * unmask. The real (pure) MaskingService + AuditChainConsumer are used so the
 * masking patterns and chain verification are exercised for real; the repository
 * and audit appender are mocked.
 */

const ORG = '00000000-0000-0000-0000-000000000001';

function user(role: RoleCode, scope: DataScope): AuthUser {
  return { userId: `${role}-1`, orgId: ORG, role, scope, jti: 'jti-1' };
}

const DPO = user(RoleCode.DPO, DataScope.M);
const ADMIN = user(RoleCode.ADMIN, DataScope.A);
const RM = user(RoleCode.RM, DataScope.O);
const BM = user(RoleCode.BM, DataScope.B);

const BASE_QUERY: AuditExplorerQueryDto = { page: 1, limit: 25 };

function explorerRow(overrides: Partial<AuditExplorerRow> = {}): AuditExplorerRow {
  return {
    audit_id: 'a1',
    actor_id: 'u1',
    actor_display: 'Ravi Sharma · RM',
    action: AuditAction.STAGE_TRANSITION,
    entity_type: 'leads',
    entity_id: 'lead-1',
    lead_id: 'lead-1',
    before_hash: null,
    after_hash: null,
    prev_audit_hash: null,
    detail: null,
    created_at: new Date('2026-06-09T08:00:00.000Z'),
    ...overrides,
  };
}

function canonical(r: AuditExplorerRow): CanonicalAuditRow {
  return {
    audit_id: r.audit_id,
    org_id: ORG,
    actor_id: r.actor_id,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    lead_id: r.lead_id,
    detail: r.detail,
    created_at: r.created_at,
  };
}

/** Build a correctly-sealed chain (oldest→newest) and return it NEWEST-first. */
function sealedNewestFirst(rows: AuditExplorerRow[]): AuditExplorerRow[] {
  let prev = GENESIS_PREV_HASH;
  for (const r of rows) {
    r.prev_audit_hash = prev;
    r.after_hash = computeAfterHash(prev, canonical(r));
    prev = r.after_hash;
  }
  return [...rows].reverse();
}

interface Mocks {
  repo: jest.Mocked<Pick<AuditExplorerRepository, 'search' | 'count' | 'findActiveBreakGlass' | 'findDetailById'>>;
  audit: { append: jest.Mock };
  logger: { warn: jest.Mock; log: jest.Mock };
}

function build(rows: AuditExplorerRow[], opts: { grant?: ActiveGrant; detailRow?: AuditDetailRow } = {}): {
  service: AuditExplorerService;
  mocks: Mocks;
} {
  const repo = {
    search: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(rows.length),
    findActiveBreakGlass: jest.fn().mockResolvedValue(opts.grant),
    findDetailById: jest.fn().mockResolvedValue(opts.detailRow),
  } as Mocks['repo'];
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const logger = { warn: jest.fn(), log: jest.fn() };
  const chain = new AuditChainConsumer({} as never, logger as unknown as Logger);
  const service = new AuditExplorerService(
    repo as unknown as AuditExplorerRepository,
    chain,
    new MaskingService(),
    audit as unknown as AuditAppender,
    logger as unknown as Logger,
  );
  return { service, mocks: { repo, audit, logger } };
}

describe('AuditExplorerService.search — integrity badge', () => {
  it('returns empty items and a not_checked badge when no rows match', async () => {
    const { service } = build([]);
    const result = await service.search(BASE_QUERY, DPO);
    expect(result.items).toEqual([]);
    expect(result.integrityBadge).toBe('not_checked');
    expect(result.integrityBreakAt).toBeNull();
  });

  it('returns a not_checked badge for a single row', async () => {
    const { service } = build(sealedNewestFirst([explorerRow({ audit_id: 'only' })]));
    const result = await service.search(BASE_QUERY, DPO);
    expect(result.integrityBadge).toBe('not_checked');
  });

  it('returns an intact badge when every prev_audit_hash chains correctly', async () => {
    const rows = sealedNewestFirst([
      explorerRow({ audit_id: 'r0', created_at: new Date('2026-06-09T08:00:00Z') }),
      explorerRow({ audit_id: 'r1', created_at: new Date('2026-06-09T08:01:00Z') }),
      explorerRow({ audit_id: 'r2', created_at: new Date('2026-06-09T08:02:00Z') }),
    ]);
    const { service } = build(rows);
    const result = await service.search(BASE_QUERY, DPO);
    expect(result.integrityBadge).toBe('intact');
    expect(result.integrityBreakAt).toBeNull();
    expect(result.integrityCheckedCount).toBe(3);
  });

  it('returns a broken badge, sets integrity_break_at, and logs a warn on a chain break', async () => {
    const rows = sealedNewestFirst([
      explorerRow({ audit_id: 'r0', created_at: new Date('2026-06-09T08:00:00Z') }),
      explorerRow({ audit_id: 'r1', created_at: new Date('2026-06-09T08:01:00Z') }),
      explorerRow({ audit_id: 'r2', created_at: new Date('2026-06-09T08:02:00Z') }),
    ]);
    // rows is newest-first [r2, r1, r0]; break the link into r1 (oldest→newest the
    // first broken link is r1).
    const r1 = rows.find((r) => r.audit_id === 'r1')!;
    r1.prev_audit_hash = 'tampered';
    const { service, mocks } = build(rows);

    const result = await service.search(BASE_QUERY, DPO);

    expect(result.integrityBadge).toBe('broken');
    expect(result.integrityBreakAt).toBe('r1');
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn.mock.calls[0][0]).toMatchObject({ event: 'audit_chain_break', break_at: 'r1' });
  });
});

describe('AuditExplorerService.search — ADMIN scope', () => {
  it('zeros lead_id on every item and forces the action allow-list filter', async () => {
    const rows = sealedNewestFirst([
      explorerRow({ audit_id: 'c1', action: AuditAction.CONFIG_CHANGE, lead_id: 'lead-9' }),
    ]);
    const { service, mocks } = build(rows);

    const result = await service.search(BASE_QUERY, ADMIN);

    expect(result.items.every((i) => i.lead_id === null)).toBe(true);
    const filtersArg = mocks.repo.search.mock.calls[0][0];
    expect(filtersArg.actionIn).toEqual(expect.arrayContaining([AuditAction.CONFIG_CHANGE]));
    expect(filtersArg.lead_id).toBeUndefined();
  });

  it('rejects an ADMIN lead_id filter with FORBIDDEN before any query', async () => {
    const { service, mocks } = build([]);
    await expect(
      service.search({ ...BASE_QUERY, lead_id: '11111111-1111-1111-1111-111111111111' }, ADMIN),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.repo.search).not.toHaveBeenCalled();
  });
});

describe('AuditExplorerService.search — masking & ip_device', () => {
  it('masks PII fields in detail for a DPO (no break-glass on the list)', async () => {
    const rows = sealedNewestFirst([
      explorerRow({
        audit_id: 'm1',
        detail: { mobile: '9812345678', pan_token: 'ABCDE1234F', ckyc_id: 'CK123', note: 'ok' },
      }),
    ]);
    const { service } = build(rows, { grant: { grant_id: 'g1', scope_type: 'all', scope_ref: null } });

    const result = await service.search(BASE_QUERY, DPO);
    const detail = result.items[0]!.detail!;
    expect(detail.mobile).toBe('98xxxxxx78');
    expect(detail.pan_token).toBe('ABCxxxx4F');
    expect(detail.ckyc_id).toBe('[REDACTED]');
    expect(detail.note).toBe('ok'); // non-PII preserved
  });

  it('never includes an ip_device key in any item', async () => {
    const rows = sealedNewestFirst([explorerRow({ audit_id: 'i1' })]);
    const { service } = build(rows);
    const result = await service.search(BASE_QUERY, DPO);
    expect(Object.prototype.hasOwnProperty.call(result.items[0]!, 'ip_device')).toBe(false);
  });
});

describe('AuditExplorerService.search — authorisation', () => {
  it('rejects RM with FORBIDDEN', async () => {
    const { service, mocks } = build([]);
    await expect(service.search(BASE_QUERY, RM)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.repo.search).not.toHaveBeenCalled();
  });

  it('rejects BM with FORBIDDEN', async () => {
    const { service } = build([]);
    const err = await service.search(BASE_QUERY, BM).catch((e: unknown) => e);
    expect(isDomainException(err) && err.code).toBe('FORBIDDEN');
  });
});

describe('AuditExplorerService.unmask', () => {
  const detailRow: AuditDetailRow = {
    audit_id: 'a1',
    action: AuditAction.STAGE_TRANSITION,
    entity_type: 'leads',
    entity_id: 'lead-1',
    lead_id: 'lead-1',
    detail: { mobile: '9812345678' },
  };
  const DTO: AuditUnmaskDto = { audit_id: 'a1', field: 'mobile', reason: 'DSAR evidence request #4471' };

  it('reveals the raw field value and writes an audited break_glass_access event', async () => {
    const { service, mocks } = build([], {
      grant: { grant_id: 'g1', scope_type: 'all', scope_ref: null },
      detailRow,
    });

    const result = await service.unmask(DTO, DPO);

    expect(result).toMatchObject({ audit_id: 'a1', field: 'mobile', value: '9812345678' });
    expect(mocks.audit.append).toHaveBeenCalledTimes(1);
    const entry = mocks.audit.append.mock.calls[0][0];
    expect(entry.action).toBe(AuditAction.BREAK_GLASS_ACCESS);
    expect(entry.detail).toMatchObject({ op: 'audit_unmask', target_audit_id: 'a1', field: 'mobile', reason: DTO.reason });
    // The revealed raw value must never be written into the audit detail.
    expect(JSON.stringify(entry.detail)).not.toContain('9812345678');
  });

  it('rejects unmask with FORBIDDEN when no active break-glass grant exists', async () => {
    const { service, mocks } = build([], { grant: undefined, detailRow });
    await expect(service.unmask(DTO, DPO)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.audit.append).not.toHaveBeenCalled();
  });

  it('rejects unmask for a non-DPO/ADMIN role with FORBIDDEN', async () => {
    const { service } = build([], { grant: { grant_id: 'g1', scope_type: 'all', scope_ref: null }, detailRow });
    await expect(service.unmask(DTO, RM)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns NOT_FOUND when the target audit row does not exist', async () => {
    const { service } = build([], { grant: { grant_id: 'g1', scope_type: 'all', scope_ref: null }, detailRow: undefined });
    await expect(service.unmask(DTO, DPO)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
