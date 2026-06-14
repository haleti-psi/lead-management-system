import { Inject, Injectable } from '@nestjs/common';

import { ERROR_CODES, RoleCode } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { type AuthUser } from '../../core/auth';
import { DomainException } from '../../core/http';
import { DataSharingLogsRepository, type DataSharingLogRow } from './data-sharing-logs.repository';

export interface SharingLogListResult {
  rows: DataSharingLogRow[];
  pagination: { page: number; limit: number; total: number };
}

/**
 * Roles permitted to access `GET /leads/{id}/sharing-logs`.
 *
 * The auth-matrix grants `consent_ledger` at scope `A` to HEAD and ADMIN as
 * well as DPO, but the LLD §Auth restricts this endpoint to DPO only — the
 * compliance oversight view is a DPO-specific function, not a general
 * all-org report. Because no capability is DPO-exclusive, an explicit role
 * assertion is required (auth-matrix §capability_conditions is advisory, not
 * enforcement; enforcement lives here per the LLD).
 */
const SHARING_LOGS_ALLOWED_ROLES = new Set<string>([RoleCode.DPO]);

/**
 * FR-111 — read service for the DPO oversight view of `data_sharing_logs`.
 * Exposes the `GET /leads/{id}/sharing-logs` query path only; no write path
 * (writes live in {@link DataSharingService}, called within UoW transactions
 * of the consuming FRs — FR-071, FR-080, FR-081).
 */
@Injectable()
export class DataSharingLogsService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly repo: DataSharingLogsRepository,
  ) {}

  /**
   * List data-sharing log rows for a lead, with pagination.
   *
   * Steps (LLD §Backend Flow "GET /leads/{id}/sharing-logs"):
   * 0. Assert caller is DPO (role-level check — no capability is DPO-exclusive).
   * 1. Check the lead exists and is not soft-deleted (404 if absent).
   * 2. Query the repository for paginated rows ordered by `shared_at DESC`.
   * 3. Return rows + pagination meta.
   *
   * @param leadId  UUID of the lead (validated by the controller).
   * @param user    Authenticated principal (for DPO role assertion).
   * @param page    1-based page number (default 1 from DTO).
   * @param limit   Page size 1–100 (default 25 from DTO).
   */
  async listForLead(
    leadId: string,
    user: AuthUser,
    page: number,
    limit: number,
  ): Promise<SharingLogListResult> {
    // ── Step 0: DPO-only role assertion (LLD §Auth — no capability is DPO-exclusive) ──
    if (!SHARING_LOGS_ALLOWED_ROLES.has(user.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // ── Step 1: lead existence check (404 on absent or soft-deleted) ──────────
    const lead = await this.db
      .selectFrom('leads')
      .select(['lead_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', user.orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();

    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // ── Step 2: query the repository ──────────────────────────────────────────
    const [rows, total] = await Promise.all([
      this.repo.findByLeadId(leadId, user.orgId, { page, limit }),
      this.repo.countByLeadId(leadId, user.orgId),
    ]);

    return { rows, pagination: { page, limit, total } };
  }
}
