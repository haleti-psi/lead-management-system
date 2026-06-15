import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { DataScope, JobStatus, MaskingLevel } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { ExportJobs } from '../../core/db/types.generated';
import type { CreateExportDto } from './dto/create-export.dto';

export type ExportJobRow = Selectable<ExportJobs>;

export interface CreateExportParams {
  dto: CreateExportDto;
  orgId: string;
  actorId: string;
  status: JobStatus;
}

export interface ListExportsParams {
  orgId: string;
  actorId: string;
  /** RM/KYC/PARTNER: own only */
  ownOnly: boolean;
  /** BM: subquery branch_id */
  branchId?: string | null;
  /** SM: list exports from these team member user_ids */
  teamMemberIds?: string[];
  page: number;
  limit: number;
  filterStatus?: JobStatus;
}

/**
 * FR-122 — repository for `export_jobs`. Owner-write: only ExportService calls these methods.
 * All queries are parameterised Kysely (no string interpolation). Every list has LIMIT.
 */
@Injectable()
export class ExportRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  async create(
    tx: DbTransaction,
    params: CreateExportParams,
  ): Promise<ExportJobRow> {
    return tx
      .insertInto('export_jobs')
      .values({
        org_id: params.orgId,
        requested_by: params.actorId,
        report_code: params.dto.report_code,
        filters: JSON.stringify(params.dto.filters),
        scope: params.dto.scope as DataScope,
        masking_level: params.dto.masking_level as MaskingLevel,
        status: params.status,
        approver_id: null,
        artefact_ref: null,
        row_count: null,
        created_by: params.actorId,
        updated_by: params.actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    db: KyselyDb | DbTransaction,
    exportJobId: string,
    orgId: string,
  ): Promise<ExportJobRow | undefined> {
    return db
      .selectFrom('export_jobs')
      .selectAll()
      .where('export_job_id', '=', exportJobId)
      .where('org_id', '=', orgId)
      .executeTakeFirst();
  }

  async list(params: ListExportsParams): Promise<{ rows: ExportJobRow[]; total: number }> {
    let query = this.db
      .selectFrom('export_jobs')
      .selectAll()
      .where('org_id', '=', params.orgId)
      .orderBy('created_at', 'desc')
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);

    let countQuery = this.db
      .selectFrom('export_jobs')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('org_id', '=', params.orgId);

    if (params.ownOnly) {
      query = query.where('requested_by', '=', params.actorId);
      countQuery = countQuery.where('requested_by', '=', params.actorId);
    } else if (params.teamMemberIds != null) {
      // SM scope T: requested_by in team member list; empty list → matches nothing
      if (params.teamMemberIds.length === 0) {
        query = query.where('requested_by', 'in', ['']);
        countQuery = countQuery.where('requested_by', 'in', ['']);
      } else {
        query = query.where('requested_by', 'in', params.teamMemberIds);
        countQuery = countQuery.where('requested_by', 'in', params.teamMemberIds);
      }
    } else if (params.branchId != null) {
      // BM scope: requested_by in actor's branch
      const branchSubquery = this.db
        .selectFrom('users')
        .select('user_id')
        .where('branch_id', '=', params.branchId);
      query = query.where('requested_by', 'in', branchSubquery);
      countQuery = countQuery.where('requested_by', 'in', branchSubquery);
    }
    // HEAD/DPO/ADMIN scope A: org_id filter is sufficient

    if (params.filterStatus != null) {
      query = query.where('status', '=', params.filterStatus);
      countQuery = countQuery.where('status', '=', params.filterStatus);
    }

    const [rows, countRow] = await Promise.all([
      query.execute(),
      countQuery.executeTakeFirstOrThrow(),
    ]);

    return { rows, total: parseInt(countRow.total, 10) };
  }

  async updateStatus(
    tx: DbTransaction,
    exportJobId: string,
    orgId: string,
    status: JobStatus,
    updatedBy: string,
    extra?: {
      approverId?: string;
      rowCount?: number;
      artefactRef?: string;
    },
  ): Promise<void> {
    await tx
      .updateTable('export_jobs')
      .set({
        status,
        updated_by: updatedBy,
        ...(extra?.approverId !== undefined ? { approver_id: extra.approverId } : {}),
        ...(extra?.rowCount !== undefined ? { row_count: extra.rowCount } : {}),
        ...(extra?.artefactRef !== undefined ? { artefact_ref: extra.artefactRef } : {}),
      })
      .where('export_job_id', '=', exportJobId)
      .where('org_id', '=', orgId)
      .execute();
  }

  async estimateRowCount(
    orgId: string,
    filters: Record<string, unknown>,
    scope: DataScope,
  ): Promise<number> {
    // Build a scoped count against `leads` using any date/branch filters present.
    let query = this.db
      .selectFrom('leads')
      .select((eb) => eb.fn.countAll<string>().as('cnt'))
      .where('org_id', '=', orgId);

    const dateFrom = filters['date_from'];
    const dateTo = filters['date_to'];
    const branchId = filters['branch_id'];

    if (typeof dateFrom === 'string') {
      query = query.where('created_at', '>=', new Date(dateFrom));
    }
    if (typeof dateTo === 'string') {
      query = query.where('created_at', '<=', new Date(dateTo));
    }
    if (typeof branchId === 'string') {
      query = query.where('branch_id', '=', branchId);
    }

    // Scope O: own scope is narrow — count is typically low.
    if (scope === 'O') {
      const row = await query.limit(1).executeTakeFirstOrThrow();
      return parseInt(row.cnt, 10);
    }

    const row = await query.executeTakeFirstOrThrow();
    return parseInt(row.cnt, 10);
  }
}
