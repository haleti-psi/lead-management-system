import { Injectable } from '@nestjs/common';

import { AuditAction, ConfigStatus, DataScope, ERROR_CODES, EventCode } from '@lms/shared';
import type { PaginationMeta } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { CreateProductConfigDto } from './dto/create-product-config.dto';
import { toListParams, type ListProductConfigsQueryDto } from './dto/list-product-configs.dto';
import type { UpdateProductConfigDto } from './dto/update-product-config.dto';
import { EligibilityMappingSchema, FieldSchemaSchema } from './dto/product-config-schema';
import {
  PRODUCT_CONFIG_AGGREGATE_TYPE,
  PRODUCT_CONFIG_ENTITY_TYPE,
} from './product-config.constants';
import {
  ProductConfigRepository,
  type ProductConfigListRow,
  type ProductConfigRow,
  type ProductConfigWriteFields,
} from './product-config.repository';

export interface ListProductConfigsResult {
  data: ProductConfigListRow[];
  pagination: PaginationMeta;
}

export interface CreateProductConfigResult {
  product_config_id: string;
  version: number;
  status: ConfigStatus;
  configuration_version_id: string;
  config_version_status: 'pending';
}

export interface EditProductConfigResult extends CreateProductConfigResult {
  based_on_version: number;
}

export interface RetireProductConfigResult {
  product_config_id: string;
  status: ConfigStatus;
}

/** Result discriminator: a PATCH is either an edit-to-new-draft or a retire. */
export type UpdateProductConfigResult = EditProductConfigResult | RetireProductConfigResult;

/**
 * FR-040 — product-configuration administration (M5). Operations:
 *
 *  - {@link list} / {@link get}: paginated + single reads of `product_configs`.
 *  - {@link createDraft}: maker step — in ONE {@link UnitOfWork} transaction it
 *    inserts the config as `draft` (next `version` for the product_code), the
 *    paired `configuration_versions(status='pending')`, an `audit_logs(config_change)`
 *    intent, and a `CONFIG_CHANGED` outbox event.
 *  - {@link editActive}: maker step on an ACTIVE config — never mutates the live
 *    row; creates a new `draft` row + pending version (immutability invariant).
 *  - {@link retire}: status-only retire of an ACTIVE config (in-flight leads keep
 *    their pinned row).
 *
 * Activation is NOT here: approving the pending version through FR-132
 * (`POST /admin/config/{id}/approve`) resolves this module's `product_config`
 * activator, which flips the draft to `active`. FR-040 adds no approve endpoint.
 *
 * Authorisation: the `configuration` capability is enforced upstream by
 * `AbacGuard`. `product_configs` is org-wide config (auth-matrix `scoped:false`),
 * so every mutation additionally requires effective scope `A` (ADMIN/HEAD); a
 * scope-B holder (BM/KYC/DPO) is rejected with FORBIDDEN — mirroring FR-104/FR-132.
 */
@Injectable()
export class ProductConfigService {
  constructor(
    private readonly repo: ProductConfigRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListProductConfigsQueryDto): Promise<ListProductConfigsResult> {
    const params = toListParams(query);
    const filters = { status: params.status, product_code: params.product_code };
    const pagination = {
      page: query.page,
      limit: query.limit,
      sort: params.sort,
      direction: params.direction,
    };
    const [rows, total] = await Promise.all([
      this.repo.list(filters, pagination),
      this.repo.count(filters),
    ]);
    return { data: rows, pagination: { page: query.page, limit: query.limit, total } };
  }

  /** Full single config; NOT_FOUND when absent or owned by another org. */
  async get(id: string): Promise<ProductConfigRow> {
    const row = await this.repo.findById(id);
    if (row == null) throw new DomainException(ERROR_CODES.NOT_FOUND);
    return row;
  }

  async createDraft(
    dto: CreateProductConfigDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<CreateProductConfigResult> {
    this.requireScopeA(effectiveScope);

    return this.uow.run(async (tx) => {
      const version = (await this.repo.maxVersion(dto.product_code, tx)) + 1;

      const fields: ProductConfigWriteFields = {
        product_code: dto.product_code,
        name: dto.name,
        field_schema: dto.field_schema,
        document_checklist: dto.document_checklist,
        sla_config: dto.sla_config ?? null,
        eligibility_mapping: dto.eligibility_mapping ?? null,
        pan_required_at: dto.pan_required_at,
      };

      const inserted = await this.repo.insertDraft(fields, version, actor.userId, tx);
      const diff = {
        action: 'create' as const,
        product_code: dto.product_code,
        changed_keys: Object.keys(dto),
        eligibility_mapping_changed: dto.eligibility_mapping != null,
      };
      const configurationVersionId = await this.repo.insertConfigVersion(
        inserted.product_config_id,
        version,
        diff,
        actor.userId,
        tx,
      );

      await this.appendAudit('create', inserted.product_config_id, dto.product_code, version, actor.userId, tx);
      await this.emitChanged(inserted.product_config_id, dto.product_code, version, ConfigStatus.DRAFT, actor.userId, tx);

      return {
        product_config_id: inserted.product_config_id,
        version,
        status: ConfigStatus.DRAFT,
        configuration_version_id: configurationVersionId,
        config_version_status: 'pending',
      };
    });
  }

  /**
   * PATCH dispatcher. `status:'retired'` routes to {@link retire}; otherwise an
   * edit-of-active produces a new draft version. Existence/scope are checked
   * before opening a transaction so a NOT_FOUND/FORBIDDEN does no DB work.
   */
  async update(
    id: string,
    dto: UpdateProductConfigDto,
    actor: AuthUser,
    effectiveScope: DataScope | undefined,
  ): Promise<UpdateProductConfigResult> {
    this.requireScopeA(effectiveScope);
    if (dto.status === ConfigStatus.RETIRED) {
      return this.retire(id, actor);
    }
    return this.editActive(id, dto, actor);
  }

  /**
   * Edit an ACTIVE config: read it, overlay the partial update, insert a NEW
   * `draft` row at `version+1` + a pending version. The live row is never mutated
   * (immutability invariant). CONFLICT when the target is not active; NOT_FOUND
   * when absent/another org.
   */
  private async editActive(
    id: string,
    dto: UpdateProductConfigDto,
    actor: AuthUser,
  ): Promise<EditProductConfigResult> {
    return this.uow.run(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (existing == null) throw new DomainException(ERROR_CODES.NOT_FOUND);
      if (existing.status !== ConfigStatus.ACTIVE) throw new DomainException(ERROR_CODES.CONFLICT);

      const merged = mergeConfigFields(existing, dto);

      // Cross-validate eligibility_mapping against the MERGED field_schema (the
      // submitted schema if present, else the existing one). The DTO already
      // checked it when a field_schema was submitted; this covers the case where
      // only eligibility_mapping changed against the existing schema.
      this.validateMergedEligibility(merged.field_schema, merged.eligibility_mapping);

      const newVersion = existing.version + 1;
      const inserted = await this.repo.insertDraft(merged, newVersion, actor.userId, tx);

      const changedKeys = Object.keys(dto).filter((k) => k !== 'status');
      const diff = {
        action: 'update' as const,
        product_code: existing.product_code,
        based_on_version: existing.version,
        changed_keys: changedKeys,
        eligibility_mapping_changed: dto.eligibility_mapping != null,
      };
      const configurationVersionId = await this.repo.insertConfigVersion(
        inserted.product_config_id,
        newVersion,
        diff,
        actor.userId,
        tx,
      );

      await this.appendAudit('update', inserted.product_config_id, existing.product_code, newVersion, actor.userId, tx);
      await this.emitChanged(
        inserted.product_config_id,
        existing.product_code,
        newVersion,
        ConfigStatus.DRAFT,
        actor.userId,
        tx,
      );

      return {
        product_config_id: inserted.product_config_id,
        version: newVersion,
        status: ConfigStatus.DRAFT,
        based_on_version: existing.version,
        configuration_version_id: configurationVersionId,
        config_version_status: 'pending',
      };
    });
  }

  /**
   * Status-only retire of an ACTIVE config. In-flight leads pinned to this
   * `product_config_id` are unaffected (no `leads` write; the FK stays valid).
   * CONFLICT when the row is not active; NOT_FOUND when absent/another org.
   */
  private async retire(id: string, actor: AuthUser): Promise<RetireProductConfigResult> {
    return this.uow.run(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (existing == null) throw new DomainException(ERROR_CODES.NOT_FOUND);
      if (existing.status !== ConfigStatus.ACTIVE) throw new DomainException(ERROR_CODES.CONFLICT);

      const updated = await this.repo.retireActive(id, actor.userId, tx);
      if (updated === 0) throw new DomainException(ERROR_CODES.CONFLICT);

      await this.appendAudit('retire', id, existing.product_code, existing.version, actor.userId, tx);
      await this.emitChanged(id, existing.product_code, existing.version, ConfigStatus.RETIRED, actor.userId, tx);

      return { product_config_id: id, status: ConfigStatus.RETIRED };
    });
  }

  /** Org-wide config write requires scope A; BM/KYC/DPO (scope B) are blocked. */
  private requireScopeA(effectiveScope: DataScope | undefined): void {
    if (effectiveScope !== DataScope.A) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  /**
   * Service-layer guard for a partial edit: every
   * `eligibility_mapping.fields[*].lms_field` must be a declared
   * `field_schema.groups[*].fields[*].key`. Inputs are JSONB cells from the merged
   * row (already structurally valid — either Zod-checked DTO values or rows the
   * Create path validated), so they are parsed through the canonical Zod schemas
   * to recover types without an unchecked cast; a parse miss is treated as "no
   * mapping to check". Throws VALIDATION_ERROR with the offending mapping-row path.
   */
  private validateMergedEligibility(fieldSchema: unknown, eligibilityMapping: unknown): void {
    const mapping = EligibilityMappingSchema.safeParse(eligibilityMapping);
    if (!mapping.success || mapping.data.fields.length === 0) return;
    const schema = FieldSchemaSchema.safeParse(fieldSchema);
    if (!schema.success) return;

    const declaredKeys = new Set<string>();
    for (const group of schema.data.groups) {
      for (const field of group.fields) declaredKeys.add(field.key);
    }
    const fields = mapping.data.fields
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => !declaredKeys.has(m.lms_field))
      .map(({ m, index }) => ({
        field: `eligibility_mapping.fields[${index}].lms_field`,
        issue: `'${m.lms_field}' not declared in field_schema`,
      }));
    if (fields.length > 0) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, { fields });
    }
  }

  private async appendAudit(
    operation: 'create' | 'update' | 'retire',
    productConfigId: string,
    productCode: string,
    version: number,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await this.audit.append(
      {
        action: AuditAction.CONFIG_CHANGE,
        entity_type: PRODUCT_CONFIG_ENTITY_TYPE,
        entity_id: productConfigId,
        actor_id: actorId,
        org_id: ORG_ID_DEFAULT,
        detail: { operation, product_code: productCode, version },
      },
      tx,
    );
  }

  private async emitChanged(
    productConfigId: string,
    productCode: string,
    version: number,
    status: ConfigStatus,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await this.outbox.emit(
      {
        event_code: EventCode.CONFIG_CHANGED,
        aggregate_type: PRODUCT_CONFIG_AGGREGATE_TYPE,
        aggregate_id: productConfigId,
        payload: { product_code: productCode, version, status, changed_by: actorId },
      },
      tx,
    );
  }
}

/**
 * Overlay a partial {@link UpdateProductConfigDto} onto the existing row, yielding
 * the full write-field set for the new draft. Pure: JSONB columns come back from
 * the DB already parsed (Kysely `Json`), so unchanged ones pass through as-is and
 * the repository re-serialises. `status` is not a config field (handled upstream).
 */
export function mergeConfigFields(
  existing: ProductConfigRow,
  dto: UpdateProductConfigDto,
): ProductConfigWriteFields {
  return {
    product_code: existing.product_code,
    name: dto.name ?? existing.name,
    field_schema: dto.field_schema ?? existing.field_schema,
    document_checklist: dto.document_checklist ?? existing.document_checklist,
    sla_config: dto.sla_config ?? existing.sla_config ?? null,
    eligibility_mapping: dto.eligibility_mapping ?? existing.eligibility_mapping ?? null,
    pan_required_at: dto.pan_required_at ?? existing.pan_required_at,
  };
}
