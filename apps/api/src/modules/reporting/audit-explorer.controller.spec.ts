import { AuditAction, RoleCode, DataScope } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { AbacRequestContext } from '../../core/auth';
import { AuditExplorerController } from './audit-explorer.controller';
import type {
  AuditExplorerResult,
  AuditExplorerService,
  AuditUnmaskResult,
} from './audit-explorer.service';
import type { AuditExplorerQueryDto } from './dto/audit-explorer-query.dto';
import type { AuditUnmaskDto } from './dto/audit-unmask.dto';

/**
 * FR-123 component tests for {@link AuditExplorerController}: it returns a full
 * `{ data, meta, error }` envelope whose `data` carries items + integrity_badge
 * and whose `meta` carries the pagination + integrity diagnostics, and it
 * delegates unmask to the service. The service is mocked.
 */

const DPO: AuthUser = { userId: 'dpo-1', orgId: 'org-1', role: RoleCode.DPO, scope: DataScope.M, jti: 'j' };

function serviceMock(over: {
  search?: AuditExplorerResult;
  unmask?: AuditUnmaskResult;
}): AuditExplorerService {
  return {
    search: jest.fn().mockResolvedValue(
      over.search ?? {
        items: [],
        integrityBadge: 'not_checked',
        integrityBreakAt: null,
        integrityCheckedCount: 0,
        pagination: { page: 1, limit: 25, total: 0 },
      },
    ),
    unmask: jest.fn().mockResolvedValue(over.unmask ?? { audit_id: 'a1', field: 'mobile', value: '9812345678' }),
  } as unknown as AuditExplorerService;
}

describe('AuditExplorerController.search', () => {
  it('wraps the result in an envelope with integrity diagnostics in meta', async () => {
    const result: AuditExplorerResult = {
      items: [
        {
          audit_id: 'a1',
          actor_id: 'u1',
          actor_display: 'Ravi · RM',
          action: AuditAction.STAGE_TRANSITION,
          entity_type: 'leads',
          entity_id: 'lead-1',
          lead_id: 'lead-1',
          before_hash: null,
          after_hash: 'h',
          prev_audit_hash: null,
          detail: null,
          created_at: new Date('2026-06-09T08:00:00Z'),
        },
      ],
      integrityBadge: 'intact',
      integrityBreakAt: null,
      integrityCheckedCount: 1,
      pagination: { page: 1, limit: 25, total: 1 },
    };
    const service = serviceMock({ search: result });
    const controller = new AuditExplorerController(service);

    const query: AuditExplorerQueryDto = { page: 1, limit: 25 };
    const envelope = await controller.search(query, DPO);

    expect(envelope.error).toBeNull();
    expect(envelope.data?.integrity_badge).toBe('intact');
    expect(envelope.data?.items).toHaveLength(1);
    expect(envelope.meta.pagination).toEqual({ page: 1, limit: 25, total: 1 });
    expect(envelope.meta).toMatchObject({ integrity_checked_count: 1, integrity_break_at: null });
    expect(service.search).toHaveBeenCalledWith(query, DPO);
  });
});

describe('AuditExplorerController.unmask', () => {
  it('delegates to the service with the dto, user, and request', async () => {
    const service = serviceMock({});
    const controller = new AuditExplorerController(service);
    const dto: AuditUnmaskDto = { audit_id: 'a1', field: 'mobile', reason: 'evidence request #1' };
    const req = { headers: {} } as AbacRequestContext;

    const result = await controller.unmask(dto, DPO, req);

    expect(result).toMatchObject({ audit_id: 'a1', field: 'mobile' });
    expect(service.unmask).toHaveBeenCalledWith(dto, DPO, req);
  });
});
