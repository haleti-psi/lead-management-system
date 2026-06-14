import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  ERROR_CODES,
  EventCode,
  RightsStatus,
  RightsType,
  RoleCode,
  SlaTarget,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { SlaEngine } from '../../core/sla';
import {
  DATA_RIGHTS_RESOURCE_TYPE,
  DATA_RIGHTS_SLA_FALLBACK_DAYS,
} from './data-rights.constants';
import { DataRightsRepository, type DataRightsRow } from './data-rights.repository';
import { DataRightsStateMachine } from './data-rights.state-machine';
import type { CreateDataRightsDto } from './dto/create-data-rights.dto';
import type { UpdateDataRightsDto } from './dto/update-data-rights.dto';
import type { ListDataRightsQuery } from './dto/list-data-rights.dto';

/** Caller context for staff and customer-link paths. */
export interface DataRightsActorContext {
  callerId: string;
  orgId: string;
  predicate: ScopePredicate | undefined;
}

/** Full data-rights resource shape returned by all endpoints. */
export interface DataRightsData {
  dataRightsRequestId: string;
  customerProfileId: string;
  leadId: string | null;
  requestType: RightsType;
  status: RightsStatus;
  ownerId: string | null;
  dueAt: Date | null;
  disposition: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface DataRightsListResult {
  data: DataRightsData[];
  pagination: { page: number; limit: number; total: number };
}

/**
 * FR-112 — Data-Principal Rights Workflow service (M12 Compliance).
 *
 * Sole writer of `data_rights_requests`. Implements:
 *  - Create (POST): SLA due-date, audit + outbox in one UnitOfWork.
 *  - Process (PATCH): state-machine validation, legal-hold check for erasure,
 *    audit + outbox (FR-115 seam) in one UnitOfWork.
 *  - List (GET): paginated, org-scoped; DPO sees all (scope A).
 *
 * **Role enforcement:** The PATCH endpoint is DPO-only. AbacGuard already checks
 * the `consent_ledger` capability but that capability is held by many roles
 * (RM, BM, SM, HEAD, KYC, DPO, PARTNER, CUSTOMER per auth-matrix.json).
 * This service enforces the DPO-only restriction explicitly (LLD §Auth Check
 * Endpoint 3 "role must be DPO") via {@link assertDpoRole}.
 */
@Injectable()
export class DataRightsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: DataRightsRepository,
    private readonly sla: SlaEngine,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(DataRightsService.name) private readonly logger: PinoLogger,
  ) {}

  // ─────────────────────────────────────────────────────────── List ──

  async list(
    query: ListDataRightsQuery,
    ctx: DataRightsActorContext,
    callerRole: string,
  ): Promise<DataRightsListResult> {
    // ── DPO-only — GET /data-rights is a staff-only DPO endpoint ──
    this.assertDpoRole(callerRole);

    const { rows, total } = await this.repo.list({ orgId: ctx.orgId, query });
    return {
      data: rows.map(toDataRightsData),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  // ─────────────────────────────────────────────────────── Create ──

  /**
   * Create a new data-rights request and emit audit + outbox in one tx.
   * Idempotency-Key replay is handled at the controller level.
   */
  async create(dto: CreateDataRightsDto, ctx: DataRightsActorContext): Promise<DataRightsData> {
    const { callerId, orgId } = ctx;
    const requestId = randomUUID();
    const now = new Date();

    // SLA due-at: try SlaTarget.GRIEVANCE (proxy per LLD §Ambiguity #1);
    // fall back to now + 30 calendar days if no policy returns.
    let dueAt: Date | null = null;
    try {
      const result = await this.sla.computeDueAt(SlaTarget.GRIEVANCE, { branchId: undefined, regionId: undefined });
      dueAt = result?.dueAt ?? addCalendarDays(now, DATA_RIGHTS_SLA_FALLBACK_DAYS);
    } catch (err) {
      this.logger.warn(
        { err, requestId },
        'SLA computation failed for data-rights request; using fallback due_at',
      );
      dueAt = addCalendarDays(now, DATA_RIGHTS_SLA_FALLBACK_DAYS);
    }

    return this.uow.run(async (tx) => {
      // 1. Insert row
      const row = await this.repo.insert(
        {
          data_rights_request_id: requestId,
          org_id: orgId,
          customer_profile_id: dto.customerProfileId,
          lead_id: dto.leadId,
          request_type: dto.requestType,
          status: RightsStatus.OPEN,
          owner_id: null,
          due_at: dueAt,
          disposition: null,
          created_by: callerId,
          updated_by: callerId,
        },
        tx,
      );

      // 2. Audit (LLD §Ambiguity #4: nearest audit_action is consent_grant)
      await this.audit.append(
        {
          action: AuditAction.CONSENT_GRANT,
          entity_type: DATA_RIGHTS_RESOURCE_TYPE,
          entity_id: requestId,
          actor_id: callerId,
          org_id: orgId,
          detail: {
            event: 'DATA_RIGHT_REQUEST_CREATED',
            request_type: dto.requestType,
          },
        },
        tx,
      );

      // 3. Outbox event — notifies DPO asynchronously (LLD §Create flow step 3c)
      await this.outbox.emit(
        {
          event_code: EventCode.DATA_RIGHT_REQUEST,
          aggregate_type: 'DataRightsRequest',
          aggregate_id: requestId,
          payload: {
            subType: 'CREATED',
            requestType: dto.requestType,
            customerProfileId: dto.customerProfileId,
          },
        },
        tx,
      );

      return toDataRightsData(row);
    });
  }

  // ─────────────────────────────────────────────────────── Process ──

  /**
   * Process (PATCH) a data-rights request. DPO-only (enforced explicitly below).
   * Validates the state-machine transition, legal-hold check for erasure,
   * then writes audit + outbox in one UnitOfWork.
   */
  async process(
    requestId: string,
    dto: UpdateDataRightsDto,
    ctx: DataRightsActorContext,
    callerRole: string,
  ): Promise<DataRightsData> {
    const { callerId, orgId } = ctx;

    // ── DPO-only role enforcement (LLD §Auth Check Endpoint 3) ──
    this.assertDpoRole(callerRole);

    // ── Load existing row (404 if absent or wrong org) ──
    const existing = await this.repo.findByIdOrThrow(requestId, orgId);

    // ── State machine validation (409 CONFLICT on invalid transition) ──
    DataRightsStateMachine.validateTransition(existing.status, dto.status);

    // ── Legal-hold check (erasure fulfilment only) ──
    if (
      existing.request_type === RightsType.ERASURE &&
      dto.status === RightsStatus.FULFILLED
    ) {
      const hasHold = await this.repo.hasActiveLegalHold(orgId);
      if (hasHold) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: {
            reason: 'LEGAL_HOLD',
            explanation:
              'One or more active retention policies have legal_hold=true for this data category.',
          },
        });
      }
    }

    // Resolve owner_id: dto.ownerId if provided, else existing, else caller
    const resolvedOwnerId =
      dto.ownerId !== undefined ? dto.ownerId : (existing.owner_id ?? callerId);

    return this.uow.run(async (tx) => {
      // 1. Update row
      const updated = await this.repo.update(
        requestId,
        orgId,
        {
          status: dto.status,
          disposition: dto.disposition !== undefined ? dto.disposition : existing.disposition,
          owner_id: resolvedOwnerId,
          updated_by: callerId,
        },
        tx,
      );

      // 2. Audit
      await this.audit.append(
        {
          action: AuditAction.CONSENT_GRANT,
          entity_type: DATA_RIGHTS_RESOURCE_TYPE,
          entity_id: requestId,
          actor_id: callerId,
          org_id: orgId,
          detail: {
            transition: { from: existing.status, to: dto.status },
          },
        },
        tx,
      );

      // 3. Outbox: erasure approval uses a distinguishable payload.subType so
      //    FR-115 RetentionEngine can act asynchronously (FR-115 seam).
      const isErasureApproval =
        existing.request_type === RightsType.ERASURE &&
        dto.status === RightsStatus.FULFILLED;

      await this.outbox.emit(
        {
          event_code: EventCode.DATA_RIGHT_REQUEST,
          aggregate_type: 'DataRightsRequest',
          aggregate_id: requestId,
          payload: isErasureApproval
            ? {
                subType: 'ERASURE_APPROVED',
                customerProfileId: existing.customer_profile_id,
                leadId: existing.lead_id,
              }
            : {
                subType: 'UPDATED',
                status: dto.status,
              },
        },
        tx,
      );

      return toDataRightsData(updated);
    });
  }

  // ─────────────────────────────────────────────────── Helpers ──

  /**
   * Enforce DPO-only on the PATCH endpoint.
   * AbacGuard checks `consent_ledger` capability but that is held by many roles.
   * The LLD explicitly restricts PATCH to DPO (LLD §Auth Check Endpoint 3).
   *
   * @throws {DomainException} FORBIDDEN (403) when the caller is not DPO.
   */
  assertDpoRole(role: string): void {
    if (role !== RoleCode.DPO) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }
}

// ───────────────────────────────────────────── Serialisation ──

function toDataRightsData(row: DataRightsRow): DataRightsData {
  return {
    dataRightsRequestId: row.data_rights_request_id,
    customerProfileId: row.customer_profile_id,
    leadId: row.lead_id,
    requestType: row.request_type,
    status: row.status,
    ownerId: row.owner_id,
    dueAt: row.due_at instanceof Date ? row.due_at : row.due_at ? new Date(row.due_at) : null,
    disposition: row.disposition,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    createdBy: row.created_by,
  };
}

/** Add `days` calendar days to `date` (simple arithmetic, no business-day logic). */
function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
