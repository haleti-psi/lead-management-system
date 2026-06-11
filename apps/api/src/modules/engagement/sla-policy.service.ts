import { Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES } from '@lms/shared';
import type { PaginationMeta } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import type { ListSlaPoliciesQueryDto } from './dto/list-sla-policies.dto';
import { SLA_POLICY_ENTITY_TYPE } from './engagement.constants';
import { SlaPolicyRepository, type SlaPolicyRow } from './sla-policy.repository';

export interface CreateSlaPolicyResult {
  sla_policy_id: string;
  name: string;
  applies_to: string;
  threshold_minutes: number;
  is_active: boolean;
  configuration_version_id: string;
  version: number;
}

export interface ListSlaPoliciesResult {
  data: SlaPolicyRow[];
  pagination: PaginationMeta;
}

/**
 * FR-104 — SLA policy administration (M11). Two operations:
 *
 *  - {@link list}: paginated read of `sla_policies` for the org.
 *  - {@link create}: maker-checker creation — in ONE {@link UnitOfWork}
 *    transaction it (a) rejects a duplicate ACTIVE name+applies_to with CONFLICT,
 *    (b) inserts the policy INACTIVE, (c) inserts the paired
 *    `configuration_versions(status='pending', maker_id=actor)`, and (d) appends
 *    an `audit_logs(config_change)` intent. The policy is activated only later via
 *    `POST /admin/config/{id}/approve` (FR-132).
 *
 * Authorisation: the `configuration` capability is enforced by `AbacGuard`
 * (`@Requires`). Creation is an org-wide config operation, so the service
 * additionally requires effective scope `A` (ADMIN/HEAD) — a scope-B holder
 * (BM/KYC/DPO) is rejected with FORBIDDEN.
 */
@Injectable()
export class SlaPolicyService {
  constructor(
    private readonly repo: SlaPolicyRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
  ) {}

  async list(query: ListSlaPoliciesQueryDto): Promise<ListSlaPoliciesResult> {
    const filters = { applies_to: query.applies_to, is_active: query.is_active };
    const pagination = { page: query.page, limit: query.limit };
    const [rows, total] = await Promise.all([
      this.repo.list(filters, pagination),
      this.repo.count(filters),
    ]);
    return {
      data: rows,
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  async create(
    dto: CreateSlaPolicyDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<CreateSlaPolicyResult> {
    // Org-wide config write requires scope A (ADMIN/HEAD). BM/KYC/DPO hold the
    // `configuration` capability only at scope B and are blocked here.
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    return this.uow.run(async (tx) => {
      if (await this.repo.activeDuplicateExists(dto.name, dto.applies_to, tx)) {
        throw new DomainException(ERROR_CODES.CONFLICT);
      }

      const policy = await this.repo.insertPolicy(dto, actor.userId, tx);
      const configurationVersionId = await this.repo.insertConfigVersion(
        policy.sla_policy_id,
        dto,
        actor.userId,
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: SLA_POLICY_ENTITY_TYPE,
          entity_id: policy.sla_policy_id,
          actor_id: actor.userId,
          org_id: ORG_ID_DEFAULT,
          detail: {
            op: 'create',
            applies_to: dto.applies_to,
            threshold_minutes: dto.threshold_minutes,
            configuration_version_id: configurationVersionId,
          },
        },
        tx,
      );

      return {
        sla_policy_id: policy.sla_policy_id,
        name: policy.name,
        applies_to: policy.applies_to,
        threshold_minutes: policy.threshold_minutes,
        is_active: policy.is_active,
        configuration_version_id: configurationVersionId,
        version: 1,
      };
    });
  }
}
