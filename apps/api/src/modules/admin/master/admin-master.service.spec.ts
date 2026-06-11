import { DataScope, RoleCode } from '@lms/shared';

import { AuditAppender } from '../../../core/audit';
import type { AuthUser } from '../../../core/auth';
import { UnitOfWork } from '../../../core/db';
import { DomainException, isDomainException } from '../../../core/http';
import { OutboxService } from '../../../core/outbox';
import { AdminMasterRepository } from './admin-master.repository';
import { AdminMasterService } from './admin-master.service';
import type {
  MasterRecordView,
  MasterResourceDescriptor,
} from './master-resource.types';

/**
 * FR-131 unit tests for {@link AdminMasterService} (T31–T34 + authz + error map).
 * Collaborators are mocked; the UnitOfWork mock runs the callback with a sentinel
 * tx so the atomic grouping (master row + configuration_version + outbox + audit)
 * is asserted without a database. The Testcontainers integration tier (T01–T29,
 * T38–T40, INV-*) is DEFERRED.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const TX = { __tx: true } as const;

const ADMIN: AuthUser = { userId: 'admin-1', orgId: ORG, role: RoleCode.ADMIN, scope: DataScope.A, jti: 'j1' };
const BM: AuthUser = { userId: 'bm-1', orgId: ORG, role: RoleCode.BM, scope: DataScope.B, jti: 'j2' };

function record(overrides: Partial<MasterRecordView> = {}): MasterRecordView {
  return { id: 'rec-1', isActive: true, ...overrides };
}

/** A fully-stubbed descriptor; individual tests override the methods they assert. */
function fakeDescriptor(overrides: Partial<MasterResourceDescriptor> = {}): MasterResourceDescriptor {
  return {
    slug: 'rejection-reasons',
    configType: 'rejection_reason',
    entityType: 'rejection_reason',
    scopeModel: 'global',
    activenessModel: 'boolean',
    createSchema: { parse: (v: unknown) => v } as never,
    patchSchema: { parse: (v: unknown) => v } as never,
    list: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn(async () => ({ record: record(), version: 1, diff: { op: 'create' } })),
    update: jest.fn(async () => ({ record: record({ isActive: false }), version: 1, diff: { op: 'update' } })),
    assertNotInUse: jest.fn(async () => undefined),
    ...overrides,
  };
}

function fakeUow(): UnitOfWork {
  return { run: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)) } as unknown as UnitOfWork;
}
function fakeAudit(): AuditAppender {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditAppender;
}
function fakeOutbox(): OutboxService {
  return { emit: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
}
function fakeRepo(): AdminMasterRepository {
  return {
    reader: {},
    insertConfigVersion: jest.fn().mockResolvedValue('cv-1'),
  } as unknown as AdminMasterRepository;
}

describe('AdminMasterService', () => {
  describe('create', () => {
    it('T31 — inserts master row + configuration_version + outbox + audit in ONE tx', async () => {
      const descriptor = fakeDescriptor();
      const repo = fakeRepo();
      const audit = fakeAudit();
      const outbox = fakeOutbox();
      const service = new AdminMasterService(repo, fakeUow(), audit, outbox);

      const result = await service.create(descriptor, { primaryReason: 'other' }, ADMIN, DataScope.A);

      expect(result.configVersionId).toBe('cv-1');
      // All four writes received the SAME sentinel tx.
      expect(descriptor.insert).toHaveBeenCalledWith(TX, { primaryReason: 'other' }, 'admin-1');
      expect(repo.insertConfigVersion).toHaveBeenCalledWith(TX, 'rejection_reason', 'rec-1', 1, { op: 'create' }, 'admin-1');
      expect((outbox.emit as jest.Mock).mock.calls[0][1]).toBe(TX);
      expect((audit.append as jest.Mock).mock.calls[0][1]).toBe(TX);
    });

    it('runs validateReferences before insert when the descriptor defines it', async () => {
      const order: string[] = [];
      const descriptor = fakeDescriptor({
        validateReferences: jest.fn(async () => { order.push('validate'); }),
        insert: jest.fn(async () => { order.push('insert'); return { record: record(), version: 1, diff: { op: 'create' } }; }),
      });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      await service.create(descriptor, {}, ADMIN, DataScope.A);
      expect(order).toEqual(['validate', 'insert']);
    });

    it('T32 — rolls back (propagates) when the outbox emit fails; audit never runs', async () => {
      const descriptor = fakeDescriptor();
      const audit = fakeAudit();
      const outbox = { emit: jest.fn().mockRejectedValue(new Error('outbox down')) } as unknown as OutboxService;
      const service = new AdminMasterService(fakeRepo(), fakeUow(), audit, outbox);

      await expect(service.create(descriptor, {}, ADMIN, DataScope.A)).rejects.toThrow('outbox down');
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint (23505) violation to CONFLICT', async () => {
      const descriptor = fakeDescriptor({
        insert: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' })),
      });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      await expect(service.create(descriptor, {}, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
    });

    it('rejects a scope-B actor (BM) with FORBIDDEN before any write', async () => {
      const descriptor = fakeDescriptor();
      const uow = fakeUow();
      const service = new AdminMasterService(fakeRepo(), uow, fakeAudit(), fakeOutbox());
      await expect(service.create(descriptor, {}, BM, DataScope.B)).rejects.toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
      expect(uow.run).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('T25 — throws NOT_FOUND when the record is absent', async () => {
      const descriptor = fakeDescriptor({ findById: jest.fn(async () => undefined) });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      await expect(service.update(descriptor, 'missing', { isActive: false }, ADMIN, DataScope.A)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('T26 — runs assertNotInUse on deactivation and surfaces its CONFLICT', async () => {
      const assertNotInUse = jest.fn(async () => { throw new DomainException('CONFLICT', undefined, { detail: { reason: 'Resource is referenced by active records and cannot be deactivated.' } }); });
      const descriptor = fakeDescriptor({ findById: jest.fn(async () => record()), assertNotInUse });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());

      const err = await service.update(descriptor, 'rec-1', { isActive: false }, ADMIN, DataScope.A).catch((e) => e);
      expect(assertNotInUse).toHaveBeenCalledWith(TX, record());
      expect(isDomainException(err) && err.code).toBe('CONFLICT');
    });

    it('does NOT run assertNotInUse when the patch is not a deactivation', async () => {
      const assertNotInUse = jest.fn(async () => undefined);
      const descriptor = fakeDescriptor({ findById: jest.fn(async () => record()), assertNotInUse });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      await service.update(descriptor, 'rec-1', { subReason: 'x' }, ADMIN, DataScope.A);
      expect(assertNotInUse).not.toHaveBeenCalled();
    });

    it('T27 — legal-hold retention deactivation surfaces CONFLICT + LEGAL_HOLD', async () => {
      const assertNotInUse = jest.fn(async () => { throw new DomainException('CONFLICT', undefined, { detail: { reason: 'LEGAL_HOLD' } }); });
      const descriptor = fakeDescriptor({ activenessModel: 'boolean', findById: jest.fn(async () => record({ legalHold: true })), assertNotInUse });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      const err = await service.update(descriptor, 'rec-1', { isActive: false }, ADMIN, DataScope.A).catch((e) => e);
      expect(isDomainException(err) && err.detail?.reason).toBe('LEGAL_HOLD');
    });

    it('T33 — rolls back when configuration_version insert fails; audit never runs', async () => {
      const descriptor = fakeDescriptor({ findById: jest.fn(async () => record()) });
      const repo = { reader: {}, insertConfigVersion: jest.fn().mockRejectedValue(new Error('cv fail')) } as unknown as AdminMasterRepository;
      const audit = fakeAudit();
      const service = new AdminMasterService(repo, fakeUow(), audit, fakeOutbox());
      await expect(service.update(descriptor, 'rec-1', { isActive: false }, ADMIN, DataScope.A)).rejects.toThrow('cv fail');
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('status-model deactivation (status != active) triggers the in-use guard', async () => {
      const assertNotInUse = jest.fn(async () => undefined);
      const descriptor = fakeDescriptor({ activenessModel: 'status', findById: jest.fn(async () => record({ status: 'active' })), assertNotInUse });
      const service = new AdminMasterService(fakeRepo(), fakeUow(), fakeAudit(), fakeOutbox());
      await service.update(descriptor, 'rec-1', { status: 'suspended' }, ADMIN, DataScope.A);
      expect(assertNotInUse).toHaveBeenCalledTimes(1);
    });
  });
});
