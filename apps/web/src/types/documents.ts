import type { ApplicantScope, DocStatus, DocType, KycStatus, UploadChannel } from '@lms/shared';

/**
 * FR-070 wire types — mirror the NestJS `kyc` DTOs exactly
 * (apps/api/src/modules/kyc/dto/document-checklist.dto.ts + document.service.ts).
 * Date-valued fields arrive as ISO strings over the wire (JSON), so they are
 * typed `string` here even though the server types them `Date`.
 */

/** One merged checklist row — `GET /leads/{id}/documents` (LLD §Endpoint 1).
 * Fields after `version` are present only when a `documents` row exists; the
 * `storage_ref` is never sent to the client. */
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
  expires_at?: string | null;
  waiver_reason?: string | null;
  created_at?: string | null;
}

export interface DocumentChecklistResponse {
  lead_id: string;
  checklist: ChecklistItem[];
  kyc_status: KycStatus;
  mandatory_complete: boolean;
  optional_complete: boolean;
}

/** Phase A (initiate) request body. */
export interface UploadInitiateBody {
  doc_type: DocType;
  applicant_scope: ApplicantScope;
  file_name: string;
  file_type: string;
  file_size_kb: number;
}

/** Phase A (initiate) response. */
export interface InitiateUploadData {
  document_id: string;
  upload_url: string;
  upload_url_expires_at: string;
  status: DocStatus;
}

/** Phase B (confirm) response. */
export interface ConfirmUploadData {
  document_id: string;
  status: DocStatus;
  virus_scan_status: string;
}

/** Waiver request body — `POST /leads/{id}/documents/{did}/waive`. */
export interface WaiverBody {
  reason: string;
  expires_at?: string;
  review_note?: string;
}

/** Waiver response. */
export interface WaiverData {
  document_id: string;
  status: DocStatus;
  waiver_reason: string | null;
  updated_at: string;
}
