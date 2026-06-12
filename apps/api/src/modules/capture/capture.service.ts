import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { sql } from 'kysely';

import {
  AuditAction,
  ConsentPurpose,
  ConsentState,
  ConsentStatus,
  DupStatus,
  ERROR_CODES,
  EventCode,
  JobStatus,
  KycStatus,
  LeadStage,
  PanTiming,
  RoleCode,
  CustomerType,
  LeadSource,
  type CreationChannel,
  type ProductCode,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { EntitlementCacheService } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { MaskingService } from '../../core/masking';
import { OutboxService } from '../../core/outbox';
import {
  IDEMPOTENCY_SCOPE_CREATE_LEAD,
  IDEMPOTENCY_SCOPE_IMPORT_LEADS,
  IMPORT_FILE_PREFIX,
  LEADS_RESOURCE_TYPE,
  REQUIRED_CONSENT_PURPOSES,
  SYSTEM_ACTOR_ID,
} from './capture.constants';
import { CaptureIdempotencyService } from './capture-idempotency.service';
import { CodeGenerator } from './code-generator.service';
import { CustomerProfileRepository } from './customer-profile.repository';
import { LeadIdentityRepository } from './lead-identity.repository';
import { LeadService } from './lead.service';
import { SourceAttributionRepository } from './source-attribution.repository';
import type { ConsentInput, CreateLeadDto } from './dto/create-lead.dto';
import type { ImportJobResponseDto } from './dto/import-job-response.dto';
import type { UploadedFileLike } from './dto/uploaded-file.type';
import { ALLOCATION_PORT, type AllocationPort } from './ports/allocation.port';
import { DUPLICATE_CHECK_PORT, type DuplicateCheckPort } from './ports/duplicate-check.port';
import { IMPORT_FILE_STORE_PORT, type ImportFileStorePort } from './ports/import-file-store.port';
import { SCORING_PORT, type ScoringPort } from './ports/scoring.port';

/** Request-derived metadata recorded on audit/consent rows (never logged raw). */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/** Per-call context the controllers/import processor pass alongside the DTO. */
export interface CreateLeadContext {
  actorId: string;
  orgId: string;
  /** Role drives owner defaulting (RM owns own leads) + the PARTNER cross-check; null for system paths. */
  actorRole: RoleCode | null;
  channel: CreationChannel;
  idempotencyKey?: string;
  requestMeta: RequestMeta;
  importJobId?: string;
  /** Public path: auto-route branch from pin_code (LLD §public response). */
  routeBranchByPin?: boolean;
}

/** The `LeadEnvelope.data` payload (api-contract `Lead`; PII pre-masked). */
export interface LeadCaptureData {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode;
  consent_status: ConsentStatus;
  duplicate_status: DupStatus;
  kyc_status: KycStatus;
  score: number | null;
  is_hot: boolean;
  channel_created_by: CreationChannel;
  name_masked: string | null;
  mobile_masked: string | null;
}

export interface CreateLeadResult {
  /** True when an Idempotency-Key replay returned the original payload (HTTP 200, not 201). */
  replayed: boolean;
  data: LeadCaptureData;
}

export interface AcceptImportResult {
  replayed: boolean;
  job: ImportJobResponseDto;
}

interface ResolvedProductConfig {
  product_config_id: string;
  pan_required_at: PanTiming;
}

/**
 * FR-010 — the capture orchestrator. One `UnitOfWork` transaction per lead
 * writes: `lead_identities` → `customer_profiles` (upsert) →
 * `source_attributions` → `leads` (via {@link LeadService.create}, the sole
 * writer — CORRECTIONS.md) → `lead_product_details` stub → `stage_history`
 * (null→captured) → `audit_logs(lead_create)` → `event_outbox(LEAD_CREATED)` →
 * `consent_records[]`. All-or-nothing; the sync duplicate gate runs first inside
 * the same transaction so a strong block rolls everything back. Idempotency-Key
 * replays return the original payload without touching the database.
 */
@Injectable()
export class CaptureService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly leads: LeadService,
    private readonly identities: LeadIdentityRepository,
    private readonly profiles: CustomerProfileRepository,
    private readonly attributions: SourceAttributionRepository,
    private readonly codeGenerator: CodeGenerator,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly masking: MaskingService,
    private readonly idempotency: CaptureIdempotencyService,
    private readonly entitlements: EntitlementCacheService,
    private readonly config: AppConfigService,
    @Inject(DUPLICATE_CHECK_PORT) private readonly duplicates: DuplicateCheckPort,
    @Inject(SCORING_PORT) private readonly scoring: ScoringPort,
    @Inject(IMPORT_FILE_STORE_PORT) private readonly files: ImportFileStorePort,
    @Inject(ALLOCATION_PORT) private readonly allocation: AllocationPort,
    @InjectPinoLogger(CaptureService.name) private readonly logger: PinoLogger,
  ) {}

  // ───────────────────────── create lead (manual / api / public / bulk row) ──

  async createLead(dto: CreateLeadDto, ctx: CreateLeadContext): Promise<CreateLeadResult> {
    // 5a. Idempotency replay (LLD step A) — original response, no second row.
    if (ctx.idempotencyKey) {
      const cached = await this.idempotency.get<LeadCaptureData>(
        IDEMPOTENCY_SCOPE_CREATE_LEAD,
        ctx.idempotencyKey,
      );
      if (cached) {
        return { replayed: true, data: cached };
      }
    }

    // 5b. Active ProductConfig for the product (LLD step B).
    const config = await this.loadActiveProductConfig(dto.product_code, ctx.orgId);

    // 5c. PAN timing rule (LLD §Validation Logic).
    this.validatePanTiming(config.pan_required_at, dto.identity.pan_token);

    // 5d. Branch resolution — explicit branch_code, or pin-code auto-routing (public).
    const branchId = await this.resolveBranchId(dto, ctx);

    // 5e. Partner resolution + PARTNER cross-partner check.
    const partnerId = await this.resolvePartnerId(dto, ctx);

    const consentStatus = this.deriveConsentStatus(dto.consents);
    const ownerId = ctx.actorRole === RoleCode.RM ? ctx.actorId : null;

    // 5g. The atomic capture transaction (LLD step E; architecture §11).
    const created = await this.uow.run(async (tx) => {
      // 5f. Sync duplicate gate — pre-commit, inside the tx (LLD §Step F).
      const dup = await this.duplicates.matchSync(
        { mobile: dto.identity.mobile, pan_token: dto.identity.pan_token ?? null, name: dto.identity.name },
        ctx.orgId,
        tx,
      );
      if (dup.blocked) {
        throw new DomainException(ERROR_CODES.CONFLICT, undefined, {
          detail: { reason: 'DUPLICATE_BLOCKED', matches: dup.matches },
        });
      }

      // E1. lead_identities
      const leadIdentityId = await this.identities.insert(
        {
          org_id: ctx.orgId,
          name: dto.identity.name,
          mobile: dto.identity.mobile,
          email: dto.identity.email ?? null,
          pan_token: dto.identity.pan_token ?? null,
          pan_masked: dto.identity.pan_masked ?? null,
          preferred_language: dto.identity.preferred_language ?? null,
          created_by: ctx.actorId,
        },
        tx,
      );

      // E2. customer_profiles upsert (existing profile linked, never updated).
      const customerProfileId = await this.profiles.upsertByMobile(
        {
          org_id: ctx.orgId,
          primary_mobile: dto.identity.mobile,
          display_name: dto.identity.name,
          customer_type: dto.customer_type ?? CustomerType.INDIVIDUAL,
          created_by: ctx.actorId,
        },
        tx,
      );

      // E3. source_attributions
      const sourceAttributionId = await this.attributions.insert(
        {
          org_id: ctx.orgId,
          source: dto.source.source,
          sub_source: dto.source.sub_source ?? null,
          partner_id: partnerId,
          campaign_code: dto.source.campaign_code ?? null,
          utm: dto.source.utm ?? null,
          creator_channel: ctx.channel,
          created_by: ctx.actorId,
        },
        tx,
      );

      // E4. lead_code (LD-{YYYY}-{seq6}, atomic).
      const leadCode = await this.codeGenerator.nextLeadCode(tx, ctx.orgId);

      // E5. leads — sole writer LeadService.create (CORRECTIONS.md §FR-010).
      const { lead_id } = await this.leads.create(
        {
          org_id: ctx.orgId,
          lead_code: leadCode,
          product_code: dto.product_code,
          product_config_id: config.product_config_id,
          branch_id: branchId,
          pin_code: dto.pin_code ?? null,
          owner_id: ownerId,
          source_attribution_id: sourceAttributionId,
          customer_profile_id: customerProfileId,
          lead_identity_id: leadIdentityId,
          channel_created_by: ctx.channel,
          consent_status: consentStatus,
          duplicate_status: DupStatus.NONE,
          kyc_status: KycStatus.NOT_STARTED,
          requested_amount: dto.requested_amount ?? null,
          import_job_id: ctx.importJobId ?? null,
          created_by: ctx.actorId,
        },
        tx,
      );

      // E6. lead_product_details stub (validation_status=incomplete).
      await tx
        .insertInto('lead_product_details')
        .values({
          org_id: ctx.orgId,
          lead_id,
          product_config_id: config.product_config_id,
          attributes: JSON.stringify(dto.product_detail ?? {}),
          validation_status: 'incomplete',
          created_by: ctx.actorId,
          updated_by: ctx.actorId,
        })
        .execute();

      // E7. stage_history (from_stage=null → captured).
      await this.leads.appendStageHistory(
        {
          org_id: ctx.orgId,
          lead_id,
          from_stage: null,
          to_stage: LeadStage.CAPTURED,
          actor_id: ctx.actorId,
          reason: 'Initial capture',
        },
        tx,
      );

      // E8. audit_logs(lead_create) — same tx (architecture §11).
      await this.audit.append(
        {
          action: AuditAction.LEAD_CREATE,
          entity_type: LEADS_RESOURCE_TYPE,
          entity_id: lead_id,
          actor_id: ctx.actorId,
          org_id: ctx.orgId,
          lead_id,
          detail: { lead_code: leadCode, channel: ctx.channel, source: dto.source.source },
          ipDevice: this.ipDevice(ctx.requestMeta),
        },
        tx,
      );

      // E9. event_outbox(LEAD_CREATED) — same tx.
      await this.outbox.emit(
        {
          event_code: EventCode.LEAD_CREATED,
          aggregate_type: LEADS_RESOURCE_TYPE,
          aggregate_id: lead_id,
          payload: {
            lead_id,
            lead_code: leadCode,
            product_code: dto.product_code,
            stage: LeadStage.CAPTURED,
          },
        },
        tx,
      );

      // E10. consent_records (append-only; FR-110 owns the later lifecycle).
      for (const consent of dto.consents ?? []) {
        await tx
          .insertInto('consent_records')
          .values({
            org_id: ctx.orgId,
            lead_id,
            customer_profile_id: customerProfileId,
            purpose: consent.purpose,
            state: consent.state,
            channel: ctx.channel,
            language: consent.language ?? null,
            notice_version: consent.notice_version,
            consent_text_version: consent.consent_text_version,
            actor: consent.actor,
            ip_device: this.hasMeta(ctx.requestMeta)
              ? JSON.stringify(this.ipDevice(ctx.requestMeta))
              : null,
          })
          .execute();
      }

      // E11 (FR-030). Automatic rules-based allocation — SAME transaction
      // (LLD §Backend Flow Path A step 1): the captured→assigned transition,
      // its stage_history/audit/LEAD_ASSIGNED rows and the lead INSERT commit
      // or roll back together. System actor; the fresh lead is at version 1.
      const allocation = await this.allocation.allocate(
        { leadId: lead_id, orgId: ctx.orgId, actorId: SYSTEM_ACTOR_ID, expectedVersion: 1 },
        tx,
      );

      return { lead_id, lead_code: leadCode, stage: allocation.stage };
    });

    const data: LeadCaptureData = {
      lead_id: created.lead_id,
      lead_code: created.lead_code,
      stage: created.stage,
      product_code: dto.product_code,
      consent_status: consentStatus,
      duplicate_status: DupStatus.NONE,
      kyc_status: KycStatus.NOT_STARTED,
      score: null,
      is_hot: false,
      channel_created_by: ctx.channel,
      name_masked: this.masking.mask('full_name', dto.identity.name),
      mobile_masked: this.masking.mask('mobile', dto.identity.mobile),
    };

    // 5h. Idempotency cache (post-commit, 24 h).
    if (ctx.idempotencyKey) {
      await this.idempotency.set(IDEMPOTENCY_SCOPE_CREATE_LEAD, ctx.idempotencyKey, data);
    }

    // 5i/5j. Non-blocking post-commit hooks — failures are logged, never thrown
    // into the 201 path (the lead is already committed).
    this.scoring.evaluateAsync(created.lead_id).catch((err: unknown) => {
      this.logger.error({ err, lead_id: created.lead_id }, 'Post-commit scoring dispatch failed');
    });
    this.duplicates.matchAsync(created.lead_id).catch((err: unknown) => {
      this.logger.error({ err, lead_id: created.lead_id }, 'Post-commit duplicate scan failed');
    });

    return { replayed: false, data };
  }

  // ─────────────────────────────────────────────── bulk import (accept path) ──

  /**
   * Validate + persist the upload and create the `import_jobs` row (bulk flow
   * 5a–5d). Dispatching the processor is the CONTROLLER's follow-up via
   * {@link ImportDispatchPort} — only on a non-replayed accept.
   */
  async acceptBulkImport(
    file: UploadedFileLike | undefined,
    idempotencyKey: string | undefined,
    actor: { actorId: string; orgId: string },
  ): Promise<AcceptImportResult> {
    if (idempotencyKey) {
      const cached = await this.idempotency.get<ImportJobResponseDto>(
        IDEMPOTENCY_SCOPE_IMPORT_LEADS,
        idempotencyKey,
      );
      if (cached) {
        return { replayed: true, job: cached };
      }
    }

    if (!file || file.buffer == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'file', issue: 'File is required.' }],
      });
    }

    const maxBytes = this.config.get('MAX_UPLOAD_MB') * 1024 * 1024;
    if (file.size > maxBytes || file.buffer.byteLength > maxBytes) {
      throw new DomainException(ERROR_CODES.PAYLOAD_TOO_LARGE);
    }

    const kind = sniffImportFileKind(file.buffer);
    if (!kind) {
      throw new DomainException(ERROR_CODES.UNSUPPORTED_MEDIA);
    }

    // 5c. Persist the source file first; the job row references it.
    const fileRef = await this.files.put(
      `${IMPORT_FILE_PREFIX}/${randomUUID()}/source.${kind}`,
      file.buffer,
      kind === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    // 5d. import_jobs row (status=queued).
    const importJobId = await this.uow.run(async (tx) => {
      const row = await tx
        .insertInto('import_jobs')
        .values({
          org_id: actor.orgId,
          file_ref: fileRef,
          status: JobStatus.QUEUED,
          created_by: actor.actorId,
          updated_by: actor.actorId,
        })
        .returning('import_job_id')
        .executeTakeFirstOrThrow();
      return row.import_job_id;
    });

    const job: ImportJobResponseDto = {
      import_job_id: importJobId,
      status: JobStatus.QUEUED,
      total_rows: null,
    };
    if (idempotencyKey) {
      await this.idempotency.set(IDEMPOTENCY_SCOPE_IMPORT_LEADS, idempotencyKey, job);
    }
    return { replayed: false, job };
  }

  // ─────────────────────────────────────────────────────── validation logic ──

  /** U-01..U-03 — derived `consent_status` (FR-110 canonical algorithm at intake). */
  deriveConsentStatus(consents: readonly ConsentInput[] | undefined): ConsentStatus {
    if (!consents || consents.length === 0) {
      return ConsentStatus.PENDING;
    }
    if (consents.some((c) => c.state === ConsentState.WITHDRAWN)) {
      return ConsentStatus.WITHDRAWN;
    }
    // FR-010 nuance: a lone denied lead_contact consent leaves nothing usable.
    if (
      consents.length === 1 &&
      consents[0]?.purpose === ConsentPurpose.LEAD_CONTACT &&
      consents[0]?.state === ConsentState.DENIED
    ) {
      return ConsentStatus.WITHDRAWN;
    }
    const granted = new Set(
      consents.filter((c) => c.state === ConsentState.GRANTED).map((c) => c.purpose),
    );
    if (REQUIRED_CONSENT_PURPOSES.every((p) => granted.has(p))) {
      return ConsentStatus.CAPTURED;
    }
    if (granted.size > 0) {
      return ConsentStatus.PARTIAL;
    }
    return ConsentStatus.PENDING;
  }

  /** U-04/U-05 — PAN timing vs `ProductConfig.pan_required_at`. */
  validatePanTiming(panRequiredAt: PanTiming, panToken: string | undefined): void {
    if (panRequiredAt === PanTiming.AT_CAPTURE && (panToken == null || panToken.length === 0)) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          { field: 'identity.pan_token', issue: 'PAN is required at capture for this product.' },
        ],
      });
    }
  }

  // ──────────────────────────────────────────────────────────── resolution ──

  private async loadActiveProductConfig(
    productCode: ProductCode,
    orgId: string,
  ): Promise<ResolvedProductConfig> {
    const config = await this.db
      .selectFrom('product_configs')
      .where('product_code', '=', productCode)
      .where('status', '=', 'active')
      .where('org_id', '=', orgId)
      .select(['product_config_id', 'pan_required_at'])
      .limit(1)
      .executeTakeFirst();
    if (!config) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'product_code', issue: 'No active configuration for this product.' }],
      });
    }
    return config;
  }

  private async resolveBranchId(dto: CreateLeadDto, ctx: CreateLeadContext): Promise<string | null> {
    if (dto.branch_code) {
      const branch = await this.db
        .selectFrom('branches')
        .where('code', '=', dto.branch_code)
        .where('org_id', '=', ctx.orgId)
        .where('is_active', '=', true)
        .select(['branch_id'])
        .limit(1)
        .executeTakeFirst();
      if (!branch) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'branch_code', issue: 'Branch code not found or inactive.' }],
        });
      }
      return branch.branch_id;
    }

    if (ctx.routeBranchByPin && dto.pin_code) {
      // Auto-routing rule (LLD §public response): branches.pin_codes JSONB ⊇ [pin].
      const branch = await this.db
        .selectFrom('branches')
        .where('org_id', '=', ctx.orgId)
        .where('is_active', '=', true)
        .where(sql<boolean>`pin_codes @> ${JSON.stringify([dto.pin_code])}::jsonb`)
        .select(['branch_id'])
        .limit(1)
        .executeTakeFirst();
      return branch?.branch_id ?? null;
    }
    return null;
  }

  private async resolvePartnerId(dto: CreateLeadDto, ctx: CreateLeadContext): Promise<string | null> {
    const needsPartner =
      dto.source.source === LeadSource.DSA || dto.source.source === LeadSource.DEALER;
    if (!needsPartner) {
      return null;
    }
    // partner_code presence is enforced by the DTO superRefine; defensive here.
    const partnerCode = dto.source.partner_code;
    if (!partnerCode) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          { field: 'source.partner_code', issue: 'partner_code is required when source is DSA or Dealer.' },
        ],
      });
    }

    const partner = await this.db
      .selectFrom('partners')
      .where('partner_code', '=', partnerCode)
      .where('org_id', '=', ctx.orgId)
      .where('status', '=', 'active')
      .select(['partner_id'])
      .limit(1)
      .executeTakeFirst();
    if (!partner) {
      // Absent and suspended/expired collapse to one message (no existence leak).
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'source.partner_code', issue: 'Partner is not active.' }],
      });
    }

    // PARTNER users may only submit for their own partner (auth-matrix `PARTNER.*`).
    if (ctx.actorRole === RoleCode.PARTNER) {
      const entitlement = await this.entitlements.loadActorEntitlement(ctx.actorId, ctx.orgId);
      if (!entitlement?.partnerId || entitlement.partnerId !== partner.partner_id) {
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }
    }
    return partner.partner_id;
  }

  private ipDevice(meta: RequestMeta): { ip?: string; user_agent?: string } {
    return {
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { user_agent: meta.userAgent } : {}),
    };
  }

  private hasMeta(meta: RequestMeta): boolean {
    return Boolean(meta.ip || meta.userAgent);
  }
}

/**
 * Content-based file-type detection for bulk imports (LLD: "MIME by
 * inspection"). XLSX = ZIP magic (`PK\x03\x04`); CSV = cleanly UTF-8-decodable
 * text with no control/replacement characters. Anything else (PDF, images, …)
 * → undefined → 415 UNSUPPORTED_MEDIA.
 */
export function sniffImportFileKind(buffer: Buffer): 'csv' | 'xlsx' | undefined {
  if (buffer.length === 0) {
    return undefined;
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return 'xlsx';
  }
  const sample = buffer.subarray(0, 4096).toString('utf8');
  // Reject binary content: UTF-8 replacement chars, or control chars other than tab/CR/LF.
  if (sample.includes('�')) {
    return undefined;
  }
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return undefined;
    }
  }
  return 'csv';
}
