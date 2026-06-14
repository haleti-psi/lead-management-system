import type { ApplicantScope, DocStatus, DocType, KycStatus, UploadChannel } from '@lms/shared';

/**
 * One product-checklist definition item, parsed from
 * `product_configs.document_checklist` JSONB (LLD §Summary; §Ambiguities 4).
 * `mandatory: false` items are optional; an item with no `documents` row appears
 * in the response as `pending` (or `not_required` when optional).
 */
export interface ChecklistDefinitionItem {
  doc_type: DocType;
  applicant_scope: ApplicantScope;
  label: string;
  mandatory: boolean;
}

/**
 * One merged checklist row in the `GET /leads/{id}/documents` response — a
 * checklist definition item merged with its latest `documents` row (if any).
 * Fields after `version` are present only when a document row exists. No PII and
 * never the `storage_ref` (LLD §UI: storage_ref is never sent to the frontend).
 */
export interface ChecklistItem {
  doc_type: DocType;
  applicant_scope: ApplicantScope;
  label: string;
  mandatory: boolean;
  status: DocStatus;
  document_id: string | null;
  version: number | null;
  file_type?: string | null;
  file_size_kb?: number | null;
  virus_scan_status?: string | null;
  uploaded_via?: UploadChannel | null;
  expires_at?: Date | null;
  waiver_reason?: string | null;
  created_at?: Date | null;
}

/** `GET /leads/{id}/documents` response data (LLD §Endpoint 1). */
export interface DocumentChecklistResponse {
  lead_id: string;
  checklist: ChecklistItem[];
  kyc_status: KycStatus;
  mandatory_complete: boolean;
  optional_complete: boolean;
}
