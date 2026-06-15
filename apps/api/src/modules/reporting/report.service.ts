import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { ERROR_CODES, RoleCode, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import type { GetReportQueryDto, ReportCode } from './dto/get-report-query.dto';
import type {
  ReportData,
  ReportRow,
  RmPerformanceRow,
  DsaDealerQualityRow,
} from './dto/report-response.dto';
import type { ReportFilters } from './report.repository';
export type { ReportFilters };
import { ReportRepository } from './report.repository';
import { DifferentiatorRepository } from './differentiator.repository';
import { DPO_ALLOWED_REPORT_CODES } from './reporting.constants';

/** The context built by resolveScope, passed to the builder methods. */
export interface ReportScopeContext {
  predicate: ScopePredicate;
  filters: ReportFilters;
  scope: {
    branch_id: string | null;
    team_id: string | null;
    owner_id: string | null;
  };
  period: {
    from: string | null;
    to: string | null;
  };
  pagination: { page: number; limit: number };
}

/**
 * FR-120 — core report pack service (M13). Read-only; dispatches to the
 * appropriate builder by `code`. Enforces scope-parameter validation (the
 * ABAC predicate is already on the request; here we check that any explicit
 * filter params stay within the caller's scope). Zero writes.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly entitlement: EntitlementCacheService,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
    private readonly masking: MaskingService,
    private readonly differentiatorRepo: DifferentiatorRepository,
  ) {}

  /**
   * Builds and returns a report. The `predicate` comes from `AbacGuard`
   * (already resolved; caller has `reports` capability). This method:
   * 1. Calls `resolveScope` to validate optional filter params.
   * 2. Dispatches to the appropriate builder.
   * 3. Wraps the result in the `ReportData` envelope.
   */
  async getReport(
    code: ReportCode,
    query: GetReportQueryDto,
    user: AuthUser,
    predicate: ScopePredicate,
  ): Promise<{ data: ReportData; total: number }> {
    // FR-121 §Auth Check: DPO role (masked scope) may only access consent_privacy_ops.
    if (user.role === RoleCode.DPO && !DPO_ALLOWED_REPORT_CODES.has(code)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const ctx = await this.resolveScope(user, query, predicate);
    const timeoutMs = this.config.get('REPORT_TIMEOUT_MS');

    let result: { rows: ReportRow[]; total: number };

    try {
      result = await Promise.race([
        this.dispatch(code, { ...ctx, orgId: user.orgId }),
        timeout(timeoutMs, `Report ${code} exceeded ${timeoutMs}ms timeout`),
      ]);
    } catch (err) {
      if (err instanceof DomainException) {
        throw err;
      }
      if (isTimeoutError(err)) {
        this.logger.warn(
          { module: 'reporting', fr: 'FR-120', report_code: code, timeout_ms: timeoutMs },
          'Report query timeout — advise caller to use FR-122 async export',
        );
        throw new DomainException(ERROR_CODES.INTERNAL_ERROR, 'Report query timed out. Use the export endpoint for large datasets.');
      }
      this.logger.error(
        { module: 'reporting', fr: 'FR-120', report_code: code, err },
        'Unhandled error in report query',
      );
      throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
    }

    // DPO (masked predicate) must not receive unmasked owner_name in rm_performance.
    if (predicate.type === 'masked' && code === 'rm_performance') {
      result = {
        ...result,
        rows: (result.rows as RmPerformanceRow[]).map((row) => ({
          ...row,
          owner_name: this.masking.mask('full_name', row.owner_name, { strict: true }) ?? row.owner_name,
        })),
      };
    }

    const now = new Date();
    // IST = UTC+05:30 (no DST — India does not observe DST)
    const IST_OFFSET_MINUTES = 330;
    const istMs = now.getTime() + IST_OFFSET_MINUTES * 60_000;
    const istDate = new Date(istMs);
    const generated_at =
      istDate.toISOString().replace('Z', '') + '+05:30';

    return {
      data: {
        report_code: code,
        generated_at,
        scope: ctx.scope,
        period: ctx.period,
        rows: result.rows,
      },
      total: result.total,
    };
  }

  /**
   * Validates that any explicit scope-narrowing params (owner_id / branch_id /
   * team_id / partner_id) are within the caller's scope. Returns the final filter
   * set and scope summary for the response envelope.
   *
   * The principle: every param must reference an entity that is provably within the
   * caller's resolved scope — it may only NARROW, never widen. Violations throw
   * `FORBIDDEN` (not `VALIDATION_ERROR`): this is an access violation, not a
   * format error (LLD §Validation Logic).
   */
  async resolveScope(
    user: AuthUser,
    query: GetReportQueryDto,
    predicate: ScopePredicate,
  ): Promise<ReportScopeContext> {
    // Load actor entitlement to get branch/team/partner IDs for param validation.
    const actor = await this.entitlement.loadActorEntitlement(user.userId, user.orgId);

    // ── RM (scope O) ────────────────────────────────────────────────────────
    // owner_id must equal the caller; branch_id / team_id widen scope → FORBIDDEN.
    if (user.role === RoleCode.RM) {
      if (query.owner_id != null && query.owner_id !== user.userId) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      if (query.branch_id != null || query.team_id != null) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
    }

    // ── SM (scope T) ────────────────────────────────────────────────────────
    // owner_id must be a member of the SM's team; branch_id must be the SM's
    // branch; team_id must be the SM's own team.
    if (user.role === RoleCode.SM) {
      if (query.team_id != null && (actor?.teamId == null || query.team_id !== actor.teamId)) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      if (query.branch_id != null && (actor?.branchId == null || query.branch_id !== actor.branchId)) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      if (query.owner_id != null) {
        const teamId = actor?.teamId;
        if (teamId == null) {
          throw new DomainException(ERROR_CODES.FORBIDDEN);
        }
        const memberIds = await this.entitlement.loadTeamMemberIds(teamId, user.orgId);
        if (!memberIds.includes(query.owner_id)) {
          throw new DomainException(ERROR_CODES.FORBIDDEN);
        }
      }
    }

    // ── BM / KYC (scope B) ──────────────────────────────────────────────────
    // branch_id must equal the caller's branch; owner_id must be a user whose
    // own entitlement maps to the same branch.
    if (user.role === RoleCode.BM || user.role === RoleCode.KYC) {
      if (query.branch_id != null && (actor?.branchId == null || query.branch_id !== actor.branchId)) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      if (query.owner_id != null) {
        if (actor?.branchId == null) {
          throw new DomainException(ERROR_CODES.FORBIDDEN);
        }
        const ownerActor = await this.entitlement.loadActorEntitlement(query.owner_id, user.orgId);
        if (ownerActor == null || ownerActor.branchId !== actor.branchId) {
          throw new DomainException(ERROR_CODES.FORBIDDEN);
        }
      }
    }

    // ── PARTNER (scope P) ───────────────────────────────────────────────────
    // partner_id must equal the caller's own partner; owner_id / branch_id are
    // not reachable by a partner — any attempt widens scope → FORBIDDEN.
    if (user.role === RoleCode.PARTNER) {
      if (query.partner_id != null && (actor?.partnerId == null || query.partner_id !== actor.partnerId)) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      if (query.owner_id != null || query.branch_id != null || query.team_id != null) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
    }

    const filters: ReportFilters = {
      from: query.from,
      to: query.to,
      branch_id: query.branch_id,
      team_id: query.team_id,
      owner_id: query.owner_id,
      product_code: query.product_code,
      source: query.source,
      partner_id: query.partner_id,
    };

    const scope = {
      branch_id: query.branch_id ?? null,
      team_id: query.team_id ?? null,
      owner_id: query.owner_id ?? null,
    };

    const period = {
      from: query.from ? toIsoDateString(query.from) : null,
      to: query.to ? toIsoDateString(query.to) : null,
    };

    return {
      predicate,
      filters,
      scope,
      period,
      pagination: { page: query.page, limit: query.limit },
    };
  }

  /**
   * FR-122 — public entry point for the async export worker. Executes a single
   * page of a report using the pre-validated predicate and filters from the
   * export job (scope is already enforced at job-create time; we just replay it).
   */
  async fetchExportRows(
    code: ReportCode,
    orgId: string,
    predicate: ScopePredicate,
    filters: ReportFilters,
    page: number,
    limit: number,
  ): Promise<{ rows: ReportRow[]; total: number }> {
    return this.dispatch(code, {
      orgId,
      predicate,
      filters,
      scope: { branch_id: null, team_id: null, owner_id: null },
      period: { from: null, to: null },
      pagination: { page, limit },
    });
  }

  private async dispatch(code: ReportCode, ctx: ReportScopeContext & { orgId: string }): Promise<{ rows: ReportRow[]; total: number }> {
    switch (code) {
      // ── FR-120 core pack ─────────────────────────────────────────────────
      case 'funnel_conversion':
        return this.repo.funnel(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'source_performance':
        return this.repo.sourcePerformance(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'rm_performance':
        return this.repo.rmPerformance(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'rejection_summary':
        return this.repo.rejectionSummary(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);

      // ── FR-121 differentiator pack ────────────────────────────────────────
      case 'first_contact_sla': {
        const result = await this.differentiatorRepo.firstContactSla(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
        return { rows: result.rows, total: result.total };
      }
      case 'kyc_doc_ageing':
        return this.differentiatorRepo.kycDocAgeing(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'dsa_dealer_quality':
        return this.dispatchDsaDealerQuality(ctx);
      case 'duplicate_leakage':
        return this.differentiatorRepo.duplicateLeakage(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'handoff_failure':
        return this.differentiatorRepo.handoffFailure(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'source_roi':
        return this.differentiatorRepo.sourceRoi(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'contactability':
        return this.differentiatorRepo.contactability(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'consent_privacy_ops':
        return this.differentiatorRepo.consentPrivacyOps(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'product_branch_heatmap':
        return this.differentiatorRepo.productBranchHeatmap(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
      case 'rm_capacity_load':
        return this.differentiatorRepo.rmCapacityLoad(ctx.orgId, ctx.predicate, ctx.filters, ctx.pagination);
    }
  }

  /**
   * FR-121 §12.4 DSA/Dealer Quality — delegates to PartnerQualityService when
   * available; degrades to stub rows with `insufficient_data: true` when FR-092
   * is not yet merged (LLD Assumption 1).
   */
  private async dispatchDsaDealerQuality(
    ctx: ReportScopeContext & { orgId: string },
  ): Promise<{ rows: DsaDealerQualityRow[]; total: number }> {
    const partnerIds = await this.differentiatorRepo.dsaDealerPartnerIds(
      ctx.orgId,
      ctx.predicate,
      ctx.filters,
    );

    if (partnerIds.length === 0) {
      return { rows: [], total: 0 };
    }

    // Degrade gracefully: FR-092 PartnerQualityService not yet available.
    const details = await this.differentiatorRepo.dsaDealerPartnerDetails(ctx.orgId, partnerIds);
    const stubRows: DsaDealerQualityRow[] = details
      .sort((a, b) => a.legal_name.localeCompare(b.legal_name))
      .slice((ctx.pagination.page - 1) * ctx.pagination.limit, ctx.pagination.page * ctx.pagination.limit)
      .map((d) => ({
        partner_id: d.partner_id,
        legal_name: d.legal_name,
        type: d.type,
        quality_score: null,
        insufficient_data: true,
        metrics: {},
      }));

    return { rows: stubRows, total: details.length };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIMEOUT_ERROR_MARKER = Symbol('REPORT_TIMEOUT');

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => {
      const err = new Error(message) as Error & { [TIMEOUT_ERROR_MARKER]: true };
      err[TIMEOUT_ERROR_MARKER] = true;
      reject(err);
    }, ms);
    // Allow the Node.js process to exit even if this timer is still pending
    // (e.g. in test environments). Does not affect the Promise behaviour.
    if (typeof t === 'object' && 'unref' in t && typeof (t as NodeJS.Timeout).unref === 'function') {
      (t as NodeJS.Timeout).unref();
    }
  });
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    TIMEOUT_ERROR_MARKER in err &&
    (err as Error & { [TIMEOUT_ERROR_MARKER]?: boolean })[TIMEOUT_ERROR_MARKER] === true
  );
}

function toIsoDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
