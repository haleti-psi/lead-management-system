import { DataScope } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { isDomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { ConfigActivatorRegistry } from './activators/config-activator.registry';
import type { ConfigActivatorPort, ConfigurationVersionRow } from './activators/config-activator.port';
import { ConfigGovernanceRepository } from './config-governance.repository';
import { ConfigGovernanceService } from './config-governance.service';

/**
 * FR-132 unit tests for {@link ConfigGovernanceService}: scope-A enforcement,
 * self-approval block (T24/T06), wrong-status CONFLICT (T07/T08), NOT_FOUND
 * (T09/T10), the valid state-machine transitions (T21/T22/T23), activator
 * delegation, and transaction-rollback propagation (T18/T19). Collaborators are
 * mocked; the UnitOfWork mock runs the callback with a sentinel tx so ordering
 * and atomic grouping are asserted without a database.
 */

const TX = { __tx: true } as const;

const ADMIN: AuthUser = {
  userId: 'admin-1',
  orgId: '00000000-0000-0000-0000-000000000001',
  role: 'ADMIN' as AuthUser['role'],
  scope: DataScope.A,
  jti: 'jti-1',
};

function cvRow(overrides: Partial<ConfigurationVersionRow> = {}): ConfigurationVersionRow {
  return {
    configuration_version_id: 'cv-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    config_type: 'sla_policy',
    config_ref: 'pol-1',
    version: 1,
    maker_id: 'maker-1',
    checker_id: null,
    status: 'pending',
    effective_at: null,
    rollback_ref: null,
    diff: { name: 'x' },
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'maker-1',
    updated_by: 'maker-1',
    ...overrides,
  } as ConfigurationVersionRow;
}

function fakeUow(): UnitOfWork {
  return {
    run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
  } as unknown as UnitOfWork;
}

function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}

function fakeOutbox(): OutboxService {
  return { emit: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
}

function fakeActivator(): ConfigActivatorPort & {
  activate: jest.Mock;
  deactivate: jest.Mock;
} {
  return {
    configType: 'sla_policy',
    activate: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn().mockResolvedValue(undefined),
  };
}

function registryWith(activator?: ConfigActivatorPort): ConfigActivatorRegistry {
  const registry = new ConfigActivatorRegistry();
  if (activator) registry.register(activator);
  return registry;
}

describe('ConfigGovernanceService.approve', () => {
  it('approves a pending version → active, stamps checker, activates, audits + emits (T01/T21)', async () => {
    const cv = cvRow();
    const repo = {
      findById: jest.fn().mockResolvedValue(cv),
      transitionFromPending: jest.fn().mockResolvedValue(1),
    } as unknown as ConfigGovernanceRepository;
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const activator = fakeActivator();
    const service = new ConfigGovernanceService(repo, fakeUow(), audit, outbox, registryWith(activator));

    const result = await service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A);

    expect(result.status).toBe('active');
    expect(result.checkerId).toBe('admin-1');
    expect(result.configType).toBe('sla_policy');
    expect(repo.transitionFromPending).toHaveBeenCalledWith('cv-1', 'active', 'admin-1', TX);
    expect(activator.activate).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(outbox.emit).toHaveBeenCalledTimes(1);
    const auditArg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(auditArg.action).toBe('config_change');
    expect(auditArg.entity_type).toBe('configuration_versions');
    expect(auditArg.entity_id).toBe('cv-1');
    expect(auditArg.actor_id).toBe('admin-1');
    expect(auditArg.lead_id).toBeNull();
    const outboxArg = (outbox.emit as jest.Mock).mock.calls[0][0];
    expect(outboxArg.event_code).toBe('CONFIG_CHANGED');
    expect(outboxArg.aggregate_type).toBe('configuration_versions');
    expect(outboxArg.aggregate_id).toBe('cv-1');
  });

  it('rejects a pending version → rejected, no activation (T02/T22)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow()),
      transitionFromPending: jest.fn().mockResolvedValue(1),
    } as unknown as ConfigGovernanceRepository;
    const activator = fakeActivator();
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(activator));

    const result = await service.approve('cv-1', { action: 'rejected' }, ADMIN, DataScope.A);

    expect(result.status).toBe('rejected');
    expect(repo.transitionFromPending).toHaveBeenCalledWith('cv-1', 'rejected', 'admin-1', TX);
    expect(activator.activate).not.toHaveBeenCalled();
  });

  it('approves with a future effective_at → approved (not active), no activation (T05)', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ effective_at: tomorrow })),
      transitionFromPending: jest.fn().mockResolvedValue(1),
    } as unknown as ConfigGovernanceRepository;
    const activator = fakeActivator();
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(activator));

    const result = await service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A);

    expect(result.status).toBe('approved');
    expect(repo.transitionFromPending).toHaveBeenCalledWith('cv-1', 'approved', 'admin-1', TX);
    expect(activator.activate).not.toHaveBeenCalled();
  });

  it('blocks self-approval (checker == maker) with FORBIDDEN before any write (T06/T24)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ maker_id: 'admin-1' })),
      transitionFromPending: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repo.transitionFromPending).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when the version is not pending (T07)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ status: 'active' })),
      transitionFromPending: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repo.transitionFromPending).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when the optimistic update affects zero rows (T20)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow()),
      transitionFromPending: jest.fn().mockResolvedValue(0),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('throws NOT_FOUND when the version does not exist (T09)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(undefined),
      transitionFromPending: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.approve('missing', { action: 'approved' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a scope-B caller with FORBIDDEN before opening a transaction (T12)', async () => {
    const repo = { findById: jest.fn(), transitionFromPending: jest.fn() } as unknown as ConfigGovernanceRepository;
    const uow = fakeUow();
    const service = new ConfigGovernanceService(repo, uow, fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(uow.run).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('propagates an audit failure so the whole transaction rolls back (T18)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow()),
      transitionFromPending: jest.fn().mockResolvedValue(1),
    } as unknown as ConfigGovernanceRepository;
    const audit = { append: jest.fn().mockRejectedValue(new Error('audit boom')) } as unknown as AuditAppender;
    const outbox = fakeOutbox();
    const service = new ConfigGovernanceService(repo, fakeUow(), audit, outbox, registryWith(fakeActivator()));

    await expect(service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A)).rejects.toThrow('audit boom');
    // Outbox emit happens after audit append, so it must not have run.
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('performs status transitions only when no activator is registered for the config_type', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ config_type: 'product_config' })),
      transitionFromPending: jest.fn().mockResolvedValue(1),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith());

    const result = await service.approve('cv-1', { action: 'approved' }, ADMIN, DataScope.A);
    expect(result.status).toBe('active');
  });
});

describe('ConfigGovernanceService.rollback', () => {
  it('rolls back an active version with rollback_ref → restores prior, deactivates+activates (T03/T23)', async () => {
    const cv = cvRow({ status: 'active', rollback_ref: 'cv-prev' });
    const restored = cvRow({ configuration_version_id: 'cv-prev', status: 'active', config_ref: 'pol-0' });
    const repo = {
      findById: jest.fn().mockResolvedValue(cv),
      markRolledBack: jest.fn().mockResolvedValue(1),
      reactivate: jest.fn().mockResolvedValue(restored),
    } as unknown as ConfigGovernanceRepository;
    const audit = fakeAudit();
    const outbox = fakeOutbox();
    const activator = fakeActivator();
    const service = new ConfigGovernanceService(repo, fakeUow(), audit, outbox, registryWith(activator));

    const result = await service.rollback('cv-1', { reason: 'Reverting' }, ADMIN, DataScope.A);

    expect(result.status).toBe('rolled_back');
    expect(result.rolledBackVersionId).toBe('cv-1');
    expect(result.restoredVersionId).toBe('cv-prev');
    expect(repo.markRolledBack).toHaveBeenCalledWith('cv-1', 'admin-1', TX);
    expect(repo.reactivate).toHaveBeenCalledWith('cv-prev', 'admin-1', TX);
    expect(activator.deactivate).toHaveBeenCalledTimes(1); // rolled-back config out of service
    expect(activator.activate).toHaveBeenCalledTimes(1); // restored config back in service
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(outbox.emit).toHaveBeenCalledTimes(1);
    const auditArg = (audit.append as jest.Mock).mock.calls[0][0];
    expect(auditArg.detail.reason).toBe('Reverting');
    expect(auditArg.detail.new_status).toBe('rolled_back');
  });

  it('rolls back with no rollback_ref → restoredVersionId null, no reactivate (T04)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ status: 'active', rollback_ref: null })),
      markRolledBack: jest.fn().mockResolvedValue(1),
      reactivate: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const activator = fakeActivator();
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(activator));

    const result = await service.rollback('cv-1', { reason: 'Reverting' }, ADMIN, DataScope.A);

    expect(result.restoredVersionId).toBeNull();
    expect(repo.reactivate).not.toHaveBeenCalled();
    expect(activator.activate).not.toHaveBeenCalled();
    expect(activator.deactivate).toHaveBeenCalledTimes(1);
  });

  it('throws CONFLICT when the version is not active (T08)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ status: 'pending' })),
      markRolledBack: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.rollback('cv-1', { reason: 'r' }, ADMIN, DataScope.A)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repo.markRolledBack).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the version does not exist (T10)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(undefined),
      markRolledBack: jest.fn(),
    } as unknown as ConfigGovernanceRepository;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    try {
      await service.rollback('missing', { reason: 'r' }, ADMIN, DataScope.A);
      fail('expected NOT_FOUND');
    } catch (err) {
      expect(isDomainException(err) && err.code).toBe('NOT_FOUND');
    }
  });

  it('propagates an outbox failure so the rollback transaction rolls back (T19)', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(cvRow({ status: 'active', rollback_ref: 'cv-prev' })),
      markRolledBack: jest.fn().mockResolvedValue(1),
      reactivate: jest.fn().mockResolvedValue(cvRow({ configuration_version_id: 'cv-prev', status: 'active' })),
    } as unknown as ConfigGovernanceRepository;
    const outbox = { emit: jest.fn().mockRejectedValue(new Error('outbox boom')) } as unknown as OutboxService;
    const service = new ConfigGovernanceService(repo, fakeUow(), fakeAudit(), outbox, registryWith(fakeActivator()));

    await expect(service.rollback('cv-1', { reason: 'r' }, ADMIN, DataScope.A)).rejects.toThrow('outbox boom');
  });

  it('rejects a scope-B caller with FORBIDDEN before opening a transaction (T13)', async () => {
    const repo = { findById: jest.fn(), markRolledBack: jest.fn() } as unknown as ConfigGovernanceRepository;
    const uow = fakeUow();
    const service = new ConfigGovernanceService(repo, uow, fakeAudit(), fakeOutbox(), registryWith(fakeActivator()));

    await expect(service.rollback('cv-1', { reason: 'r' }, ADMIN, DataScope.B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(uow.run).not.toHaveBeenCalled();
  });
});
