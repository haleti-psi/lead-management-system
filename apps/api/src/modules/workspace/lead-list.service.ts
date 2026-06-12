import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  Capability,
  ERROR_CODES,
  type ConsentStatus,
  type DataScope,
  type KycStatus,
  type LeadStage,
  type PaginationMeta,
  type ProductCode,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser, MaskingLevel } from '../../core/auth';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import { LEADS_RESOURCE_TYPE } from '../capture/capture.constants';
import { INTERNAL_LIST_PREDICATE_TYPES } from './workspace.constants';
import { LeadListRepository } from './lead-list.repository';
import type { ListLeadsQuery } from './dto/list-leads.dto';

/** ABAC grant context the controller forwards (set by AbacGuard on the request). */
export interface WorkspaceScopeContext {
  effectiveScope?: DataScope;
  predicate?: ScopePredicate;
  maskingLevel?: MaskingLevel;
}

/**
 * Wire item — EXACTLY the contract `Lead` schema
 * (api-contract.yaml#/components/schemas/Lead). Raw `name`/`mobile`/`pan` are
 * never serialised; only the masked projections leave the service.
 */
export interface LeadListItem {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode;
  is_hot: boolean;
  score: number | null;
  consent_status: ConsentStatus;
  kyc_status: KycStatus;
  name_masked: string | null;
  mobile_masked: string | null;
}

export interface LeadListResult {
  data: LeadListItem[];
  pagination: PaginationMeta;
}

/**
 * FR-050 — orchestrates the scoped lead list (LLD §Backend Flow): scope is
 * compiled into SQL by the repository (never post-filtered), rows are
 * projected to the contract `Lead` shape with `MaskingService` (strictest for
 * the DPO masked view), pagination meta carries the scope-filtered total.
 */
@Injectable()
export class LeadListService {
  constructor(
    private readonly repo: LeadListRepository,
    private readonly masking: MaskingService,
    private readonly audit: AuditAppender,
    @InjectPinoLogger(LeadListService.name) private readonly logger: PinoLogger,
  ) {}

  async list(user: AuthUser, params: ListLeadsQuery, ctx: WorkspaceScopeContext): Promise<LeadListResult> {
    // PARTNER/CUSTOMER are not FR-050 roles (LLD §Auth Check) — deny + audit,
    // exactly like an AbacGuard deny. Deny-by-default on a missing predicate.
    if (!ctx.predicate || !INTERNAL_LIST_PREDICATE_TYPES.has(ctx.predicate.type)) {
      await this.auditDeny(user);
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'OUT_OF_SCOPE' },
      });
    }

    const { rows, total } = await this.repo.list(user.orgId, ctx.predicate, params);

    // Strictest masking for the DPO masked view / export (FR-002 §Masking).
    const strict = ctx.maskingLevel === 'strict';
    const data = rows.map((row): LeadListItem => ({
      lead_id: row.lead_id,
      lead_code: row.lead_code,
      stage: row.stage,
      product_code: row.product_code,
      is_hot: row.is_hot,
      score: row.score,
      consent_status: row.consent_status,
      kyc_status: row.kyc_status,
      name_masked: this.masking.mask('full_name', row.name, { strict }),
      mobile_masked: this.masking.mask('mobile', row.mobile, { strict }),
      // row.pan_masked is intentionally dropped — not in the contract Lead schema.
    }));

    return {
      data,
      pagination: { page: params.page, limit: params.limit, total },
    };
  }

  /** Append an `abac_deny` audit intent; a sink failure must not mask the 403. */
  private async auditDeny(user: AuthUser): Promise<void> {
    try {
      await this.audit.append({
        action: AuditAction.ABAC_DENY,
        entity_type: LEADS_RESOURCE_TYPE,
        entity_id: null,
        actor_id: user.userId,
        org_id: user.orgId,
        detail: { denied: true, reason: 'OUT_OF_SCOPE', capability: Capability.VIEW_LEAD },
      });
    } catch (cause) {
      this.logger.error({ err: cause }, 'Failed to append abac_deny audit event for lead list');
    }
  }
}
