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
import type { BoardColumnQuery, ListLeadsQuery } from './dto/list-leads.dto';

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
 * Wire item for a pipeline-board card (FR-052) — the masked board projection.
 * Superset of the contract `Lead` list with requested amount, owner name,
 * ageing (whole days) and the optimistic-lock `version` for stage moves.
 */
export interface BoardCardItem {
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
  requested_amount: string | null;
  owner_name: string | null;
  ageing_days: number;
  version: number;
}

export interface BoardColumnResult {
  data: BoardCardItem[];
  pagination: PaginationMeta;
}

/** Ageing in whole calendar days from a created_at timestamp to now. */
function ageingDaysFrom(createdAt: Date): number {
  return Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
}

/** Dashboard trend metrics (FR-053): scoped pipeline value + daily series. */
export interface DashboardMetricsResult {
  /** Σ requested_amount of active (non-terminal) scoped leads, as a string. */
  pipeline_value: string;
  /** Daily captured counts for the trailing window (oldest → newest). */
  captured_series: { date: string; count: number }[];
  /** Daily handed-off (conversion) counts for the trailing window (oldest → newest). */
  conversions_series: { date: string; count: number }[];
}

/** Bucket timestamps into a trailing `days`-day daily series (UTC days). */
function dailySeriesFrom(timestamps: Date[], days: number): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of timestamps) {
    const key = t.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series: { date: string; count: number }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return series;
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

  /**
   * FR-052 — one masked, scoped pipeline-board column. Same scope/masking
   * contract as the list (deny-by-default on a non-internal predicate; strictest
   * masking for the DPO masked view); enriches each row with requested amount,
   * owner name, ageing and version.
   */
  async boardColumn(
    user: AuthUser,
    params: BoardColumnQuery,
    ctx: WorkspaceScopeContext,
  ): Promise<BoardColumnResult> {
    if (!ctx.predicate || !INTERNAL_LIST_PREDICATE_TYPES.has(ctx.predicate.type)) {
      await this.auditDeny(user);
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'OUT_OF_SCOPE' },
      });
    }

    const { rows, total } = await this.repo.boardColumn(
      user.orgId,
      ctx.predicate,
      params.stage,
      params.page,
      params.limit,
    );

    const strict = ctx.maskingLevel === 'strict';
    const data = rows.map((row): BoardCardItem => ({
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
      requested_amount: row.requested_amount,
      owner_name: row.owner_full_name,
      ageing_days: ageingDaysFrom(new Date(row.created_at)),
      version: row.version,
    }));

    return { data, pagination: { page: params.page, limit: params.limit, total } };
  }

  /**
   * FR-053 — dashboard trend metrics: scoped active-pipeline value + a 14-day
   * daily captures series. Same scope / deny-by-default contract as the list.
   */
  async dashboardMetrics(user: AuthUser, ctx: WorkspaceScopeContext): Promise<DashboardMetricsResult> {
    if (!ctx.predicate || !INTERNAL_LIST_PREDICATE_TYPES.has(ctx.predicate.type)) {
      await this.auditDeny(user);
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'OUT_OF_SCOPE' },
      });
    }
    const TREND_DAYS = 14;
    const since = new Date(Date.now() - TREND_DAYS * 86_400_000);
    const { pipelineValue, recentCreatedAt, recentConversions } = await this.repo.dashboardMetrics(
      user.orgId,
      ctx.predicate,
      since,
    );
    return {
      pipeline_value: pipelineValue,
      captured_series: dailySeriesFrom(recentCreatedAt, TREND_DAYS),
      conversions_series: dailySeriesFrom(recentConversions, TREND_DAYS),
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
