import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  ApplicantScope,
  AuditAction,
  Capability,
  DocStatus,
  DocType,
  ERROR_CODES,
  EventCode,
  KycStatus,
  RoleCode,
  UploadChannel,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { AppConfigService } from '../../core/config';
import { UnitOfWork, type DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { EntitlementService } from '../../core/auth';
import { GCS_PORT, type GcsPort } from '../../core/integration';
import { VIRUS_SCAN_PORT, type VirusScanPort } from '../../core/integration';
import { OutboxService } from '../../core/outbox';
import { SYSTEM_ACTOR_ID } from '../capture/capture.constants';
import { LeadService } from '../capture/lead.service';
import {
  DocumentRepository,
  type DocumentRow,
  type LeadChecklistContext,
} from './document.repository';
import type {
  ChecklistDefinitionItem,
  ChecklistItem,
  DocumentChecklistResponse,
} from './dto/document-checklist.dto';
import type { UploadConfirmDto } from './dto/upload-confirm.dto';
import type { UploadInitiateDto } from './dto/upload-initiate.dto';
import type { WaiverDto } from './dto/waiver.dto';
import {
  ALLOWED_FILE_TYPES,
  DOCUMENT_STORAGE_PREFIX,
  DOCUMENTS_RESOURCE_TYPE,
  WAIVER_ROLE_CODES,
} from './kyc.constants';

/** Request-derived client metadata recorded on audit rows (never logged raw). */
export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

/** Caller context the staff controllers pass alongside the DTO. */
export interface DocumentActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  /** AbacGuard-resolved scope predicate — row-level lead check (FR-002). */
  predicate: ScopePredicate | undefined;
  requestMeta: ClientMeta;
}

/** Context for the customer self-service path (token-resolved, no ABAC). */
export interface CustomerUploadContext {
  leadId: string;
  orgId: string;
  requestMeta: ClientMeta;
}

/** Phase A response (LLD §Endpoint 2 Phase A). */
export interface InitiateUploadData {
  document_id: string;
  upload_url: string;
  upload_url_expires_at: Date;
  status: DocStatus;
}

/** Phase B response (LLD §Endpoint 2 Phase B). */
export interface ConfirmUploadData {
  document_id: string;
  status: DocStatus;
  virus_scan_status: string;
}

/** Waiver response (LLD §Endpoint 3). */
export interface WaiverData {
  document_id: string;
  status: DocStatus;
  waiver_reason: string | null;
  updated_at: Date;
}

/**
 * FR-070 — document checklist & upload (M8 KYC & Documents). Owns every write to
 * `documents` (auth-matrix `documents.writer = M8`). The two-phase upload
 * (initiate → signed PUT URL; confirm → uploaded + scan), the waiver, and the
 * async scan-result callback each run inside ONE {@link UnitOfWork} transaction
 * that atomically writes `documents` + the derived `leads.kyc_status` (via
 * {@link LeadService.setKycStatus} — sole writer of `leads`, owner-writes §11) +
 * the audit intent + the `DOC_UPLOADED` outbox event (LLD §Transaction
 * boundaries). External storage/scan go through the {@link GcsPort} /
 * {@link VirusScanPort} hexagonal ports (mock in dev/test).
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: DocumentRepository,
    private readonly leads: LeadService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    private readonly entitlements: EntitlementService,
    private readonly config: AppConfigService,
    @Inject(GCS_PORT) private readonly gcs: GcsPort,
    @Inject(VIRUS_SCAN_PORT) private readonly virusScan: VirusScanPort,
  ) {}

  // ────────────────────────────────────────────────── list (Endpoint 1) ──

  /** GET /leads/{id}/documents — merged checklist (LLD §Endpoint 1). */
  async listChecklist(
    leadId: string,
    ctx: DocumentActorContext,
  ): Promise<DocumentChecklistResponse> {
    const lead = await this.loadLeadInScope(leadId, ctx.orgId, ctx.predicate);
    const checklist = this.parseChecklist(lead.document_checklist);
    const docs = await this.repo.listByLead(leadId, ctx.orgId);
    const latest = this.repo.latestPerType(docs);

    const items = checklist.map((def) => this.toChecklistItem(def, latest));
    const mandatory = items.filter((i) => i.mandatory);
    const optional = items.filter((i) => !i.mandatory);
    const isDone = (i: ChecklistItem): boolean =>
      i.status === DocStatus.VERIFIED ||
      i.status === DocStatus.WAIVED ||
      i.status === DocStatus.NOT_REQUIRED;

    return {
      lead_id: leadId,
      checklist: items,
      kyc_status: lead.kyc_status as KycStatus,
      mandatory_complete: mandatory.every(isDone),
      optional_complete: optional.every(isDone),
    };
  }

  // ───────────────────────────────────────── upload Phase A (Endpoint 2) ──

  /** Staff Phase A — validate, create the pending row, return a signed PUT URL. */
  async initiateUpload(
    leadId: string,
    dto: UploadInitiateDto,
    ctx: DocumentActorContext,
  ): Promise<InitiateUploadData> {
    return this.runInitiate(leadId, dto, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      uploadedVia: UploadChannel.RM,
      predicate: ctx.predicate,
      requestMeta: ctx.requestMeta,
    });
  }

  /** Customer Phase A — token-scoped; `uploaded_via = customer_link`. */
  async initiateCustomerUpload(
    dto: UploadInitiateDto,
    ctx: CustomerUploadContext,
  ): Promise<InitiateUploadData> {
    return this.runInitiate(ctx.leadId, dto, {
      orgId: ctx.orgId,
      // No user session on the public path — reserved system actor (users FK).
      actorId: SYSTEM_ACTOR_ID,
      uploadedVia: UploadChannel.CUSTOMER_LINK,
      predicate: undefined,
      requestMeta: ctx.requestMeta,
      tokenScoped: true,
    });
  }

  private async runInitiate(
    leadId: string,
    dto: UploadInitiateDto,
    opts: {
      orgId: string;
      actorId: string;
      uploadedVia: UploadChannel;
      predicate: ScopePredicate | undefined;
      requestMeta: ClientMeta;
      tokenScoped?: boolean;
    },
  ): Promise<InitiateUploadData> {
    // Media-type + size gates first (415 / 413 — non-400, so not in Zod).
    if (!ALLOWED_FILE_TYPES.has(dto.file_type)) {
      throw new DomainException(ERROR_CODES.UNSUPPORTED_MEDIA, 'Unsupported file type.');
    }
    const maxKb = this.config.get('MAX_UPLOAD_MB') * 1024;
    if (dto.file_size_kb > maxKb) {
      throw new DomainException(ERROR_CODES.PAYLOAD_TOO_LARGE, 'File is too large.');
    }

    return this.uow.run(async (tx) => {
      const lead = await this.loadLeadInScope(leadId, opts.orgId, opts.predicate, tx, opts.tokenScoped);

      // doc_type + applicant_scope must be in the product checklist (400).
      const checklist = this.parseChecklist(lead.document_checklist);
      const inChecklist = checklist.some(
        (i) => i.doc_type === dto.doc_type && i.applicant_scope === dto.applicant_scope,
      );
      if (!inChecklist) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [
            { field: 'doc_type', issue: 'This document type is not in the product checklist.' },
          ],
        });
      }

      const nextVersion =
        (await this.repo.maxVersion(leadId, dto.doc_type, dto.applicant_scope, opts.orgId, tx)) + 1;

      const documentId = randomUUID();
      const objectPath = this.objectPath(leadId, dto.doc_type, dto.applicant_scope, documentId);

      // Signed PUT URL via the GCS port (503 on failure — rolls the tx back).
      const ttl = this.config.get('GCS_SIGNED_URL_TTL');
      const signed = await this.gcs.generateSignedPutUrl(objectPath, dto.file_type, ttl);

      const row = await this.repo.insert(
        {
          document_id: documentId,
          lead_id: leadId,
          org_id: opts.orgId,
          doc_type: dto.doc_type,
          applicant_scope: dto.applicant_scope,
          file_type: dto.file_type,
          file_size_kb: dto.file_size_kb,
          version: nextVersion,
          uploaded_via: opts.uploadedVia,
          actor_id: opts.actorId,
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.DOC_UPLOAD,
          entity_type: DOCUMENTS_RESOURCE_TYPE,
          entity_id: documentId,
          actor_id: opts.actorId,
          org_id: opts.orgId,
          lead_id: leadId,
          detail: {
            doc_type: dto.doc_type,
            applicant_scope: dto.applicant_scope,
            version: nextVersion,
            status: row.status,
          },
          ipDevice: toAuditIpDevice(opts.requestMeta),
        },
        tx,
      );

      return {
        document_id: documentId,
        upload_url: signed.url,
        upload_url_expires_at: signed.expiresAt,
        status: row.status as DocStatus,
      };
    });
  }

  // ───────────────────────────────────────── upload Phase B (Endpoint 2) ──

  /** Staff Phase B — confirm: inspect MIME, mark uploaded, enqueue scan. */
  async confirmUpload(
    leadId: string,
    dto: UploadConfirmDto,
    ctx: DocumentActorContext,
  ): Promise<ConfirmUploadData> {
    return this.runConfirm(leadId, dto, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      predicate: ctx.predicate,
      requestMeta: ctx.requestMeta,
    });
  }

  /** Customer Phase B — token-scoped confirm. */
  async confirmCustomerUpload(
    dto: UploadConfirmDto,
    ctx: CustomerUploadContext,
  ): Promise<ConfirmUploadData> {
    return this.runConfirm(ctx.leadId, dto, {
      orgId: ctx.orgId,
      actorId: SYSTEM_ACTOR_ID,
      predicate: undefined,
      requestMeta: ctx.requestMeta,
      tokenScoped: true,
    });
  }

  private async runConfirm(
    leadId: string,
    dto: UploadConfirmDto,
    opts: {
      orgId: string;
      actorId: string;
      predicate: ScopePredicate | undefined;
      requestMeta: ClientMeta;
      tokenScoped?: boolean;
    },
  ): Promise<ConfirmUploadData> {
    // Scope check on the lead first (staff path); customer path is token-scoped.
    if (!opts.tokenScoped) {
      await this.loadLeadInScope(leadId, opts.orgId, opts.predicate);
    }

    return this.uow.run(async (tx) => {
      const doc = await this.repo.getById(dto.document_id, leadId, opts.orgId, tx);
      if (!doc || doc.status !== DocStatus.PENDING) {
        throw new DomainException(ERROR_CODES.NOT_FOUND, 'Document not found.');
      }

      const objectPath = this.objectPathForDoc(doc);

      // Content-MIME inspection (server does not trust the declared type).
      const metadata = await this.gcs.getObjectMetadata(objectPath);
      if (doc.file_type && metadata.contentType && metadata.contentType !== doc.file_type) {
        await this.gcs.deleteObject(objectPath);
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'file_type', issue: 'File type mismatch.' }],
        });
      }

      await this.repo.confirmUpload(dto.document_id, objectPath, opts.orgId, opts.actorId, tx);

      // Enqueue the async virus scan (does not block; result via callback).
      await this.virusScan.scanObject({ objectPath, documentId: dto.document_id });

      // Re-derive leads.kyc_status from all current doc statuses (owner-writes).
      await this.recomputeKycStatus(leadId, opts.orgId, tx);

      await this.outbox.emit(
        {
          event_code: EventCode.DOC_UPLOADED,
          aggregate_type: DOCUMENTS_RESOURCE_TYPE,
          aggregate_id: dto.document_id,
          payload: {
            lead_id: leadId,
            doc_type: doc.doc_type,
            applicant_scope: doc.applicant_scope,
            status: DocStatus.UPLOADED,
          },
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.DOC_UPLOAD,
          entity_type: DOCUMENTS_RESOURCE_TYPE,
          entity_id: dto.document_id,
          actor_id: opts.actorId,
          org_id: opts.orgId,
          lead_id: leadId,
          detail: {
            doc_type: doc.doc_type,
            applicant_scope: doc.applicant_scope,
            version: doc.version,
            status: DocStatus.UPLOADED,
          },
          ipDevice: toAuditIpDevice(opts.requestMeta),
        },
        tx,
      );

      return {
        document_id: dto.document_id,
        status: DocStatus.UPLOADED,
        virus_scan_status: 'pending',
      };
    });
  }

  // ─────────────────────────────────────────────── waiver (Endpoint 3) ──

  /** PATCH/POST /leads/{id}/documents/{did}/waive — authorised waiver (LLD §Waiver). */
  async waiveDocument(
    leadId: string,
    documentId: string,
    dto: WaiverDto,
    ctx: DocumentActorContext,
  ): Promise<WaiverData> {
    const lead = await this.loadLeadInScope(leadId, ctx.orgId, ctx.predicate);

    // verify_doc capability (KYC/BM only) — single ABAC decision point, plus the
    // explicit role-code gate (LLD §Auth — additional check).
    const decision = await this.entitlements.can(
      { userId: ctx.userId, orgId: ctx.orgId },
      Capability.VERIFY_DOC,
      { resourceType: DOCUMENTS_RESOURCE_TYPE, ownerId: lead.owner_id, branchId: lead.branch_id },
    );
    if (!decision.granted || !WAIVER_ROLE_CODES.has(ctx.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    return this.uow.run(async (tx) => {
      const doc = await this.repo.getById(documentId, leadId, ctx.orgId, tx);
      if (!doc) {
        throw new DomainException(ERROR_CODES.NOT_FOUND);
      }
      if (doc.status === DocStatus.WAIVED) {
        throw new DomainException(ERROR_CODES.CONFLICT, 'Document is already waived.');
      }

      const expiresAt = dto.expires_at ?? null;
      await this.repo.waiveDocument(documentId, dto.reason, expiresAt, ctx.orgId, ctx.userId, tx);

      await this.recomputeKycStatus(leadId, ctx.orgId, tx);

      await this.outbox.emit(
        {
          event_code: EventCode.DOC_UPLOADED,
          aggregate_type: DOCUMENTS_RESOURCE_TYPE,
          aggregate_id: documentId,
          payload: {
            lead_id: leadId,
            doc_type: doc.doc_type,
            applicant_scope: doc.applicant_scope,
            status: DocStatus.WAIVED,
          },
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.DOC_WAIVE,
          entity_type: DOCUMENTS_RESOURCE_TYPE,
          entity_id: documentId,
          actor_id: ctx.userId,
          org_id: ctx.orgId,
          lead_id: leadId,
          detail: {
            doc_type: doc.doc_type,
            applicant_scope: doc.applicant_scope,
            version: doc.version,
            status: DocStatus.WAIVED,
            reason: dto.reason,
          },
          ipDevice: toAuditIpDevice(ctx.requestMeta),
        },
        tx,
      );

      return {
        document_id: documentId,
        status: DocStatus.WAIVED,
        waiver_reason: dto.reason,
        updated_at: new Date(),
      };
    });
  }

  // ───────────────────────────────── scan-result callback (internal) ──

  /**
   * Reconcile an async virus-scan verdict (LLD §Virus scan async callback). One
   * UnitOfWork tx: set scan status, transition the doc, delete the GCS object on
   * infection, re-derive kyc_status, emit audit + outbox. No caller scope (the
   * route is HMAC-verified service-to-service).
   */
  async handleScanResult(documentId: string, status: 'clean' | 'infected'): Promise<void> {
    await this.uow.run(async (tx) => {
      const doc = await this.repo.getByIdUnscoped(documentId, tx);
      if (!doc) {
        throw new DomainException(ERROR_CODES.NOT_FOUND);
      }
      const storageRef = doc.storage_ref;

      if (status === 'infected') {
        // Reject: status back to pending, scan infected, drop storage_ref.
        await this.repo.rejectInfected(documentId, doc.org_id, tx);
        if (storageRef) {
          await this.gcs.deleteObject(storageRef);
        }
        await this.emitScanOutcome(doc, 'rejected', tx);
      } else {
        await this.repo.setScanStatus(documentId, 'clean', doc.org_id, tx);
        await this.repo.markUnderReview(documentId, doc.org_id, tx);
        await this.recomputeKycStatus(doc.lead_id, doc.org_id, tx);
        await this.emitScanOutcome(doc, DocStatus.UNDER_REVIEW, tx);
      }

      await this.audit.append(
        {
          action: AuditAction.DOC_UPLOAD,
          entity_type: DOCUMENTS_RESOURCE_TYPE,
          entity_id: documentId,
          actor_id: SYSTEM_ACTOR_ID,
          org_id: doc.org_id,
          lead_id: doc.lead_id,
          detail: { doc_type: doc.doc_type, applicant_scope: doc.applicant_scope, scan_result: status },
        },
        tx,
      );
    });
  }

  private async emitScanOutcome(doc: DocumentRow, status: string, tx: DbTransaction): Promise<void> {
    await this.outbox.emit(
      {
        event_code: EventCode.DOC_UPLOADED,
        aggregate_type: DOCUMENTS_RESOURCE_TYPE,
        aggregate_id: doc.document_id,
        payload: {
          lead_id: doc.lead_id,
          doc_type: doc.doc_type,
          applicant_scope: doc.applicant_scope,
          status,
        },
      },
      tx,
    );
  }

  // ─────────────────────────────────────────────── kyc derivation ──

  /** Re-derive leads.kyc_status from the current documents and persist it (owner-writes). */
  private async recomputeKycStatus(leadId: string, orgId: string, tx: DbTransaction): Promise<void> {
    const lead = await this.repo.getLeadChecklistContext(leadId, orgId, tx);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    const checklist = this.parseChecklist(lead.document_checklist);
    const docs = await this.repo.listByLead(leadId, orgId, tx);
    const derived = this.deriveKycStatus(checklist, docs);
    await this.leads.setKycStatus(leadId, derived, tx);
  }

  /**
   * Derive leads.kyc_status from the mandatory checklist + latest documents
   * (LLD §Data Operations 8). `verified`/`waived`/`not_required` count a
   * mandatory item as done; `uploaded`/`under_review` mark in-progress.
   */
  deriveKycStatus(checklist: readonly ChecklistDefinitionItem[], docs: readonly DocumentRow[]): KycStatus {
    const latest = this.repo.latestPerType(docs);
    const mandatory = checklist.filter((i) => i.mandatory);

    const allMandatoryDone = mandatory.every((item) => {
      const doc = latest.get(`${item.doc_type}:${item.applicant_scope}`);
      return (
        doc != null &&
        (doc.status === DocStatus.VERIFIED ||
          doc.status === DocStatus.WAIVED ||
          doc.status === DocStatus.NOT_REQUIRED)
      );
    });
    if (allMandatoryDone) {
      return KycStatus.VERIFIED;
    }

    const anyInProgress = docs.some(
      (d) => d.status === DocStatus.UPLOADED || d.status === DocStatus.UNDER_REVIEW,
    );
    return anyInProgress ? KycStatus.IN_PROGRESS : KycStatus.NOT_STARTED;
  }

  // ───────────────────────────────────────────────────── internals ──

  /**
   * Load the lead (404 absent) and enforce the ABAC scope (403). On the customer
   * token path (`tokenScoped`) the lead is already bound by CustomerLinkGuard, so
   * the predicate scope check is bypassed — mirroring `runConfirm`.
   */
  private async loadLeadInScope(
    leadId: string,
    orgId: string,
    predicate: ScopePredicate | undefined,
    executor?: DbTransaction,
    tokenScoped = false,
  ): Promise<LeadChecklistContext> {
    const lead = await this.repo.getLeadChecklistContext(leadId, orgId, executor);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!tokenScoped && !leadInScope(lead, predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    return lead;
  }

  /** Map a checklist definition item + latest docs to a wire ChecklistItem. */
  private toChecklistItem(
    def: ChecklistDefinitionItem,
    latest: Map<string, DocumentRow>,
  ): ChecklistItem {
    const doc = latest.get(`${def.doc_type}:${def.applicant_scope}`);
    if (!doc) {
      // No row yet: optional → not_required; mandatory → pending (LLD §Ambiguities 4).
      return {
        doc_type: def.doc_type,
        applicant_scope: def.applicant_scope,
        label: def.label,
        mandatory: def.mandatory,
        status: def.mandatory ? DocStatus.PENDING : DocStatus.NOT_REQUIRED,
        document_id: null,
        version: null,
      };
    }
    return {
      doc_type: def.doc_type,
      applicant_scope: def.applicant_scope,
      label: def.label,
      mandatory: def.mandatory,
      status: doc.status as DocStatus,
      document_id: doc.document_id,
      version: doc.version,
      file_type: doc.file_type,
      file_size_kb: doc.file_size_kb,
      virus_scan_status: doc.virus_scan_status,
      uploaded_via: doc.uploaded_via,
      expires_at: doc.expires_at,
      waiver_reason: doc.waiver_reason,
      created_at: doc.created_at,
    };
  }

  /**
   * Parse `product_configs.document_checklist` JSONB into typed definition items
   * (LLD §Summary). Unknown/malformed entries are skipped defensively; the
   * structure is owned by M5 (FR-040) and only read here.
   */
  private parseChecklist(raw: unknown): ChecklistDefinitionItem[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const items: ChecklistDefinitionItem[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const docType = record.doc_type;
      const scope = record.applicant_scope;
      if (!isDocType(docType) || !isApplicantScope(scope)) {
        continue;
      }
      items.push({
        doc_type: docType,
        applicant_scope: scope,
        label: typeof record.label === 'string' ? record.label : docType,
        mandatory: record.mandatory === true,
      });
    }
    return items;
  }

  /**
   * Deterministic GCS object key for a document — derived from identity only (no
   * arbitrary filename), so Phase A (signed URL target) and Phase B (metadata
   * read) compute the IDENTICAL path. The object is always keyed by document_id.
   */
  private objectPath(leadId: string, docType: DocType, scope: ApplicantScope, documentId: string): string {
    return `${DOCUMENT_STORAGE_PREFIX}/${leadId}/${docType}/${scope}/${documentId}`;
  }

  /** Re-derive the object path for an existing doc (storage_ref once set, else identity). */
  private objectPathForDoc(doc: DocumentRow): string {
    return doc.storage_ref ?? this.objectPath(doc.lead_id, doc.doc_type, doc.applicant_scope, doc.document_id);
  }
}

function isDocType(value: unknown): value is DocType {
  return typeof value === 'string' && Object.values(DocType).includes(value as DocType);
}

function isApplicantScope(value: unknown): value is ApplicantScope {
  return typeof value === 'string' && Object.values(ApplicantScope).includes(value as ApplicantScope);
}

/** Minimal lead shape the ABAC scope check reads — so non-document callers
 * (FR-071 KYC) can reuse {@link leadInScope} without the checklist context. */
export interface ScopableLead {
  lead_id: string;
  org_id: string;
  owner_id: string | null;
  branch_id: string | null;
  partner_id: string | null;
}

/** Lead-in-scope per the AbacGuard-resolved predicate (FR-002 contract). */
export function leadInScope(
  lead: ScopableLead,
  predicate: ScopePredicate | undefined,
): boolean {
  if (!predicate) {
    return false;
  }
  switch (predicate.type) {
    case 'own':
      return lead.owner_id !== null && lead.owner_id === predicate.userId;
    case 'team':
      return lead.owner_id !== null && predicate.userIds.includes(lead.owner_id);
    case 'branch':
      return lead.branch_id !== null && lead.branch_id === predicate.branchId;
    case 'region':
      return lead.branch_id !== null && predicate.branchIds.includes(lead.branch_id);
    case 'all':
    case 'masked':
      return lead.org_id === predicate.orgId;
    case 'partner':
      return lead.partner_id !== null && lead.partner_id === predicate.partnerId;
    case 'customer_token':
      return lead.lead_id === predicate.leadId;
    default:
      return false;
  }
}

/** Audit `ip_device` column shape (FR-001/FR-010 convention). */
function toAuditIpDevice(meta: ClientMeta): { ip?: string; user_agent?: string } | null {
  if (!meta.ip && !meta.userAgent) {
    return null;
  }
  return {
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { user_agent: meta.userAgent } : {}),
  };
}
