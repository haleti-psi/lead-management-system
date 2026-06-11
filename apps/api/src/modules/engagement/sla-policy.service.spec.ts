import { DataScope, RoleCode } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import type { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { SlaPolicyRepository, type SlaPolicyRow } from './sla-policy.repository';
import { SlaPolicyService } from './sla-policy.service';

/**
 * FR-104 unit tests for {@link SlaPolicyService}: scope-A enforcement on create
 * (TC-006), the create transaction (policy + config_version + audit, all via the
 * UnitOfWork — TC-001), duplicate-active CONFLICT (TC-012), and the list path
 * (TC-002). Collaborators are mocked; the UnitOfWork mock runs the callback with
 * a sentinel tx so the ordering/atomic-grouping is asserted without a DB.
 */

const ADMIN: AuthUser = {
  userId: 'admin-1',
  orgId: '00000000-0000-0000-0000-000000000001',
  role: RoleCode.ADMIN,
  scope: DataScope.A,
  jti: 'jti-1',
};

const DTO: CreateSlaPolicyDto = {
  name: 'First Contact – CV 4h',
  applies_to: 'first_contact',
  condition: { product_code: ['CV'] },
  threshold_minutes: 240,
  escalation_chain: [{ at_minutes: 240, notify_roles: [RoleCode.BM], action: 'notify' }],
};

function policyRow(overrides: Partial<SlaPolicyRow> = {}): SlaPolicyRow {
  return {
    sla_policy_id: 'pol-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    name: DTO.name,
    applies_to: 'first_contact',
    condition: null,
    threshold_minutes: 240,
    escalation_chain: [],
    is_active: false,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'admin-1',
    updated_by: 'admin-1',
    ...overrides,
  } as SlaPolicyRow;
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

describe('SlaPolicyService.create', () => {
  it('inserts policy + configuration_version + audit in one transaction (TC-001)', async () => {
    const repo = {
      activeDuplicateExists: jest.fn().mockResolvedValue(false),
      insertPolicy: jest.fn().mockResolvedValue(policyRow()),
      insertConfigVersion: jest.fn().mockResolvedValue('cfg-1'),
    } as unknown as SlaPolicyRepository;
    const uow = fakeUow();
    const audit = fakeAudit();
    const service = new SlaPolicyService(repo, uow, audit);

    const result = await service.create(DTO, ADMIN, DataScope.A);

    expect(uow.run).toHaveBeenCalledTimes(1);
    expect(repo.activeDuplicateExists).toHaveBeenCalledWith(DTO.name, DTO.applies_to, expect.anything());
    expect(repo.insertPolicy).toHaveBeenCalled();
    expect(repo.insertConfigVersion).toHaveBeenCalledWith('pol-1', DTO, 'admin-1', expect.anything());
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      sla_policy_id: 'pol-1',
      is_active: false,
      configuration_version_id: 'cfg-1',
      version: 1,
    });
    // Audit carries action=config_change for the sla_policies entity.
    const auditArg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(auditArg.action).toBe('config_change');
    expect(auditArg.entity_type).toBe('sla_policies');
    expect(auditArg.entity_id).toBe('pol-1');
  });

  it('rejects a scope-B caller with FORBIDDEN before any write (TC-006)', async () => {
    const repo = {
      activeDuplicateExists: jest.fn(),
      insertPolicy: jest.fn(),
      insertConfigVersion: jest.fn(),
    } as unknown as SlaPolicyRepository;
    const uow = fakeUow();
    const service = new SlaPolicyService(repo, uow, fakeAudit());

    await expect(service.create(DTO, ADMIN, DataScope.B)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(uow.run).not.toHaveBeenCalled();
    expect(repo.insertPolicy).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when an active duplicate exists (TC-012)', async () => {
    const repo = {
      activeDuplicateExists: jest.fn().mockResolvedValue(true),
      insertPolicy: jest.fn(),
      insertConfigVersion: jest.fn(),
    } as unknown as SlaPolicyRepository;
    const service = new SlaPolicyService(repo, fakeUow(), fakeAudit());

    try {
      await service.create(DTO, ADMIN, DataScope.A);
      fail('expected CONFLICT');
    } catch (err) {
      expect(isDomainException(err) && err.code).toBe('CONFLICT');
    }
    expect(repo.insertPolicy).not.toHaveBeenCalled();
  });
});

describe('SlaPolicyService.list', () => {
  it('returns rows with pagination meta (TC-002)', async () => {
    const rows = [policyRow({ sla_policy_id: 'p1' }), policyRow({ sla_policy_id: 'p2' })];
    const repo = {
      list: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(2),
    } as unknown as SlaPolicyRepository;
    const service = new SlaPolicyService(repo, fakeUow(), fakeAudit());

    const result = await service.list({ page: 1, limit: 25, applies_to: undefined, is_active: undefined });

    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 2 });
    expect(repo.list).toHaveBeenCalledWith(
      { applies_to: undefined, is_active: undefined },
      { page: 1, limit: 25 },
    );
  });
});
