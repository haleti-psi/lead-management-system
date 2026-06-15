import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  AuditAction,
  ERROR_CODES,
  type PaginationMeta,
  type PartnerStatus,
  type RoleCode,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { isUniqueViolation } from '../admin/master/pg-error';
import {
  PARTNER_RESOURCE_TYPE,
  PARTNER_STATUS_ADMIN_ROLES,
  PARTNER_STATUS_TRANSITIONS,
} from './partner.constants';
import {
  PartnerRepository,
  type PartnerChanges,
  type PartnerRow,
  type PartnerScope,
} from './partner.repository';
import type { CreatePartnerDto } from './dto/create-partner.dto';
import type { ListPartnersQuery } from './dto/list-partners.dto';
import type { UpdatePartnerDto } from './dto/update-partner.dto';

/** Caller context (from the JWT + AbacGuard predicate). */
export interface PartnerActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  predicate: ScopePredicate | undefined;
}

/** List-row view (masked contact_mobile). */
export interface PartnerView {
  partnerId: string;
  partnerCode: string;
  type: string;
  legalName: string;
  branchId: string | null;
  products: string[];
  contactPerson: string | null;
  contactMobile: string | null;
  status: string;
  agreementRef: string | null;
  commissionFlag: boolean;
  mappedRmId: string | null;
  riskCategory: string | null;
  qualityScore: number | null;
  validUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerView {
  partnerId: string;
  partnerCode: string;
  type: string;
  legalName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdatePartnerView {
  partnerId: string;
  partnerCode: string;
  status: string;
  updatedAt: Date;
}

/**
 * FR-090 — Partner master CRUD (M10; sole writer of `partners`). List is
 * branch-scoped for BM (in-branch + org-wide); status changes follow the
 * `active → suspended/expired`, `suspended → active/expired` machine and are
 * restricted to ADMIN/HEAD. Every write audits (`config_change`, entity
 * `partner`, contact_mobile masked) atomically.
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: PartnerRepository,
    private readonly audit: AuditAppender,
  ) {}

  async list(
    query: ListPartnersQuery,
    ctx: PartnerActorContext,
  ): Promise<{ data: PartnerView[]; pagination: PaginationMeta }> {
    const scope = this.scopeOf(ctx);
    const [rows, total] = await Promise.all([
      this.repo.list(ctx.orgId, query.filter, scope, query.sort, query.page, query.limit),
      this.repo.count(ctx.orgId, query.filter, scope),
    ]);
    return {
      data: rows.map(toView),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  async create(dto: CreatePartnerDto, ctx: PartnerActorContext): Promise<CreatePartnerView> {
    try {
      const row = await this.uow.run(async (tx) => {
        const created = await this.repo.create(
          {
            partner_id: randomUUID(),
            org_id: ctx.orgId,
            partner_code: dto.partnerCode,
            type: dto.type,
            legal_name: dto.legalName,
            branch_id: dto.branchId ?? null,
            products: dto.products ?? [],
            contact_person: dto.contactPerson ?? null,
            contact_mobile: dto.contactMobile ?? null,
            agreement_ref: dto.agreementRef ?? null,
            commission_flag: dto.commissionFlag ?? false,
            mapped_rm_id: dto.mappedRmId ?? null,
            risk_category: dto.riskCategory ?? null,
            valid_until: dto.validUntil ?? null,
            actor_id: ctx.userId,
          },
          tx,
        );
        await this.audit.append(
          {
            action: AuditAction.CONFIG_CHANGE,
            entity_type: PARTNER_RESOURCE_TYPE,
            entity_id: created.partner_id,
            actor_id: ctx.userId,
            org_id: ctx.orgId,
            detail: { event: 'partner_created', after: sanitize(created) },
          },
          tx,
        );
        return created;
      });
      return {
        partnerId: row.partner_id,
        partnerCode: row.partner_code,
        type: row.type,
        legalName: row.legal_name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: { reason: `partner_code ${dto.partnerCode} already exists for this organisation.` },
        });
      }
      throw err;
    }
  }

  async update(
    partnerId: string,
    dto: UpdatePartnerDto,
    ctx: PartnerActorContext,
  ): Promise<UpdatePartnerView> {
    const current = await this.repo.findById(partnerId, ctx.orgId);
    if (!current || !this.inScope(current, ctx)) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const statusChanging = dto.status !== undefined && dto.status !== current.status;
    if (statusChanging) {
      if (!PARTNER_STATUS_ADMIN_ROLES.has(ctx.role)) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
      const allowed = PARTNER_STATUS_TRANSITIONS[current.status as PartnerStatus];
      if (!allowed.has(dto.status as PartnerStatus)) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
          fields: [
            { field: 'status', issue: `Transition from '${current.status}' to '${dto.status}' is not permitted.` },
          ],
        });
      }
    }

    const changes = toChanges(dto, statusChanging);
    const updated = await this.uow.run(async (tx) => {
      const row = await this.repo.update(partnerId, ctx.orgId, changes, ctx.userId, tx);
      if (!row) throw new DomainException(ERROR_CODES.NOT_FOUND);
      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: PARTNER_RESOURCE_TYPE,
          entity_id: partnerId,
          actor_id: ctx.userId,
          org_id: ctx.orgId,
          detail: {
            event: statusChanging ? 'partner_status_changed' : 'partner_updated',
            before: sanitize(current),
            after: sanitize(row),
            ...(dto.statusReason ? { reason: dto.statusReason } : {}),
          },
        },
        tx,
      );
      return row;
    });

    return {
      partnerId: updated.partner_id,
      partnerCode: updated.partner_code,
      status: updated.status,
      updatedAt: updated.updated_at,
    };
  }

  private scopeOf(ctx: PartnerActorContext): PartnerScope {
    // BM (scope B) sees in-branch + org-wide partners; ADMIN/HEAD (scope A) see all.
    return ctx.predicate?.type === 'branch' ? { branchId: ctx.predicate.branchId } : {};
  }

  private inScope(partner: PartnerRow, ctx: PartnerActorContext): boolean {
    if (ctx.predicate?.type !== 'branch') return true; // ADMIN/HEAD: org-wide
    return partner.branch_id === null || partner.branch_id === ctx.predicate.branchId;
  }
}

/** Map a `partners` row to the wire view (contact_mobile masked). */
function toView(row: PartnerRow): PartnerView {
  return {
    partnerId: row.partner_id,
    partnerCode: row.partner_code,
    type: row.type,
    legalName: row.legal_name,
    branchId: row.branch_id,
    products: Array.isArray(row.products) ? (row.products as string[]) : [],
    contactPerson: row.contact_person,
    contactMobile: maskMobile(row.contact_mobile),
    status: row.status,
    agreementRef: row.agreement_ref,
    commissionFlag: row.commission_flag,
    mappedRmId: row.mapped_rm_id,
    riskCategory: row.risk_category,
    qualityScore: row.quality_score,
    validUntil: row.valid_until ? String(row.valid_until) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Build the column-named change set from the (validated) update DTO. */
function toChanges(dto: UpdatePartnerDto, statusChanging: boolean): PartnerChanges {
  const c: PartnerChanges = {};
  if (dto.legalName !== undefined) c.legal_name = dto.legalName;
  if (dto.branchId !== undefined) c.branch_id = dto.branchId;
  if (dto.products !== undefined) c.products = JSON.stringify(dto.products);
  if (dto.contactPerson !== undefined) c.contact_person = dto.contactPerson;
  if (dto.contactMobile !== undefined) c.contact_mobile = dto.contactMobile;
  if (dto.agreementRef !== undefined) c.agreement_ref = dto.agreementRef;
  if (dto.commissionFlag !== undefined) c.commission_flag = dto.commissionFlag;
  if (dto.mappedRmId !== undefined) c.mapped_rm_id = dto.mappedRmId;
  if (dto.riskCategory !== undefined) c.risk_category = dto.riskCategory;
  if (dto.validUntil !== undefined) c.valid_until = dto.validUntil;
  if (statusChanging && dto.status !== undefined) c.status = dto.status;
  return c;
}

/** Mask a 10-digit mobile to `98xxxxxx10`; never write/return raw PII. */
function maskMobile(mobile: string | null): string | null {
  if (!mobile || mobile.length !== 10) return mobile;
  return `${mobile.slice(0, 2)}xxxxxx${mobile.slice(8)}`;
}

/** Audit-safe partner snapshot — contact_mobile masked, no raw PII in the chain. */
function sanitize(row: PartnerRow): Record<string, unknown> {
  return {
    partner_code: row.partner_code,
    type: row.type,
    legal_name: row.legal_name,
    status: row.status,
    branch_id: row.branch_id,
    risk_category: row.risk_category,
    contact_mobile: maskMobile(row.contact_mobile),
  };
}
