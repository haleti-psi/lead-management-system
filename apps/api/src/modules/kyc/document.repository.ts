import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type {
  ApplicantScope,
  DocStatus,
  DocType,
  ScanStatus,
  UploadChannel,
} from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { Documents } from '../../core/db/types.generated';
import { DOCUMENTS_LIST_LIMIT } from './kyc.constants';

/** Read shape of a `documents` row (all columns). */
export type DocumentRow = Selectable<Documents>;

/** Lead + product checklist context for an upload/list (LLD §Data Operations 1). */
export interface LeadChecklistContext {
  lead_id: string;
  org_id: string;
  owner_id: string | null;
  branch_id: string | null;
  /** `source_attributions.partner_id` — PARTNER (P) scope check. */
  partner_id: string | null;
  kyc_status: string;
  version: number;
  /** Raw `product_configs.document_checklist` JSONB. */
  document_checklist: unknown;
}

/** Insert shape for one `documents` row (Phase A). */
export interface NewDocument {
  document_id: string;
  lead_id: string;
  org_id: string;
  doc_type: DocType;
  applicant_scope: ApplicantScope;
  file_type: string;
  file_size_kb: number;
  version: number;
  uploaded_via: UploadChannel;
  actor_id: string;
}

/**
 * FR-070 — owner repository for `documents` (M8; auth-matrix
 * `documents.writer = "M8"`). All queries are parameterised Kysely and every
 * list read is LIMIT-bounded (≤ {@link DOCUMENTS_LIST_LIMIT}; NFR-17). It also
 * hosts M8's bounded read over `leads`/`product_configs` (reads are permitted —
 * owner-writes governs writes only; the `leads` write goes through LeadService).
 */
@Injectable()
export class DocumentRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Lead + product checklist for scope check and checklist derivation
   * (LLD §Data Operations 1). `executor` is the ambient tx inside a UnitOfWork.
   */
  async getLeadChecklistContext(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<LeadChecklistContext | undefined> {
    return executor
      .selectFrom('leads')
      .innerJoin(
        'product_configs',
        'product_configs.product_config_id',
        'leads.product_config_id',
      )
      .leftJoin(
        'source_attributions',
        'source_attributions.source_attribution_id',
        'leads.source_attribution_id',
      )
      .select([
        'leads.lead_id as lead_id',
        'leads.org_id as org_id',
        'leads.owner_id as owner_id',
        'leads.branch_id as branch_id',
        'source_attributions.partner_id as partner_id',
        'leads.kyc_status as kyc_status',
        'leads.version as version',
        'product_configs.document_checklist as document_checklist',
      ])
      .where('leads.lead_id', '=', leadId)
      .where('leads.org_id', '=', orgId)
      .where('leads.deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  /** All non-deleted documents for a lead (LLD §Data Operations 2). LIMIT-bounded. */
  async listByLead(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<DocumentRow[]> {
    return executor
      .selectFrom('documents')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .orderBy('doc_type')
      .orderBy('version', 'desc')
      .limit(DOCUMENTS_LIST_LIMIT)
      .execute();
  }

  /** Highest existing version for (lead, doc_type, applicant_scope); 0 if none. */
  async maxVersion(
    leadId: string,
    docType: DocType,
    applicantScope: ApplicantScope,
    orgId: string,
    tx: DbTransaction,
  ): Promise<number> {
    const row = await tx
      .selectFrom('documents')
      .select((eb) => eb.fn.max('version').as('max_version'))
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('doc_type', '=', docType)
      .where('applicant_scope', '=', applicantScope)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.max_version != null ? Number(row.max_version) : 0;
  }

  /** Insert a new document row in `pending` status (Phase A, LLD §Data Operations 3). */
  async insert(input: NewDocument, tx: DbTransaction): Promise<DocumentRow> {
    return tx
      .insertInto('documents')
      .values({
        document_id: input.document_id,
        lead_id: input.lead_id,
        org_id: input.org_id,
        doc_type: input.doc_type,
        applicant_scope: input.applicant_scope,
        status: 'pending',
        file_type: input.file_type,
        file_size_kb: input.file_size_kb,
        version: input.version,
        uploaded_via: input.uploaded_via,
        classification: 'pii',
        virus_scan_status: 'pending',
        storage_ref: null,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Fetch a single document scoped to its lead + org (LLD §Data Operations). */
  async getById(
    documentId: string,
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<DocumentRow | undefined> {
    return executor
      .selectFrom('documents')
      .selectAll()
      .where('document_id', '=', documentId)
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  /** Fetch a document by id alone (internal scan callback — no caller scope). */
  async getByIdUnscoped(
    documentId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<DocumentRow | undefined> {
    return executor
      .selectFrom('documents')
      .selectAll()
      .where('document_id', '=', documentId)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  /** Phase B confirm: pending → uploaded with the GCS object ref (Operations 4). */
  async confirmUpload(
    documentId: string,
    storageRef: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('documents')
      .set({ status: 'uploaded', storage_ref: storageRef, updated_by: actorId, updated_at: new Date() })
      .where('document_id', '=', documentId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'pending')
      .execute();
  }

  /** Scan clean: uploaded → under_review (Operations 5). */
  async markUnderReview(documentId: string, orgId: string, tx: DbTransaction): Promise<void> {
    await tx
      .updateTable('documents')
      .set({ status: 'under_review', updated_at: new Date() })
      .where('document_id', '=', documentId)
      .where('org_id', '=', orgId)
      .where('virus_scan_status', '=', 'clean')
      .where('status', '=', 'uploaded')
      .execute();
  }

  /** Set virus_scan_status (Operations 6). */
  async setScanStatus(
    documentId: string,
    scanStatus: ScanStatus,
    orgId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('documents')
      .set({ virus_scan_status: scanStatus, updated_at: new Date() })
      .where('document_id', '=', documentId)
      .where('org_id', '=', orgId)
      .execute();
  }

  /**
   * Infected scan: reject the document — status back to `pending`, drop the
   * storage_ref (the GCS object is deleted via the port), mark scan infected
   * (LLD §Data Operations 6; INV-004: infected ⇒ storage_ref null).
   */
  async rejectInfected(documentId: string, orgId: string, tx: DbTransaction): Promise<void> {
    await tx
      .updateTable('documents')
      .set({
        status: 'pending',
        virus_scan_status: 'infected',
        storage_ref: null,
        updated_at: new Date(),
      })
      .where('document_id', '=', documentId)
      .where('org_id', '=', orgId)
      .execute();
  }

  /** Waiver: any non-waived → waived with reason + optional expiry (Operations 7). */
  async waiveDocument(
    documentId: string,
    reason: string,
    expiresAt: Date | null,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('documents')
      .set({
        status: 'waived',
        waiver_reason: reason.slice(0, 500),
        expires_at: expiresAt,
        updated_by: actorId,
        updated_at: new Date(),
      })
      .where('document_id', '=', documentId)
      .where('org_id', '=', orgId)
      .where('status', '!=', 'waived')
      .execute();
  }

  /** Latest (highest-version) document per (doc_type, applicant_scope) for a lead. */
  latestPerType(docs: readonly DocumentRow[]): Map<string, DocumentRow> {
    const latest = new Map<string, DocumentRow>();
    for (const doc of docs) {
      const key = `${doc.doc_type}:${doc.applicant_scope}`;
      const existing = latest.get(key);
      if (!existing || doc.version > existing.version) {
        latest.set(key, doc);
      }
    }
    return latest;
  }

  /** Status of the latest row per type as a literal map (for kyc derivation). */
  asDocStatus(status: string): DocStatus {
    return status as DocStatus;
  }
}
