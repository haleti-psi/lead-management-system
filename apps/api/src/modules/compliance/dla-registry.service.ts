import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  ConfigStatus,
  ERROR_CODES,
  RoleCode,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { DLA_REGISTRY_RESOURCE_TYPE } from './dla-registry.constants';
import {
  DlaRegistryRepository,
  rowToDlaData,
  toJsonColumn,
  type DlaData,
} from './dla-registry.repository';
import type { CreateDlaDto } from './dto/create-dla.dto';
import type { UpdateDlaDto } from './dto/update-dla.dto';
import type { ListDlaFiltersDto } from './dto/list-dla-filters.dto';

/** Allowed roles for all DLA registry mutations and reads (LLD §Auth Check). */
const ALLOWED_ROLES: ReadonlySet<string> = new Set<string>([RoleCode.DPO, RoleCode.ADMIN]);

/** Mandatory disclosure fields required when status = 'active'. */
const MANDATORY_ACTIVE_FIELDS: ReadonlyArray<{
  field: string;
  test: (v: Partial<ActiveCheck>) => boolean;
  message: string;
}> = [
  {
    field: 'owner',
    test: (v) => !v.owner || v.owner.trim() === '',
    message: 'owner is required for active entries',
  },
  {
    field: 'url',
    test: (v) => !v.url || v.url.trim() === '',
    message: 'url is required for active entries',
  },
  {
    field: 'grievance_officer',
    test: (v) => v.grievance_officer == null,
    message: 'grievance_officer is required for active entries',
  },
  {
    field: 'storage_location',
    test: (v) => !v.storage_location || v.storage_location.trim() === '',
    message: 'storage_location is required for active entries',
  },
];

interface ActiveCheck {
  owner?: string | null;
  url?: string | null;
  grievance_officer?: unknown;
  storage_location?: string | null;
}

/** Valid status transitions: from → Set<allowed-to>. */
const VALID_TRANSITIONS: ReadonlyMap<ConfigStatus, ReadonlySet<ConfigStatus>> = new Map([
  [ConfigStatus.DRAFT, new Set([ConfigStatus.ACTIVE])],
  [ConfigStatus.ACTIVE, new Set([ConfigStatus.RETIRED])],
  [ConfigStatus.RETIRED, new Set<ConfigStatus>()],
]);

export interface DlaActorContext {
  callerId: string;
  orgId: string;
}

export interface DlaListResult {
  data: DlaData[];
  pagination: { page: number; limit: number; total: number };
}

/**
 * FR-113 — DLA/LSP Registry service (M12 Compliance). Sole writer of `dla_registry`.
 *
 * Enforces:
 * - Role check: only DPO and ADMIN may call any endpoint.
 * - Mandatory disclosure fields validated when status = 'active'.
 * - Name-uniqueness within org (pre-insert lookup, LLD Ambiguity #2).
 * - State-machine transitions (draft → active → retired; no reversals).
 * - audit via AuditAppender in the same UnitOfWork transaction as the write.
 *
 * No LeadService involvement — dla_registry is configuration data, not lead content.
 * No OutboxService — no outbox events for DLA status changes per LLD §State Machine.
 */
@Injectable()
export class DlaRegistryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: DlaRegistryRepository,
    private readonly audit: AuditAppender,
    @InjectPinoLogger(DlaRegistryService.name) private readonly logger: PinoLogger,
  ) {}

  // ─────────────────────────────────────────────────────────── Role guard ──

  /**
   * Enforce the EXACT allowed-role set from LLD §Auth Check.
   * Only DPO (scope B) and ADMIN (scope A) hold `configuration` for dla_registry.
   * All other roles — even those with `configuration` capability (BM, HEAD, KYC) —
   * are denied with FORBIDDEN.
   */
  assertAllowedRole(role: string): void {
    if (!ALLOWED_ROLES.has(role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Only DPO and ADMIN roles may access the DLA registry.');
    }
  }

  // ─────────────────────────────────────────────────────────────── List ──

  async list(
    filters: ListDlaFiltersDto,
    ctx: DlaActorContext,
    callerRole: string,
  ): Promise<DlaListResult> {
    this.assertAllowedRole(callerRole);

    const { rows, total } = await this.repo.list({
      orgId: ctx.orgId,
      filters: {
        type: filters.type,
        status: filters.status,
        sort: filters.sort,
      },
      pagination: { page: filters.page, limit: filters.limit },
    });

    return {
      data: rows.map(rowToDlaData),
      pagination: { page: filters.page, limit: filters.limit, total },
    };
  }

  // ─────────────────────────────────────────────────────────── Create ──

  async create(dto: CreateDlaDto, ctx: DlaActorContext, callerRole: string): Promise<DlaData> {
    this.assertAllowedRole(callerRole);

    const { callerId, orgId } = ctx;
    const status = dto.status ?? ConfigStatus.DRAFT;

    // Business-rule validation for active entries (service layer — not Zod)
    if (status === ConfigStatus.ACTIVE) {
      this.validateMandatoryDisclosureFields({
        owner: dto.owner ?? null,
        url: dto.url ?? null,
        grievance_officer: dto.grievance_officer ?? null,
        storage_location: dto.storage_location ?? null,
      });
    }

    // Name-uniqueness check (LLD Ambiguity #2 — service-layer enforcement)
    const existing = await this.repo.findByNameAndOrg(dto.name, orgId);
    if (existing) {
      throw new DomainException(ERROR_CODES.CONFLICT, `A DLA registry entry with the name '${dto.name}' already exists.`);
    }

    return this.uow.run(async (tx) => {
      const row = await this.repo.create(
        {
          org_id: orgId,
          name: dto.name,
          type: dto.type,
          owner: dto.owner ?? null,
          url: dto.url ?? null,
          grievance_officer: toJsonColumn(dto.grievance_officer ?? null),
          enabled_products: toJsonColumn(dto.enabled_products ?? null),
          data_collected: toJsonColumn(dto.data_collected ?? null),
          storage_location: dto.storage_location ?? null,
          status,
          created_by: callerId,
          updated_by: callerId,
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: DLA_REGISTRY_RESOURCE_TYPE,
          entity_id: row.dla_registry_id,
          actor_id: callerId,
          org_id: orgId,
          lead_id: null,
          detail: {
            event: 'DLA_REGISTRY_CREATED',
            name: row.name,
            type: row.type,
            status: row.status,
          },
        },
        tx,
      );

      this.logger.info(
        { dlaRegistryId: row.dla_registry_id, orgId, status: row.status },
        'DLA registry entry created',
      );

      return rowToDlaData(row);
    });
  }

  // ─────────────────────────────────────────────────────────── Update ──

  async update(dto: UpdateDlaDto, ctx: DlaActorContext, callerRole: string): Promise<DlaData> {
    this.assertAllowedRole(callerRole);

    const { callerId, orgId } = ctx;
    const { dla_registry_id: id, ...patch } = dto;

    // Fetch existing entry (NOT_FOUND → 404)
    const existing = await this.repo.findById(id, orgId);
    if (!existing) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, 'DLA registry entry not found.');
    }

    // Status transition validation
    if (patch.status !== undefined) {
      this.validateStatusTransition(existing.status, patch.status);
    }

    // Compute the merged state to validate disclosure fields on activation
    const mergedStatus = patch.status ?? existing.status;
    const mergedOwner = 'owner' in patch ? (patch.owner ?? null) : (existing.owner ?? null);
    const mergedUrl = 'url' in patch ? (patch.url ?? null) : (existing.url ?? null);
    const mergedGrievanceOfficer =
      'grievance_officer' in patch
        ? (patch.grievance_officer ?? null)
        : existing.grievance_officer;
    const mergedStorageLocation =
      'storage_location' in patch
        ? (patch.storage_location ?? null)
        : (existing.storage_location ?? null);

    if (mergedStatus === ConfigStatus.ACTIVE) {
      this.validateMandatoryDisclosureFields({
        owner: mergedOwner,
        url: mergedUrl,
        grievance_officer: mergedGrievanceOfficer,
        storage_location: mergedStorageLocation,
      });
    }

    return this.uow.run(async (tx) => {
      const updated = await this.repo.update(
        id,
        orgId,
        {
          ...('name' in patch && patch.name !== undefined ? { name: patch.name } : {}),
          ...('type' in patch && patch.type !== undefined ? { type: patch.type } : {}),
          ...('owner' in patch ? { owner: patch.owner ?? null } : {}),
          ...('url' in patch ? { url: patch.url ?? null } : {}),
          ...('grievance_officer' in patch
            ? { grievance_officer: toJsonColumn(patch.grievance_officer ?? null) }
            : {}),
          ...('enabled_products' in patch
            ? { enabled_products: toJsonColumn(patch.enabled_products ?? null) }
            : {}),
          ...('data_collected' in patch
            ? { data_collected: toJsonColumn(patch.data_collected ?? null) }
            : {}),
          ...('storage_location' in patch
            ? { storage_location: patch.storage_location ?? null }
            : {}),
          ...('status' in patch && patch.status !== undefined ? { status: patch.status } : {}),
          updated_by: callerId,
          updated_at: new Date(),
        },
        tx,
      );

      // Guard against race (row disappeared between findById and update)
      if (!updated) {
        throw new DomainException(ERROR_CODES.NOT_FOUND, 'DLA registry entry not found.');
      }

      const changedFields = Object.keys(patch) as string[];

      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: DLA_REGISTRY_RESOURCE_TYPE,
          entity_id: id,
          actor_id: callerId,
          org_id: orgId,
          lead_id: null,
          detail: {
            event: 'DLA_REGISTRY_UPDATED',
            changed_fields: changedFields,
            previous_status: existing.status,
            new_status: updated.status,
          },
        },
        tx,
      );

      this.logger.info(
        { dlaRegistryId: id, orgId, previousStatus: existing.status, newStatus: updated.status },
        'DLA registry entry updated',
      );

      return rowToDlaData(updated);
    });
  }

  // ──────────────────────────────────────────────── Validation helpers ──

  /**
   * Validate that all mandatory disclosure fields are present for an active entry.
   * Throws VALIDATION_ERROR (400) listing ALL missing fields.
   */
  validateMandatoryDisclosureFields(entry: ActiveCheck): void {
    const missingFields = MANDATORY_ACTIVE_FIELDS
      .filter((rule) => rule.test(entry))
      .map((rule) => ({ field: rule.field, issue: rule.message }));

    if (missingFields.length > 0) {
      throw new DomainException(
        ERROR_CODES.VALIDATION_ERROR,
        'Active DLA registry entries require all mandatory disclosure fields.',
        { fields: missingFields },
      );
    }
  }

  /**
   * Validate a status transition. Throws CONFLICT (409) for invalid transitions.
   * No-op when `from === to` (same-status "update" without status field).
   */
  validateStatusTransition(from: ConfigStatus, to: ConfigStatus): void {
    if (from === to) return; // no-op — same status is not a transition

    const allowed = VALID_TRANSITIONS.get(from);
    if (!allowed || !allowed.has(to)) {
      throw new DomainException(
        ERROR_CODES.CONFLICT,
        `Invalid status transition: ${from} → ${to}.`,
      );
    }
  }
}
