import { z } from 'zod';

/**
 * FR-070 — Phase B (confirm) body for `POST /leads/{id}/documents` (LLD
 * §Validation Logic — UploadConfirmDto). The presence of `action: "confirm"`
 * distinguishes confirm from initiate on the shared endpoint path (LLD §Endpoint
 * 2: "two phases share the same path differentiated by body shape").
 */
export const UploadConfirmDto = z.object({
  action: z.literal('confirm', { errorMap: () => ({ message: 'Invalid action.' }) }),
  document_id: z
    .string({ required_error: 'Document not found.' })
    .uuid('Document not found.'),
});
export type UploadConfirmDto = z.infer<typeof UploadConfirmDto>;

/**
 * Phase A vs. Phase B discriminator at the controller boundary. A body carrying
 * `action: "confirm"` is a confirm; anything else is an initiate (validated
 * against {@link UploadInitiateDto}). Kept here so the controller stays thin.
 */
export function isConfirmBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'action' in body &&
    (body as { action: unknown }).action === 'confirm'
  );
}
