import { ERROR_CODES } from '@lms/shared';
import type { CommChannel, Lang } from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../../../core/db';
import { DomainException } from '../../../core/http';
import { ORG_ID_DEFAULT } from '../../../core/outbox/outbox.constants';
import { TERMINAL_LEAD_STAGES } from '../admin.constants';
import { CreateBranchDto, PatchBranchDto } from './dto/branch.dto';
import {
  CreateBusinessCalendarDto,
  PatchBusinessCalendarDto,
} from './dto/business-calendar.dto';
import {
  CreateCommunicationTemplateDto,
  PatchCommunicationTemplateDto,
} from './dto/communication-template.dto';
import { CreateRegionDto, PatchRegionDto } from './dto/region.dto';
import {
  CreateRejectionReasonDto,
  PatchRejectionReasonDto,
} from './dto/rejection-reason.dto';
import {
  CreateRetentionPolicyDto,
  PatchRetentionPolicyDto,
} from './dto/retention-policy.dto';
import type {
  ListArgs,
  MasterListPage,
  MasterRecordView,
  MasterResourceDescriptor,
} from './master-resource.types';

/** Active partner/template/dla status value (the "live" `config_status`/`partner_status`). */
const STATUS_ACTIVE = 'active';

/** Serialise a JS value for a JSONB insert/update column (null passes through). */
function asJson(value: unknown): string | null {
  return value != null ? JSON.stringify(value) : null;
}

// ───────────────────────── regions (global, no activeness) ─────────────────────────

class RegionDescriptor implements MasterResourceDescriptor {
  readonly slug = 'regions';
  readonly configType = 'region';
  readonly entityType = 'region';
  readonly scopeModel = 'global' as const;
  readonly activenessModel = 'none' as const;
  readonly createSchema = CreateRegionDto;
  readonly patchSchema = PatchRegionDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    const rows = await executor
      .selectFrom('regions')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .orderBy('created_at', 'desc')
      .limit(args.limit)
      .offset((args.page - 1) * args.limit)
      .execute();
    const { count } = await executor
      .selectFrom('regions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirstOrThrow();
    return { rows: rows.map(toRegionView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor
      .selectFrom('regions')
      .selectAll()
      .where('region_id', '=', id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
    return row != null ? toRegionView(row) : undefined;
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateRegionDto;
    const row = await tx
      .insertInto('regions')
      .values({ org_id: ORG_ID_DEFAULT, code: dto.code, name: dto.name, created_by: actorId, updated_by: actorId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRegionView(row), version: 1, diff: { op: 'create', after: { code: dto.code, name: dto.name } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchRegionDto;
    const row = await tx
      .updateTable('regions')
      .set({ ...(dto.code != null && { code: dto.code }), ...(dto.name != null && { name: dto.name }), updated_by: actorId, updated_at: new Date() })
      .where('region_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRegionView(row), version: 1, diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(): Promise<void> {
    // regions cannot be deactivated (no activeness column); never reached.
  }
}

function toRegionView(row: { region_id: string; code: string; name: string; created_at: Date; updated_at: Date }): MasterRecordView {
  return {
    id: row.region_id,
    regionId: row.region_id,
    code: row.code,
    name: row.name,
    isActive: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ───────────────────────── branches (branch-scoped, is_active) ─────────────────────────

class BranchDescriptor implements MasterResourceDescriptor {
  readonly slug = 'branches';
  readonly configType = 'branch';
  readonly entityType = 'branch';
  readonly scopeModel = 'branch' as const;
  readonly activenessModel = 'boolean' as const;
  readonly createSchema = CreateBranchDto;
  readonly patchSchema = PatchBranchDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    let q = executor.selectFrom('branches').selectAll().where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) q = q.where('is_active', '=', args.isActive);
    const rows = await q.orderBy('created_at', 'desc').limit(args.limit).offset((args.page - 1) * args.limit).execute();

    let c = executor.selectFrom('branches').select((eb) => eb.fn.countAll<string>().as('count')).where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) c = c.where('is_active', '=', args.isActive);
    const { count } = await c.executeTakeFirstOrThrow();
    return { rows: rows.map(toBranchView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor.selectFrom('branches').selectAll().where('branch_id', '=', id).where('org_id', '=', ORG_ID_DEFAULT).executeTakeFirst();
    return row != null ? toBranchView(row) : undefined;
  }

  async validateReferences(executor: DbTransaction, body: unknown): Promise<void> {
    const dto = body as Partial<CreateBranchDto>;
    if (dto.regionId == null) return;
    const region = await executor
      .selectFrom('regions')
      .select('region_id')
      .where('region_id', '=', dto.regionId)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .executeTakeFirst();
    if (region == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'regionId', issue: 'regionId must reference an active region.' }],
      });
    }
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateBranchDto;
    const row = await tx
      .insertInto('branches')
      .values({
        org_id: ORG_ID_DEFAULT,
        code: dto.code,
        name: dto.name,
        region_id: dto.regionId,
        pin_codes: asJson(dto.pinCodes),
        address: dto.address ?? null,
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toBranchView(row), version: 1, diff: { op: 'create', after: { code: dto.code, region_id: dto.regionId } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchBranchDto;
    const row = await tx
      .updateTable('branches')
      .set({
        ...(dto.code != null && { code: dto.code }),
        ...(dto.name != null && { name: dto.name }),
        ...(dto.regionId != null && { region_id: dto.regionId }),
        ...(dto.pinCodes != null && { pin_codes: asJson(dto.pinCodes) }),
        ...(dto.address != null && { address: dto.address }),
        ...(dto.isActive != null && { is_active: dto.isActive }),
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('branch_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toBranchView(row), version: 1, diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(executor: DbTransaction, record: MasterRecordView): Promise<void> {
    // A branch with active users cannot be deactivated (schema 3.4 fk_users_branch_id).
    const { count } = await executor
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('branch_id', '=', record.id)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    if (Number(count) > 0) {
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
        detail: { reason: 'Resource is referenced by active records and cannot be deactivated.' },
      });
    }
  }
}

function toBranchView(row: {
  branch_id: string; code: string; name: string; region_id: string; pin_codes: unknown; address: string | null; is_active: boolean; created_at: Date; updated_at: Date;
}): MasterRecordView {
  return {
    id: row.branch_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    regionId: row.region_id,
    pinCodes: row.pin_codes ?? null,
    address: row.address,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ───────────────────────── rejection_reasons (global, is_active) ─────────────────────────

class RejectionReasonDescriptor implements MasterResourceDescriptor {
  readonly slug = 'rejection-reasons';
  readonly configType = 'rejection_reason';
  readonly entityType = 'rejection_reason';
  readonly scopeModel = 'global' as const;
  readonly activenessModel = 'boolean' as const;
  readonly createSchema = CreateRejectionReasonDto;
  readonly patchSchema = PatchRejectionReasonDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    let q = executor.selectFrom('rejection_reasons').selectAll().where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) q = q.where('is_active', '=', args.isActive);
    const rows = await q.orderBy('created_at', 'desc').limit(args.limit).offset((args.page - 1) * args.limit).execute();
    let c = executor.selectFrom('rejection_reasons').select((eb) => eb.fn.countAll<string>().as('count')).where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) c = c.where('is_active', '=', args.isActive);
    const { count } = await c.executeTakeFirstOrThrow();
    return { rows: rows.map(toRejectionView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor.selectFrom('rejection_reasons').selectAll().where('rejection_reason_id', '=', id).where('org_id', '=', ORG_ID_DEFAULT).executeTakeFirst();
    return row != null ? toRejectionView(row) : undefined;
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateRejectionReasonDto;
    const row = await tx
      .insertInto('rejection_reasons')
      .values({
        org_id: ORG_ID_DEFAULT,
        primary_reason: dto.primaryReason,
        sub_reason: dto.subReason ?? null,
        requires_remarks: dto.requiresRemarks ?? false,
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRejectionView(row), version: 1, diff: { op: 'create', after: { primary_reason: dto.primaryReason } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchRejectionReasonDto;
    const row = await tx
      .updateTable('rejection_reasons')
      .set({
        ...(dto.primaryReason != null && { primary_reason: dto.primaryReason }),
        ...(dto.subReason != null && { sub_reason: dto.subReason }),
        ...(dto.requiresRemarks != null && { requires_remarks: dto.requiresRemarks }),
        ...(dto.isActive != null && { is_active: dto.isActive }),
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('rejection_reason_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRejectionView(row), version: 1, diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(executor: DbTransaction, record: MasterRecordView): Promise<void> {
    // Blocked while any non-terminal lead still references this reason (LLD §In-use).
    const { count } = await executor
      .selectFrom('leads')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('rejection_reason_id', '=', record.id)
      .where('stage', 'not in', [...TERMINAL_LEAD_STAGES])
      .executeTakeFirstOrThrow();
    if (Number(count) > 0) {
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
        detail: { reason: 'Resource is referenced by active records and cannot be deactivated.' },
      });
    }
  }
}

function toRejectionView(row: {
  rejection_reason_id: string; primary_reason: string; sub_reason: string | null; requires_remarks: boolean; is_active: boolean; created_at: Date; updated_at: Date;
}): MasterRecordView {
  return {
    id: row.rejection_reason_id,
    rejectionReasonId: row.rejection_reason_id,
    primaryReason: row.primary_reason,
    subReason: row.sub_reason,
    requiresRemarks: row.requires_remarks,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ───────────────────────── business_calendars (branch-scoped, is_active) ─────────────────────────

class BusinessCalendarDescriptor implements MasterResourceDescriptor {
  readonly slug = 'business-calendars';
  readonly configType = 'business_calendar';
  readonly entityType = 'business_calendar';
  readonly scopeModel = 'branch' as const;
  readonly activenessModel = 'boolean' as const;
  readonly createSchema = CreateBusinessCalendarDto;
  readonly patchSchema = PatchBusinessCalendarDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    let q = executor.selectFrom('business_calendars').selectAll().where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) q = q.where('is_active', '=', args.isActive);
    const rows = await q.orderBy('created_at', 'desc').limit(args.limit).offset((args.page - 1) * args.limit).execute();
    let c = executor.selectFrom('business_calendars').select((eb) => eb.fn.countAll<string>().as('count')).where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) c = c.where('is_active', '=', args.isActive);
    const { count } = await c.executeTakeFirstOrThrow();
    return { rows: rows.map(toCalendarView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor.selectFrom('business_calendars').selectAll().where('business_calendar_id', '=', id).where('org_id', '=', ORG_ID_DEFAULT).executeTakeFirst();
    return row != null ? toCalendarView(row) : undefined;
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateBusinessCalendarDto;
    const row = await tx
      .insertInto('business_calendars')
      .values({
        org_id: ORG_ID_DEFAULT,
        code: dto.code,
        name: dto.name,
        ...(dto.timezone != null && { timezone: dto.timezone }),
        branch_id: dto.branchId ?? null,
        region_id: dto.regionId ?? null,
        working_hours: JSON.stringify(dto.workingHours),
        holidays: asJson(dto.holidays),
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toCalendarView(row), version: 1, diff: { op: 'create', after: { code: dto.code } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchBusinessCalendarDto;
    const row = await tx
      .updateTable('business_calendars')
      .set({
        ...(dto.code != null && { code: dto.code }),
        ...(dto.name != null && { name: dto.name }),
        ...(dto.timezone != null && { timezone: dto.timezone }),
        ...(dto.branchId != null && { branch_id: dto.branchId }),
        ...(dto.regionId != null && { region_id: dto.regionId }),
        ...(dto.workingHours != null && { working_hours: JSON.stringify(dto.workingHours) }),
        ...(dto.holidays != null && { holidays: asJson(dto.holidays) }),
        ...(dto.isActive != null && { is_active: dto.isActive }),
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('business_calendar_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toCalendarView(row), version: 1, diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(): Promise<void> {
    // No hard FK to a calendar; the SlaEngine reads the active default at compute
    // time, so a deactivated calendar simply stops being selected (LLD §In-use).
  }
}

function toCalendarView(row: {
  business_calendar_id: string; code: string; name: string; timezone: string; branch_id: string | null; region_id: string | null; working_hours: unknown; holidays: unknown; is_active: boolean; created_at: Date; updated_at: Date;
}): MasterRecordView {
  return {
    id: row.business_calendar_id,
    businessCalendarId: row.business_calendar_id,
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    branchId: row.branch_id,
    regionId: row.region_id,
    workingHours: row.working_hours,
    holidays: row.holidays ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ───────────────────────── retention_policies (global, is_active + legal_hold) ─────────────────────────

class RetentionPolicyDescriptor implements MasterResourceDescriptor {
  readonly slug = 'retention-policies';
  readonly configType = 'retention_policy';
  readonly entityType = 'retention_policy';
  readonly scopeModel = 'global' as const;
  readonly activenessModel = 'boolean' as const;
  readonly createSchema = CreateRetentionPolicyDto;
  readonly patchSchema = PatchRetentionPolicyDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    let q = executor.selectFrom('retention_policies').selectAll().where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) q = q.where('is_active', '=', args.isActive);
    const rows = await q.orderBy('created_at', 'desc').limit(args.limit).offset((args.page - 1) * args.limit).execute();
    let c = executor.selectFrom('retention_policies').select((eb) => eb.fn.countAll<string>().as('count')).where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) c = c.where('is_active', '=', args.isActive);
    const { count } = await c.executeTakeFirstOrThrow();
    return { rows: rows.map(toRetentionView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor.selectFrom('retention_policies').selectAll().where('retention_policy_id', '=', id).where('org_id', '=', ORG_ID_DEFAULT).executeTakeFirst();
    return row != null ? toRetentionView(row) : undefined;
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateRetentionPolicyDto;
    const row = await tx
      .insertInto('retention_policies')
      .values({
        org_id: ORG_ID_DEFAULT,
        data_category: dto.dataCategory,
        lead_outcome: dto.leadOutcome ?? null,
        retain_days: dto.retainDays,
        action: dto.action,
        legal_hold: dto.legalHold ?? false,
        is_active: true,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRetentionView(row), version: 1, diff: { op: 'create', after: { data_category: dto.dataCategory, action: dto.action } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchRetentionPolicyDto;
    const row = await tx
      .updateTable('retention_policies')
      .set({
        ...(dto.dataCategory != null && { data_category: dto.dataCategory }),
        ...(dto.leadOutcome != null && { lead_outcome: dto.leadOutcome }),
        ...(dto.retainDays != null && { retain_days: dto.retainDays }),
        ...(dto.action != null && { action: dto.action }),
        ...(dto.legalHold != null && { legal_hold: dto.legalHold }),
        ...(dto.isActive != null && { is_active: dto.isActive }),
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('retention_policy_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toRetentionView(row), version: 1, diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(_executor: DbTransaction, record: MasterRecordView): Promise<void> {
    // A policy under legal hold can never be deactivated (LLD: CONFLICT + LEGAL_HOLD).
    if (record.legalHold === true) {
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, { detail: { reason: 'LEGAL_HOLD' } });
    }
  }
}

function toRetentionView(row: {
  retention_policy_id: string; data_category: string; lead_outcome: string | null; retain_days: number; action: string; legal_hold: boolean; is_active: boolean; created_at: Date; updated_at: Date;
}): MasterRecordView {
  return {
    id: row.retention_policy_id,
    retentionPolicyId: row.retention_policy_id,
    dataCategory: row.data_category,
    leadOutcome: row.lead_outcome,
    retainDays: row.retain_days,
    action: row.action,
    legalHold: row.legal_hold,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ───────────────────────── communication_templates (global, status enum, versioned) ─────────────────────────

class CommunicationTemplateDescriptor implements MasterResourceDescriptor {
  readonly slug = 'communication-templates';
  readonly configType = 'communication_template';
  readonly entityType = 'communication_template';
  readonly scopeModel = 'global' as const;
  readonly activenessModel = 'status' as const;
  readonly createSchema = CreateCommunicationTemplateDto;
  readonly patchSchema = PatchCommunicationTemplateDto;

  async list(executor: KyselyDb, args: ListArgs): Promise<MasterListPage> {
    let q = executor.selectFrom('communication_templates').selectAll().where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) q = args.isActive ? q.where('status', '=', STATUS_ACTIVE) : q.where('status', '!=', STATUS_ACTIVE);
    const rows = await q.orderBy('created_at', 'desc').limit(args.limit).offset((args.page - 1) * args.limit).execute();
    let c = executor.selectFrom('communication_templates').select((eb) => eb.fn.countAll<string>().as('count')).where('org_id', '=', ORG_ID_DEFAULT);
    if (args.isActive !== undefined) c = args.isActive ? c.where('status', '=', STATUS_ACTIVE) : c.where('status', '!=', STATUS_ACTIVE);
    const { count } = await c.executeTakeFirstOrThrow();
    return { rows: rows.map(toTemplateView), total: Number(count) };
  }

  async findById(executor: KyselyDb | DbTransaction, id: string): Promise<MasterRecordView | undefined> {
    const row = await executor.selectFrom('communication_templates').selectAll().where('template_id', '=', id).where('org_id', '=', ORG_ID_DEFAULT).executeTakeFirst();
    return row != null ? toTemplateView(row) : undefined;
  }

  /** Next version for (org, code, channel, language); 0 ⇒ first version = 1. */
  private async nextVersion(
    tx: DbTransaction,
    code: string,
    channel: CommChannel,
    language: Lang,
  ): Promise<number> {
    const row = await tx
      .selectFrom('communication_templates')
      .select((eb) => eb.fn.max('version').as('max_v'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('code', '=', code)
      .where('channel', '=', channel)
      .where('language', '=', language)
      .executeTakeFirst();
    return Number(row?.max_v ?? 0) + 1;
  }

  async insert(tx: DbTransaction, body: unknown, actorId: string) {
    const dto = body as CreateCommunicationTemplateDto;
    const version = await this.nextVersion(tx, dto.code, dto.channel, dto.language);
    const row = await tx
      .insertInto('communication_templates')
      .values({
        org_id: ORG_ID_DEFAULT,
        code: dto.code,
        version,
        channel: dto.channel,
        language: dto.language,
        category: dto.category,
        product_code: dto.productCode ?? null,
        body: dto.body,
        // Created active immediately (FR-131 LLD lifecycle); the paired
        // configuration_versions row is the audit/rollback record. No FR-132
        // activator exists for `communication_template`, so a 'draft' insert
        // would be stranded forever.
        status: STATUS_ACTIVE,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toTemplateView(row), version, diff: { op: 'create', after: { code: dto.code, channel: dto.channel, language: dto.language, version } } };
  }

  async update(tx: DbTransaction, existing: MasterRecordView, body: unknown, actorId: string) {
    const dto = body as PatchCommunicationTemplateDto;
    const row = await tx
      .updateTable('communication_templates')
      .set({
        ...(dto.body != null && { body: dto.body }),
        ...(dto.category != null && { category: dto.category }),
        ...(dto.productCode != null && { product_code: dto.productCode }),
        ...(dto.status != null && { status: dto.status }),
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('template_id', '=', existing.id)
      .where('org_id', '=', ORG_ID_DEFAULT)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { record: toTemplateView(row), version: Number(existing.version), diff: { op: 'update', changed: Object.keys(dto) } };
  }

  async assertNotInUse(executor: DbTransaction, record: MasterRecordView): Promise<void> {
    // Block retiring a template with in-flight (queued/sent-not-delivered) sends.
    const { count } = await executor
      .selectFrom('communication_logs')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('template_id', '=', record.id)
      .where('status', 'in', ['queued', 'sent'])
      .executeTakeFirstOrThrow();
    if (Number(count) > 0) {
      throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
        detail: { reason: 'Resource is referenced by active records and cannot be deactivated.' },
      });
    }
  }
}

function toTemplateView(row: {
  template_id: string; code: string; version: number; channel: string; language: string; category: string; product_code: string | null; body: string; status: string; created_at: Date; updated_at: Date;
}): MasterRecordView {
  return {
    id: row.template_id,
    templateId: row.template_id,
    code: row.code,
    version: row.version,
    channel: row.channel,
    language: row.language,
    category: row.category,
    productCode: row.product_code,
    body: row.body,
    status: row.status,
    isActive: row.status === STATUS_ACTIVE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The FR-131 allow-list. Every entry is a master resource with NO competing
 * concrete controller in another committed FR. Resources owned elsewhere are
 * deliberately absent (see master.constants.ts): users/roles/teams (FR-130),
 * product-configs (FR-040), sla-policies (FR-104), schemes (FR-042),
 * allocation-rules (FR-030), webhooks (FR-140), break-glass (FR-003),
 * dla-registry (FR-113 M12 — claimed out like allocation-rules/FR-030).
 *
 * NOTE: ownership of communication-templates/retention is pending cross-FR review
 * (M11/M12 may claim these); left here as-is. `partners` was removed (FR-090 /
 * M10 PartnerService is the sole owner) per cross-FR review H1.
 */
export const MASTER_DESCRIPTORS: readonly MasterResourceDescriptor[] = [
  new RegionDescriptor(),
  new BranchDescriptor(),
  new RejectionReasonDescriptor(),
  new BusinessCalendarDescriptor(),
  new RetentionPolicyDescriptor(),
  new CommunicationTemplateDescriptor(),
];
