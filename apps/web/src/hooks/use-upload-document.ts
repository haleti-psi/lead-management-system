import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ApplicantScope, DocType } from '@lms/shared';
import { apiClient } from '@/lib/api';
import { documentKeys } from '@/hooks/use-document-checklist';
import type { ConfirmUploadData, InitiateUploadData } from '@/types/documents';

/**
 * Upload target — staff (JWT, lead-scoped) or customer (public token link). The
 * two-phase POST path differs but the protocol is identical (LLD §Endpoint 2/4).
 */
export type UploadTarget =
  | { kind: 'staff'; leadId: string }
  | { kind: 'customer'; token: string };

export interface UploadInput {
  file: File;
  doc_type: DocType;
  applicant_scope: ApplicantScope;
}

function uploadPath(target: UploadTarget): string {
  return target.kind === 'staff'
    ? `/leads/${target.leadId}/documents`
    : `/c/${target.token}/documents`;
}

/**
 * Two-phase document upload (LLD §Endpoint 2 — initiate → signed PUT → confirm):
 *  A. POST initiate → `{ document_id, upload_url }`
 *  B. PUT the binary straight to the GCS signed URL (no envelope, no auth header)
 *  C. POST `{ action: 'confirm', document_id }` → server inspects MIME, enqueues scan
 * On success the lead's checklist query is invalidated so the new row appears.
 */
export function useUploadDocument(
  target: UploadTarget,
): UseMutationResult<ConfirmUploadData, unknown, UploadInput> {
  const queryClient = useQueryClient();
  const path = uploadPath(target);

  return useMutation({
    mutationFn: async ({ file, doc_type, applicant_scope }: UploadInput): Promise<ConfirmUploadData> => {
      const initiated = await apiClient.post<InitiateUploadData>(path, {
        doc_type,
        applicant_scope,
        file_name: file.name,
        file_type: file.type,
        file_size_kb: Math.max(1, Math.ceil(file.size / 1024)),
      });

      await putToSignedUrl(initiated.upload_url, file);

      return apiClient.post<ConfirmUploadData>(path, {
        action: 'confirm',
        document_id: initiated.document_id,
      });
    },
    onSuccess: () => {
      if (target.kind === 'staff') {
        void queryClient.invalidateQueries({ queryKey: documentKeys.checklist(target.leadId) });
      }
    },
  });
}

/** PUT the binary to the GCS signed URL. Direct to storage — not via apiClient
 * (no `{data,meta,error}` envelope, no Bearer token). */
async function putToSignedUrl(url: string, file: File): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  } catch {
    throw new Error('Upload to storage failed. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new Error('Upload to storage failed. Please try again.');
  }
}
