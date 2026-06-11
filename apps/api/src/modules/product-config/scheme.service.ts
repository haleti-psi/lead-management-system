import { Injectable } from '@nestjs/common';

import { AuditAction, DataScope, ERROR_CODES, ProductCode } from '@lms/shared';
import type { PaginationMeta } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateSchemeDto } from './dto/create-scheme.dto';
import type { ListSchemesQueryDto } from './dto/list-schemes.dto';
import { SCHEME_ENTITY_TYPE } from './scheme.constants';
import {
  SchemeRepository,
  isUniqueViolation,
  type SchemeRow,
  type SchemeWriteFields,
} from './scheme.repository';

export interface ListSchemesResult {
  data: SchemeRow[];
  pagination: PaginationMeta;
}

/**
 * FR-042 — Scheme & Offer administration (M5). Operations:
 *
 *  - {@link list}: paginated read of `schemes` for the org.
 *  - {@link create}: scope-A creation — in ONE {@link UnitOfWork} transaction it
 *    inserts the scheme as immediately ACTIVE and appends an
 *    `audit_logs(config_change)` intent. There is NO maker-checker / config
 *    activator / outbox event: the `schemes` table has no governance columns, and
 *    the LLD (§Backend Flow A, §Transaction Boundaries) specifies an immediately
 *    active record. A duplicate `(org_id, code)` (`uq_schemes_code`) surfaces as
 *    CONFLICT.
 *  - {@link validateAndResolveScheme}: the FR-042-owned business rules for
 *    attaching a scheme to a lead (active, not expired, product-matched). The lead
 *    PATCH endpoint itself is owned by the lead-capture FR (FR-011/FR-050); this
 *    method is the shared validation it consumes.
 *
 * Authorisation: the `configuration` capability is enforced upstream by
 * `AbacGuard` (`@Requires`). Creation is an org-wide config write, so the service
 * additionally requires effective scope `A` (ADMIN/HEAD) — a scope-B holder
 * (BM/KYC/DPO) is rejected with FORBIDDEN, mirroring FR-040/FR-104/FR-132.
 */
@Injectable()
export class SchemeService {
  constructor(
    private readonly repo: SchemeRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
  ) {}

  async list(query: ListSchemesQueryDto): Promise<ListSchemesResult> {
    const filters = { product_code: query.product_code, is_active: query.is_active };
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
    dto: CreateSchemeDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<SchemeRow> {
    // Org-wide config write requires scope A (ADMIN/HEAD). BM/KYC/DPO hold the
    // `configuration` capability only at scope B and are blocked here.
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const fields: SchemeWriteFields = {
      code: dto.code,
      name: dto.name,
      product_code: dto.product_code ?? null,
      subvention_flag: dto.subvention_flag ?? false,
      valid_from: dto.valid_from,
      valid_to: dto.valid_to,
    };

    return this.uow.run(async (tx) => {
      let scheme: SchemeRow;
      try {
        scheme = await this.repo.insert(fields, actor.userId, tx);
      } catch (err) {
        // Duplicate (org_id, code) → CONFLICT (uq_schemes_code). Any other DB
        // fault propagates unchanged to the global filter (INTERNAL_ERROR).
        if (isUniqueViolation(err)) {
          throw new DomainException(ERROR_CODES.CONFLICT, undefined, { cause: err });
        }
        throw err;
      }

      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: SCHEME_ENTITY_TYPE,
          entity_id: scheme.scheme_id,
          actor_id: actor.userId,
          org_id: ORG_ID_DEFAULT,
          detail: { op: 'create', code: scheme.code, product_code: scheme.product_code },
        },
        tx,
      );

      return scheme;
    });
  }

  /**
   * FR-042 attach-to-lead business rules (LLD §3.3 / §Validation Logic). Resolves
   * the scheme by `code` for the org and asserts it is attachable to a lead of
   * `leadProductCode` as of `today` (a `YYYY-MM-DD` UTC date string). Throws
   * `VALIDATION_ERROR` (400) with `fields: [{ field: 'scheme_code', issue }]` for
   * every failure so the message maps to the picker field; returns the row on
   * success. Read-only — the caller (lead-capture FR) performs the LPD write.
   */
  async validateAndResolveScheme(
    schemeCode: string,
    leadProductCode: ProductCode,
    _orgId: string,
    today: string,
  ): Promise<SchemeRow> {
    const scheme = await this.repo.findByCode(schemeCode);

    if (scheme == null) {
      throw schemeFieldError('Scheme not found');
    }
    if (scheme.is_active === false) {
      throw schemeFieldError('Scheme is inactive');
    }
    if (toDateString(scheme.valid_to) < today) {
      throw schemeFieldError('Scheme has expired');
    }
    if (scheme.product_code !== null && scheme.product_code !== leadProductCode) {
      throw schemeFieldError('Scheme is not available for this product');
    }
    return scheme;
  }
}

/** VALIDATION_ERROR carrying a single `scheme_code` field issue (LLD §Validation). */
function schemeFieldError(issue: string): DomainException {
  return new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
    fields: [{ field: 'scheme_code', issue }],
  });
}

/**
 * Normalise a `DATE` column value to its `YYYY-MM-DD` string. The Kysely read type
 * is `Date`, but a unit caller may pass an ISO string directly; both are handled
 * so the comparison against the `today` string is exact (no time-of-day drift).
 */
function toDateString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
