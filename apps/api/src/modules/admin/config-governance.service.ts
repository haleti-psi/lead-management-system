import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  ConfigChangeStatus,
  DataScope,
  ERROR_CODES,
  EventCode,
} from '@lms/shared';
import type { PaginationMeta } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import { ConfigActivatorRegistry } from './activators/config-activator.registry';
import type { ConfigurationVersionRow } from './activators/config-activator.port';
import { CONFIGURATION_ENTITY_TYPE } from './admin.constants';
import { ConfigGovernanceRepository } from './config-governance.repository';
import type { ApproveConfigDto } from './dto/approve-config.dto';
import type { ListConfigVersionsQuery } from './dto/list-config-versions.dto';
import type { RollbackConfigDto } from './dto/rollback-config.dto';

/** Shape returned by {@link ConfigGovernanceService.approve}. */
export interface ApproveConfigResult {
  configurationVersionId: string;
  configType: string;
  configRef: string | null;
  version: number;
  status: ConfigChangeStatus;
  effectiveAt: string | null;
  makerId: string;
  checkerId: string;
  diff: unknown;
}

/** Shape returned by {@link ConfigGovernanceService.rollback}. */
export interface RollbackConfigResult {
  rolledBackVersionId: string;
  restoredVersionId: string | null;
  configType: string;
  status: ConfigChangeStatus;
}

/** One pending version, as the review-queue listing returns it. */
export interface PendingConfigVersionView {
  configurationVersionId: string;
  makerId: string;
  configType: string;
  configRef: string | null;
  status: ConfigChangeStatus;
  createdAt: string;
  diff: unknown;
}

/** Shape returned by {@link ConfigGovernanceService.listPending}. */
export interface ListPendingConfigResult {
  data: PendingConfigVersionView[];
  pagination: PaginationMeta;
}

/**
 * FR-132 — the generic configuration-governance engine (maker-checker). It owns
 * the approval and rollback lifecycle of `configuration_versions`; the `pending`
 * rows themselves are created by the per-config write paths (e.g. FR-104).
 *
 * Each action runs in ONE {@link UnitOfWork} transaction that atomically (a)
 * transitions the version with an optimistic status guard, (b) delegates the
 * live-config side effect to the {@link ConfigActivatorRegistry} activator for
 * `config_type`, (c) appends an `audit_logs(config_change)` intent, and (d) emits
 * a `CONFIG_CHANGED` outbox event. Any throw rolls the whole transaction back —
 * no partial state.
 *
 * Authorisation: the `configuration` capability is enforced upstream by
 * `AbacGuard`. Governance is an org-wide action, so the service additionally
 * requires effective scope `A` (ADMIN/HEAD); scope-B holders (BM/KYC/DPO) are
 * rejected with FORBIDDEN. Self-approval (checker == maker) is rejected with
 * FORBIDDEN before any write (also backed by `ck_config_maker_checker`).
 */
@Injectable()
export class ConfigGovernanceService {
  constructor(
    private readonly repo: ConfigGovernanceRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly activators: ConfigActivatorRegistry,
  ) {}

  /**
   * List the org's `pending` configuration versions awaiting a checker decision,
   * newest-first and paginated. Governance is an org-wide action, so this read
   * enforces the same scope-A floor as {@link approve}/{@link rollback}; scope-B
   * holders (BM/KYC/DPO) are rejected with FORBIDDEN. The `configuration`
   * capability itself is enforced upstream by `AbacGuard`.
   */
  async listPending(
    _actor: AuthUser,
    query: ListConfigVersionsQuery,
    effectiveScope: DataScope | undefined,
  ): Promise<ListPendingConfigResult> {
    this.requireScopeA(effectiveScope);

    const page = await this.repo.listPending({
      configType: query.config_type,
      page: query.page,
      limit: query.limit,
    });

    return {
      data: page.rows.map((row) => ({
        configurationVersionId: row.configuration_version_id,
        makerId: row.maker_id,
        configType: row.config_type,
        configRef: row.config_ref,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        diff: row.diff ?? null,
      })),
      pagination: { page: query.page, limit: query.limit, total: page.total },
    };
  }

  async approve(
    versionId: string,
    dto: ApproveConfigDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<ApproveConfigResult> {
    this.requireScopeA(effectiveScope);

    return this.uow.run(async (tx) => {
      const cv = await this.repo.findById(versionId, tx);
      if (!cv) throw new DomainException(ERROR_CODES.NOT_FOUND);
      if (cv.status !== ConfigChangeStatus.PENDING) throw new DomainException(ERROR_CODES.CONFLICT);
      if (cv.maker_id === actor.userId) throw new DomainException(ERROR_CODES.FORBIDDEN);

      const newStatus = this.nextApprovalStatus(dto.action, cv.effective_at);

      const updated = await this.repo.transitionFromPending(versionId, newStatus, actor.userId, tx);
      if (updated === 0) throw new DomainException(ERROR_CODES.CONFLICT);

      // Activate the live config only when the version becomes active now.
      if (newStatus === ConfigChangeStatus.ACTIVE) {
        await this.activate({ ...cv, status: newStatus, checker_id: actor.userId, updated_by: actor.userId }, tx);
      }

      await this.appendAudit(cv, newStatus, actor.userId, { comment: dto.comment ?? null }, tx);
      await this.emitChanged(cv, newStatus, actor.userId, tx);

      return {
        configurationVersionId: cv.configuration_version_id,
        configType: cv.config_type,
        configRef: cv.config_ref,
        version: cv.version,
        status: newStatus,
        effectiveAt: toIso(cv.effective_at),
        makerId: cv.maker_id,
        checkerId: actor.userId,
        diff: cv.diff ?? null,
      };
    });
  }

  async rollback(
    versionId: string,
    dto: RollbackConfigDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<RollbackConfigResult> {
    this.requireScopeA(effectiveScope);

    return this.uow.run(async (tx) => {
      const cv = await this.repo.findById(versionId, tx);
      if (!cv) throw new DomainException(ERROR_CODES.NOT_FOUND);
      if (cv.status !== ConfigChangeStatus.ACTIVE) throw new DomainException(ERROR_CODES.CONFLICT);

      const updated = await this.repo.markRolledBack(versionId, actor.userId, tx);
      if (updated === 0) throw new DomainException(ERROR_CODES.CONFLICT);

      // Take the rolled-back config out of service.
      await this.deactivate({ ...cv, status: ConfigChangeStatus.ROLLED_BACK, updated_by: actor.userId }, tx);

      // Re-activate the prior version referenced by rollback_ref, if any.
      let restoredVersionId: string | null = null;
      if (cv.rollback_ref) {
        const restored = await this.repo.reactivate(cv.rollback_ref, actor.userId, tx);
        if (restored) {
          restoredVersionId = restored.configuration_version_id;
          await this.activate({ ...restored, updated_by: actor.userId }, tx);
        }
      }

      await this.appendAudit(
        cv,
        ConfigChangeStatus.ROLLED_BACK,
        actor.userId,
        { reason: dto.reason, rollback_ref: cv.rollback_ref },
        tx,
      );
      await this.emitChanged(cv, ConfigChangeStatus.ROLLED_BACK, actor.userId, tx);

      return {
        rolledBackVersionId: cv.configuration_version_id,
        restoredVersionId,
        configType: cv.config_type,
        status: ConfigChangeStatus.ROLLED_BACK,
      };
    });
  }

  /** Org-wide governance requires scope A; BM/KYC/DPO (scope B) are blocked. */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  /** `approved` → `active` now, or `approved` when `effective_at` is in the future. */
  private nextApprovalStatus(
    action: ApproveConfigDto['action'],
    effectiveAt: Date | null,
  ): ConfigChangeStatus {
    if (action === 'rejected') return ConfigChangeStatus.REJECTED;
    return effectiveAt != null && effectiveAt.getTime() > Date.now()
      ? ConfigChangeStatus.APPROVED
      : ConfigChangeStatus.ACTIVE;
  }

  private async activate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    await this.activators.resolve(cv.config_type)?.activate(cv, tx);
  }

  private async deactivate(cv: ConfigurationVersionRow, tx: DbTransaction): Promise<void> {
    await this.activators.resolve(cv.config_type)?.deactivate(cv, tx);
  }

  private async appendAudit(
    cv: ConfigurationVersionRow,
    newStatus: ConfigChangeStatus,
    actorId: string,
    extra: Record<string, unknown>,
    tx: DbTransaction,
  ): Promise<void> {
    await this.audit.append(
      {
        action: AuditAction.CONFIG_CHANGE,
        entity_type: CONFIGURATION_ENTITY_TYPE,
        entity_id: cv.configuration_version_id,
        actor_id: actorId,
        org_id: ORG_ID_DEFAULT,
        lead_id: null,
        detail: {
          config_type: cv.config_type,
          config_ref: cv.config_ref,
          version: cv.version,
          new_status: newStatus,
          ...extra,
        },
      },
      tx,
    );
  }

  private async emitChanged(
    cv: ConfigurationVersionRow,
    newStatus: ConfigChangeStatus,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await this.outbox.emit(
      {
        event_code: EventCode.CONFIG_CHANGED,
        aggregate_type: CONFIGURATION_ENTITY_TYPE,
        aggregate_id: cv.configuration_version_id,
        payload: {
          config_type: cv.config_type,
          config_ref: cv.config_ref,
          version: cv.version,
          new_status: newStatus,
          actor_id: actorId,
        },
      },
      tx,
    );
  }
}

/** ISO-8601 string for a TIMESTAMPTZ, or null. */
function toIso(value: Date | null): string | null {
  return value != null ? value.toISOString() : null;
}
