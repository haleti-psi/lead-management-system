import { Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES, EventCode } from '@lms/shared';
import type { PaginationMeta } from '@lms/shared';

import { AuditAppender } from '../../../core/audit';
import type { AuthUser } from '../../../core/auth';
import { UnitOfWork } from '../../../core/db';
import type { DbTransaction } from '../../../core/db';
import { DomainException } from '../../../core/http';
import { OutboxService } from '../../../core/outbox';
import { ORG_ID_DEFAULT } from '../../../core/outbox/outbox.constants';
import { MASTER_AGGREGATE_TYPE } from './master.constants';
import { AdminMasterRepository } from './admin-master.repository';
import type {
  MasterRecordView,
  MasterResourceDescriptor,
} from './master-resource.types';
import { isForeignKeyViolation, isUniqueViolation } from './pg-error';

export interface ListMasterResult {
  data: MasterRecordView[];
  pagination: PaginationMeta;
}

export interface MutateMasterResult {
  record: MasterRecordView;
  configVersionId: string;
}

export interface ListMasterArgs {
  page: number;
  limit: number;
  isActive?: boolean;
}

/**
 * FR-131 — generic master/config CRUD orchestrator. Every create/update runs in
 * ONE {@link UnitOfWork} transaction that atomically (a) writes the master row
 * (delegated to the resource descriptor — owner-writes), (b) inserts the paired
 * `configuration_versions(status='pending')` row for the FR-132 maker-checker
 * trail, (c) emits a `CONFIG_CHANGED` outbox event, and (d) appends a
 * `config_change` audit intent. Any throw rolls the whole transaction back.
 *
 * Authorisation: the `configuration` capability is enforced upstream by
 * `AbacGuard`. Global resources additionally require effective scope A
 * (ADMIN/HEAD); branch resources accept scope B (BM/KYC/DPO) but a scope-B actor
 * may only touch rows in their own branch (enforced on read-before-write).
 */
@Injectable()
export class AdminMasterService {
  constructor(
    private readonly repo: AdminMasterRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    descriptor: MasterResourceDescriptor,
    args: ListMasterArgs,
  ): Promise<ListMasterResult> {
    const page = await descriptor.list(this.repo.reader, {
      page: args.page,
      limit: args.limit,
      isActive: args.isActive,
    });
    return { data: page.rows, pagination: { page: args.page, limit: args.limit, total: page.total } };
  }

  async create(
    descriptor: MasterResourceDescriptor,
    body: unknown,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<MutateMasterResult> {
    this.requireWriteScope(descriptor, effectiveScope);

    return this.uow.run(async (tx) => {
      // FK pre-checks (e.g. branch.regionId) → VALIDATION_ERROR, before the insert.
      if (descriptor.validateReferences != null) {
        await descriptor.validateReferences(tx, body);
      }

      const { record, version, diff } = await this.runInsert(descriptor, tx, body, actor.userId);
      const configVersionId = await this.repo.insertConfigVersion(
        tx,
        descriptor.configType,
        record.id,
        version,
        diff,
        actor.userId,
      );
      await this.emitChanged(descriptor, record.id, version, 'create', actor.userId, tx);
      await this.appendAudit(descriptor, record.id, configVersionId, diff, actor.userId, tx);
      return { record, configVersionId };
    });
  }

  async update(
    descriptor: MasterResourceDescriptor,
    id: string,
    body: unknown,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<MutateMasterResult> {
    this.requireWriteScope(descriptor, effectiveScope);

    return this.uow.run(async (tx) => {
      const existing = await descriptor.findById(tx, id);
      if (existing == null) throw new DomainException(ERROR_CODES.NOT_FOUND);

      // Deactivation guard: run the resource's referential-integrity / legal-hold check.
      if (this.isDeactivation(descriptor, body)) {
        await descriptor.assertNotInUse(tx, existing);
      }

      if (descriptor.validateReferences != null) {
        await descriptor.validateReferences(tx, body);
      }

      const { record, version, diff } = await this.runUpdate(descriptor, tx, existing, body, actor.userId);
      const configVersionId = await this.repo.insertConfigVersion(
        tx,
        descriptor.configType,
        record.id,
        version,
        diff,
        actor.userId,
      );
      await this.emitChanged(descriptor, record.id, version, 'update', actor.userId, tx);
      await this.appendAudit(descriptor, record.id, configVersionId, diff, actor.userId, tx);
      return { record, configVersionId };
    });
  }

  /** Run the descriptor insert, mapping DB unique/FK violations to the taxonomy. */
  private async runInsert(
    descriptor: MasterResourceDescriptor,
    tx: DbTransaction,
    body: unknown,
    actorId: string,
  ): ReturnType<MasterResourceDescriptor['insert']> {
    try {
      return await descriptor.insert(tx, body, actorId);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  private async runUpdate(
    descriptor: MasterResourceDescriptor,
    tx: DbTransaction,
    existing: MasterRecordView,
    body: unknown,
    actorId: string,
  ): ReturnType<MasterResourceDescriptor['update']> {
    try {
      return await descriptor.update(tx, existing, body, actorId);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Duplicate unique key → CONFLICT; missing FK → VALIDATION_ERROR; else rethrow. */
  private mapWriteError(err: unknown): unknown {
    if (err instanceof DomainException) return err;
    if (isUniqueViolation(err)) return new DomainException(ERROR_CODES.CONFLICT, undefined, { cause: err });
    if (isForeignKeyViolation(err)) {
      return new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: '_', issue: 'A referenced record does not exist.' }],
        cause: err,
      });
    }
    return err;
  }

  /**
   * Master/config writes are org-wide, so the service requires effective scope A
   * (ADMIN/HEAD) for every create/update — mirroring FR-040/FR-104/FR-132. A
   * scope-B holder (BM/KYC/DPO) holds the `configuration` capability but is
   * rejected here with FORBIDDEN (T29). The `configuration` capability itself is
   * enforced upstream by `AbacGuard`, so RM/SM/PARTNER never reach this service.
   */
  private requireWriteScope(_descriptor: MasterResourceDescriptor, scope: DataScope | undefined): void {
    if (scope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  /** True when the patch body deactivates the record (isActive=false or status→inactive). */
  private isDeactivation(descriptor: MasterResourceDescriptor, body: unknown): boolean {
    const patch = body as { isActive?: boolean; status?: string };
    if (descriptor.activenessModel === 'boolean') return patch.isActive === false;
    if (descriptor.activenessModel === 'status') {
      return patch.status != null && patch.status !== 'active';
    }
    return false;
  }

  private async emitChanged(
    descriptor: MasterResourceDescriptor,
    configRef: string,
    version: number,
    op: 'create' | 'update',
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await this.outbox.emit(
      {
        event_code: EventCode.CONFIG_CHANGED,
        aggregate_type: MASTER_AGGREGATE_TYPE,
        aggregate_id: configRef,
        payload: { config_type: descriptor.configType, op, version, changed_by: actorId },
      },
      tx,
    );
  }

  private async appendAudit(
    descriptor: MasterResourceDescriptor,
    entityId: string,
    configVersionId: string,
    diff: Record<string, unknown>,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await this.audit.append(
      {
        action: AuditAction.CONFIG_CHANGE,
        entity_type: descriptor.entityType,
        entity_id: entityId,
        actor_id: actorId,
        org_id: ORG_ID_DEFAULT,
        detail: { op: diff.op, config_type: descriptor.configType, config_version_id: configVersionId },
      },
      tx,
    );
  }
}
