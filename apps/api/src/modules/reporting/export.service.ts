import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import {
  AuditAction,
  DataScope,
  ERROR_CODES,
  EventCode,
  JobStatus,
  MaskingLevel,
  RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { EntitlementCacheService } from '../../core/auth';
import { scopeRank } from '../../core/auth/abac.constants';
import { AuditAppender } from '../../core/audit';
import { AppConfigService } from '../../core/config';
import type { DbTransaction } from '../../core/db';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import { OutboxService } from '../../core/outbox';
import type { CreateExportDto } from './dto/create-export.dto';
import type { ExportJobRow } from './export.repository';
import { ExportRepository } from './export.repository';
import type { ExportTaskPort } from './ports/export-task.port';
import type { ExportStoragePort } from './ports/export-storage.port';
import { EXPORT_TASK_PORT, EXPORT_STORAGE_PORT } from './export.tokens';
import type { ReportRow } from './dto/report-response.dto';
import type { ReportCode } from './reporting.constants';
import { ReportService } from './report.service';
import type { ReportFilters } from './report.service';

/** Masking level hierarchy: index = strictness (lower = more restrictive). */
const MASKING_RANK: Readonly<Record<MaskingLevel, number>> = {
  [MaskingLevel.FULL]: 0,
  [MaskingLevel.PARTIAL]: 1,
  [MaskingLevel.UNMASKED]: 2,
};

/** Role → minimum (most restrictive) masking_level allowed (LLD §Auth Check). */
const ROLE_MIN_MASKING: Readonly<Partial<Record<RoleCode, MaskingLevel>>> = {
  [RoleCode.RM]: MaskingLevel.FULL,
  [RoleCode.KYC]: MaskingLevel.FULL,
  [RoleCode.PARTNER]: MaskingLevel.FULL,
  [RoleCode.BM]: MaskingLevel.PARTIAL,
  [RoleCode.SM]: MaskingLevel.PARTIAL,
  [RoleCode.HEAD]: MaskingLevel.PARTIAL,
  [RoleCode.DPO]: MaskingLevel.UNMASKED,
  [RoleCode.ADMIN]: MaskingLevel.PARTIAL,
};

/** System actor UUID used for worker updates (no user identity in async context). */
const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

export interface ExportJobResponse {
  export_job_id: string;
  report_code: string;
  status: JobStatus;
  masking_level: MaskingLevel;
  scope: DataScope;
  row_count: number | null;
  approver_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExportJobDetailResponse extends ExportJobResponse {
  download_url: string | null;
  download_url_expires_at: Date | null;
}

/** Safety cap: never page through more than this many export rows. */
const EXPORT_ROW_CAP = 10_000;
/** Page size for internal export paging (each call has LIMIT inside). */
const EXPORT_PAGE_SIZE = 100;

/** PII field names that appear as row keys and need masking. */
const PII_STRING_FIELDS: ReadonlyMap<string, Parameters<MaskingService['mask']>[0]> = new Map([
  ['full_name', 'full_name'],
  ['owner_name', 'full_name'],
  ['mobile', 'mobile'],
  ['pan', 'pan'],
  ['aadhaar', 'aadhaar'],
  ['email', 'email'],
]);

/**
 * FR-122 — export governance service. Owner of `export_jobs` writes.
 * All multi-entity writes use UnitOfWork.run(); no PII in audit detail.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly repo: ExportRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly entitlement: EntitlementCacheService,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
    @Inject(EXPORT_TASK_PORT) private readonly taskPort: ExportTaskPort,
    @Inject(EXPORT_STORAGE_PORT) private readonly storagePort: ExportStoragePort,
    private readonly reportService: ReportService,
    private readonly masking: MaskingService,
  ) {}

  // ── POST /exports ────────────────────────────────────────────────────────

  async create(dto: CreateExportDto, actor: AuthUser): Promise<{ job: ExportJobRow; requiresApproval: boolean }> {
    // 1. Masking level enforcement
    this.enforceMaskingLevel(dto.masking_level as MaskingLevel, actor.role as RoleCode);

    // 2. Scope cross-check: requested scope must be ≤ actor's entitlement scope
    await this.enforceScopeEntitlement(dto.scope as DataScope, actor);

    // 3. Estimate row count
    const threshold = this.config.get('EXPORT_APPROVAL_ROW_THRESHOLD');
    const requireApprovalOnThreshold = this.config.get('EXPORT_REQUIRE_APPROVAL_ON_THRESHOLD');
    const estimatedRows = await this.repo.estimateRowCount(actor.orgId, dto.filters, dto.scope as DataScope);

    const requiresApproval =
      dto.masking_level === MaskingLevel.UNMASKED ||
      (requireApprovalOnThreshold && estimatedRows >= threshold);

    const initialStatus: JobStatus = requiresApproval ? JobStatus.AWAITING_APPROVAL : JobStatus.QUEUED;

    // 4. Transactional insert + audit
    const job = await this.uow.run(async (tx: DbTransaction) => {
      const created = await this.repo.create(tx, {
        dto,
        orgId: actor.orgId,
        actorId: actor.userId,
        status: initialStatus,
      });

      await this.audit.append(
        {
          action: AuditAction.EXPORT_GENERATE,
          entity_type: 'export_jobs',
          entity_id: created.export_job_id,
          actor_id: actor.userId,
          org_id: actor.orgId,
          detail: {
            report_code: dto.report_code,
            scope: dto.scope,
            masking_level: dto.masking_level,
            status: initialStatus,
            // Only keys, never values — prevents PII in audit detail
            filter_keys: Object.keys(dto.filters),
          },
        },
        tx,
      );

      return created;
    });

    // 5. Enqueue if queued (post-commit, not in tx)
    if (initialStatus === JobStatus.QUEUED) {
      await this.taskPort.enqueue(job.export_job_id);
    }

    return { job, requiresApproval };
  }

  // ── GET /exports ─────────────────────────────────────────────────────────

  async list(
    actor: AuthUser,
    page: number,
    limit: number,
    filterStatus?: JobStatus,
  ): Promise<{ rows: ExportJobRow[]; total: number }> {
    const actorEntitlement = await this.entitlement.loadActorEntitlement(actor.userId, actor.orgId);

    const role = actor.role as RoleCode;
    // Scope A roles (HEAD, DPO, ADMIN) see all within org
    const isScopeARole =
      role === RoleCode.HEAD ||
      role === RoleCode.DPO ||
      role === RoleCode.ADMIN;

    // BM scope B — branch
    const isBranchRole = role === RoleCode.BM;

    // SM scope T — team: list exports from all team members
    const isTeamRole = role === RoleCode.SM;

    let teamMemberIds: string[] | undefined;
    if (isTeamRole) {
      const teamId = actorEntitlement?.teamId ?? null;
      if (teamId != null) {
        teamMemberIds = await this.entitlement.loadTeamMemberIds(teamId, actor.orgId);
      } else {
        // SM with no team: matches nothing
        teamMemberIds = [];
      }
    }

    return this.repo.list({
      orgId: actor.orgId,
      actorId: actor.userId,
      ownOnly: !isScopeARole && !isBranchRole && !isTeamRole,
      branchId: isBranchRole ? (actorEntitlement?.branchId ?? null) : undefined,
      teamMemberIds,
      page,
      limit,
      filterStatus,
    });
  }

  // ── GET /exports/{id} ────────────────────────────────────────────────────

  async getById(
    exportJobId: string,
    actor: AuthUser,
  ): Promise<ExportJobDetailResponse> {
    const job = await this.repo.findById(this.uow.tx(), exportJobId, actor.orgId);
    if (!job) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Access control: must be requester OR hold scope-A export
    const isScopeA =
      actor.role === RoleCode.HEAD ||
      actor.role === RoleCode.DPO ||
      actor.role === RoleCode.ADMIN;

    if (job.requested_by !== actor.userId && !isScopeA) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    let downloadUrl: string | null = null;
    let downloadUrlExpiresAt: Date | null = null;

    if (job.status === JobStatus.COMPLETED && job.artefact_ref != null) {
      const ttl = this.config.get('GCS_SIGNED_URL_TTL');
      downloadUrl = await this.storagePort.getSignedUrl(job.artefact_ref, ttl);
      downloadUrlExpiresAt = new Date(Date.now() + ttl * 1000);

      // Append download audit (no tx needed — AuditChainConsumer queue)
      await this.audit.append({
        action: AuditAction.EXPORT_DOWNLOAD,
        entity_type: 'export_jobs',
        entity_id: job.export_job_id,
        actor_id: actor.userId,
        org_id: actor.orgId,
        detail: {
          masking_level: job.masking_level,
          row_count: job.row_count,
        },
      });
    }

    return {
      export_job_id: job.export_job_id,
      report_code: job.report_code,
      status: job.status as JobStatus,
      masking_level: job.masking_level as MaskingLevel,
      scope: job.scope as DataScope,
      row_count: job.row_count,
      approver_id: job.approver_id,
      created_at: job.created_at as Date,
      updated_at: job.updated_at as Date,
      download_url: downloadUrl,
      download_url_expires_at: downloadUrlExpiresAt,
    };
  }

  // ── POST /exports/{id}/approve ────────────────────────────────────────────

  async approve(exportJobId: string, actor: AuthUser): Promise<ExportJobResponse> {
    const job = await this.repo.findById(this.uow.tx(), exportJobId, actor.orgId);
    if (!job) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Job must be awaiting_approval
    if (job.status !== JobStatus.AWAITING_APPROVAL) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'Job is not awaiting approval.');
    }

    // Self-approval blocked
    if (job.requested_by === actor.userId) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Self-approval is not permitted.');
    }

    // Approver scope must be ≥ job's scope
    await this.enforceApproverScope(job.scope as DataScope, actor);

    // Tx: UPDATE status + audit
    await this.uow.run(async (tx: DbTransaction) => {
      await this.repo.updateStatus(tx, exportJobId, actor.orgId, JobStatus.QUEUED, actor.userId, {
        approverId: actor.userId,
      });

      await this.audit.append(
        {
          action: AuditAction.EXPORT_GENERATE,
          entity_type: 'export_jobs',
          entity_id: exportJobId,
          actor_id: actor.userId,
          org_id: actor.orgId,
          detail: {
            event: 'approved',
            approver_id: actor.userId,
            report_code: job.report_code,
          },
        },
        tx,
      );
    });

    // Enqueue generation task post-commit
    await this.taskPort.enqueue(exportJobId);

    const updated = await this.repo.findById(this.uow.tx(), exportJobId, actor.orgId);
    if (!updated) {
      throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
    }

    return {
      export_job_id: updated.export_job_id,
      report_code: updated.report_code,
      status: updated.status as JobStatus,
      masking_level: updated.masking_level as MaskingLevel,
      scope: updated.scope as DataScope,
      row_count: updated.row_count,
      approver_id: updated.approver_id,
      created_at: updated.created_at as Date,
      updated_at: updated.updated_at as Date,
    };
  }

  // ── Worker: generate export ──────────────────────────────────────────────

  async generate(exportJobId: string): Promise<void> {
    const orgRow = await this.uow
      .tx()
      .selectFrom('export_jobs')
      .select('org_id')
      .where('export_job_id', '=', exportJobId)
      .executeTakeFirst();

    if (!orgRow) {
      this.logger.error({ export_job_id: exportJobId }, 'export-worker: job not found');
      return;
    }

    const orgId = orgRow.org_id;
    const job = await this.repo.findById(this.uow.tx(), exportJobId, orgId);

    if (!job) {
      this.logger.error({ export_job_id: exportJobId }, 'export-worker: job not found');
      return;
    }

    if (job.status !== JobStatus.QUEUED) {
      this.logger.warn(
        { export_job_id: exportJobId, status: job.status },
        'export-worker: job not in queued state — skipping',
      );
      return;
    }

    // Mark running (outside main tx — idempotent status flip)
    await this.uow.run(async (tx: DbTransaction) => {
      await this.repo.updateStatus(tx, exportJobId, orgId, JobStatus.RUNNING, SYSTEM_UUID);
    });

    try {
      // Build CSV with watermark + real report rows
      const { csv: csvContent, rowCount } = await this.buildCsv(job);

      // Upload to GCS
      const artefactRef = `exports/${job.org_id}/${exportJobId}.csv`;
      await this.storagePort.upload(artefactRef, csvContent);

      // Tx: UPDATE completed + audit + outbox
      await this.uow.run(async (tx: DbTransaction) => {
        await this.repo.updateStatus(tx, exportJobId, orgId, JobStatus.COMPLETED, SYSTEM_UUID, {
          rowCount,
          artefactRef,
        });

        await this.audit.append(
          {
            action: AuditAction.EXPORT_GENERATE,
            entity_type: 'export_jobs',
            entity_id: exportJobId,
            actor_id: SYSTEM_UUID,
            org_id: job.org_id,
            detail: {
              event: 'completed',
              row_count: rowCount,
              report_code: job.report_code,
              masking_level: job.masking_level,
            },
          },
          tx,
        );

        await this.outbox.emit(
          {
            event_code: EventCode.EXPORT_COMPLETED,
            aggregate_type: 'ExportJob',
            aggregate_id: exportJobId,
            payload: {
              report_code: job.report_code,
              masking_level: job.masking_level,
              row_count: rowCount,
            },
          },
          tx,
        );
      });
    } catch (err) {
      this.logger.error(
        { export_job_id: exportJobId, org_id: job.org_id, err },
        'export-worker: generation failed',
      );
      // Mark failed — best-effort
      try {
        await this.uow.run(async (tx: DbTransaction) => {
          await this.repo.updateStatus(tx, exportJobId, orgId, JobStatus.FAILED, SYSTEM_UUID);
        });
      } catch (updateErr) {
        this.logger.error(
          { export_job_id: exportJobId, err: updateErr },
          'export-worker: failed to mark job as failed',
        );
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private enforceMaskingLevel(requested: MaskingLevel, role: RoleCode): void {
    const minLevel = ROLE_MIN_MASKING[role];
    if (minLevel == null) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    // Lower rank = more restrictive (full=0, partial=1, unmasked=2).
    // If requested rank > min rank, the request is less restrictive than the role minimum.
    if (MASKING_RANK[requested] > MASKING_RANK[minLevel]) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'masking level not permitted for your role', {
        fields: [{ field: 'masking_level', issue: 'masking level not permitted for your role' }],
      });
    }
  }

  private async enforceScopeEntitlement(requestedScope: DataScope, actor: AuthUser): Promise<void> {
    const actorEntitlement = await this.entitlement.loadActorEntitlement(actor.userId, actor.orgId);
    const actorScope = actorEntitlement?.defaultScope ?? DataScope.O;

    // scopeRank: lower = more permissive (A=0, ..., O=4).
    // Requested scope rank < actor scope rank means requesting broader access → FORBIDDEN.
    if (scopeRank(requestedScope) < scopeRank(actorScope)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Requested scope exceeds your entitlement.');
    }
  }

  private async enforceApproverScope(jobScope: DataScope, approver: AuthUser): Promise<void> {
    const approverEntitlement = await this.entitlement.loadActorEntitlement(approver.userId, approver.orgId);
    const approverScope = approverEntitlement?.defaultScope ?? DataScope.O;

    // Approver scope must be ≥ job scope (at least as permissive).
    // Lower rank = more permissive; approver rank must be <= job scope rank.
    if (scopeRank(approverScope) > scopeRank(jobScope)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Approver scope is insufficient to approve this export.');
    }
  }

  private async buildCsv(job: ExportJobRow): Promise<{ csv: string; rowCount: number }> {
    const requester = await this.uow
      .tx()
      .selectFrom('users')
      .select(['user_id', 'full_name'])
      .where('user_id', '=', job.requested_by)
      .executeTakeFirst();

    const userName = requester?.full_name ?? job.requested_by;
    const timestamp = new Date().toISOString();

    // UTF-8 BOM (﻿) for Excel compatibility
    const watermark =
      `# LMS Export | Generated by: ${userName} (${job.requested_by}) | At: ${timestamp} | Report: ${job.report_code} | Masking: ${job.masking_level}`;

    // Rebuild the requester's scope predicate so the export can never exceed it.
    const predicate = await this.buildScopePredicate(job);

    // Parse filters stored in the job (user-supplied at create time).
    // The column is JSONB; Kysely may hand back a parsed object or a string.
    let parsedFilters: Record<string, unknown> = {};
    try {
      const raw = job.filters;
      if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
        parsedFilters = raw as Record<string, unknown>;
      } else if (typeof raw === 'string') {
        parsedFilters = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      this.logger.warn({ export_job_id: job.export_job_id }, 'export-worker: failed to parse job filters, using empty');
    }
    // Convert date strings back to Date objects for ReportFilters compatibility.
    const filters: ReportFilters = {
      from: typeof parsedFilters['from'] === 'string' ? new Date(parsedFilters['from']) : undefined,
      to: typeof parsedFilters['to'] === 'string' ? new Date(parsedFilters['to']) : undefined,
      branch_id: typeof parsedFilters['branch_id'] === 'string' ? parsedFilters['branch_id'] : undefined,
      team_id: typeof parsedFilters['team_id'] === 'string' ? parsedFilters['team_id'] : undefined,
      owner_id: typeof parsedFilters['owner_id'] === 'string' ? parsedFilters['owner_id'] : undefined,
      product_code: typeof parsedFilters['product_code'] === 'string' ? parsedFilters['product_code'] as ReportFilters['product_code'] : undefined,
      source: typeof parsedFilters['source'] === 'string' ? parsedFilters['source'] as ReportFilters['source'] : undefined,
      partner_id: typeof parsedFilters['partner_id'] === 'string' ? parsedFilters['partner_id'] : undefined,
    };

    // Page through ALL rows up to EXPORT_ROW_CAP (each page has its own LIMIT).
    const allRows: ReportRow[] = [];
    let page = 1;
    let total = 0;
    let capped = false;

    do {
      const result = await this.reportService.fetchExportRows(
        job.report_code as ReportCode,
        job.org_id,
        predicate,
        filters,
        page,
        EXPORT_PAGE_SIZE,
      );
      total = result.total;
      // No more rows — stop even if `total` (a count estimate) is higher, else an
      // over-counted total would spin this loop forever fetching empty pages.
      if (result.rows.length === 0) {
        break;
      }
      allRows.push(...result.rows);
      if (allRows.length >= EXPORT_ROW_CAP) {
        capped = true;
        break;
      }
      page++;
    } while (allRows.length < total);

    if (capped) {
      this.logger.warn(
        { export_job_id: job.export_job_id, report_code: job.report_code, row_cap: EXPORT_ROW_CAP },
        'export-worker: row count capped at safety limit',
      );
    }

    // Mask each row per masking_level before serialising.
    const maskedRows = allRows.map((row) => this.maskRow(row as unknown as Record<string, unknown>, job.masking_level as MaskingLevel));

    // Build CSV: stable column order from first row's keys.
    const columns: string[] = maskedRows.length > 0 ? Object.keys(maskedRows[0] ?? {}) : [];
    const headerLine = columns.map(csvEscape).join(',');
    const dataLines = maskedRows.map((row) =>
      columns.map((col) => csvEscape(String(row[col] ?? ''))).join(','),
    );

    const csv = `﻿${watermark}\n${headerLine}\n${dataLines.join('\n')}\n`;
    return { csv, rowCount: maskedRows.length };
  }

  /**
   * Rebuild the `ScopePredicate` the requester would have received when the
   * export was created. This constrains the worker's query to exactly the scope
   * the requester was entitled to — the export can never produce rows beyond it.
   *
   * Mirrors the logic in `EntitlementService.evaluateScope`.
   */
  private async buildScopePredicate(job: ExportJobRow): Promise<ScopePredicate> {
    const entitlement = await this.entitlement.loadActorEntitlement(job.requested_by, job.org_id);
    const scope = job.scope as DataScope;

    switch (scope) {
      case DataScope.O:
        return { type: 'own', userId: job.requested_by };

      case DataScope.T: {
        const teamId = entitlement?.teamId ?? null;
        if (teamId == null) {
          // No team — fail the job: cannot widen scope to org-all.
          throw new Error(`export-worker: SM requester ${job.requested_by} has no teamId; cannot reconstruct team predicate`);
        }
        const userIds = await this.entitlement.loadTeamMemberIds(teamId, job.org_id);
        return { type: 'team', userIds };
      }

      case DataScope.B: {
        const branchId = entitlement?.branchId ?? null;
        if (branchId == null) {
          throw new Error(`export-worker: requester ${job.requested_by} has no branchId; cannot reconstruct branch predicate`);
        }
        return { type: 'branch', branchId };
      }

      case DataScope.R: {
        const regionId = entitlement?.regionId ?? null;
        if (regionId == null) {
          throw new Error(`export-worker: requester ${job.requested_by} has no regionId; cannot reconstruct region predicate`);
        }
        const branchIds = await this.entitlement.loadRegionBranchIds(regionId, job.org_id);
        return { type: 'region', branchIds };
      }

      case DataScope.A:
        return { type: 'all', orgId: job.org_id };

      case DataScope.M:
        return { type: 'masked', orgId: job.org_id };

      case DataScope.P: {
        const partnerId = entitlement?.partnerId ?? null;
        if (partnerId == null) {
          throw new Error(`export-worker: requester ${job.requested_by} has no partnerId; cannot reconstruct partner predicate`);
        }
        return { type: 'partner', partnerId };
      }

      default:
        throw new Error(`export-worker: unrecognised scope '${String(scope)}' on job ${job.export_job_id}`);
    }
  }

  /**
   * Apply masking to a single report row (treated as a flat string-keyed record).
   * For `unmasked` (post-approval only) no masking is applied.
   */
  private maskRow(row: Record<string, unknown>, level: MaskingLevel): Record<string, unknown> {
    if (level === MaskingLevel.UNMASKED) {
      return row;
    }
    const strict = level === MaskingLevel.FULL;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const fieldKind = PII_STRING_FIELDS.get(key);
      if (fieldKind != null && typeof value === 'string') {
        out[key] = this.masking.mask(fieldKind, value, { strict });
      } else {
        out[key] = value;
      }
    }
    return out;
  }
}

/** CSV-escape a value: wrap in quotes if it contains comma, quote, or newline. */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
