import { z } from 'zod';

import { BULK_REASSIGN_MAX_IDS } from '../../capture/capture.constants';

/**
 * Bulk actions implementable today: only `reassign` has a pinned, implemented
 * `LeadService` mutator (`bulkReassign`, shared-utilities.md / CORRECTIONS).
 * The contract summary also names `stage`/`tag`; those are rejected as
 * VALIDATION_ERROR until their owning mutators exist (see AMBIGUITY.md).
 */
export const BULK_ACTIONS = ['reassign'] as const;
export type BulkActionKind = (typeof BULK_ACTIONS)[number];

/**
 * FR-050 — `POST /leads/bulk-action` request body. Batch size is hard-bounded
 * by `BULK_REASSIGN_MAX_IDS` (= the LIMIT bound of `LeadService.bulkReassign`);
 * duplicate ids are de-duplicated, never double-dispatched.
 */
export const BulkActionDto = z.object({
  action: z.enum(BULK_ACTIONS, {
    errorMap: () => ({ message: "action must be 'reassign'" }),
  }),
  lead_ids: z
    .array(z.string().uuid('lead_ids must contain valid ids'), {
      required_error: 'lead_ids is required',
      invalid_type_error: 'lead_ids must be an array of lead ids',
    })
    .min(1, 'lead_ids must contain at least 1 id')
    .max(BULK_REASSIGN_MAX_IDS, `at most ${BULK_REASSIGN_MAX_IDS} leads per bulk action`)
    .transform((ids) => [...new Set(ids)]),
  reason: z
    .string({
      required_error: 'reason is required (max 500 chars)',
      invalid_type_error: 'reason is required (max 500 chars)',
    })
    .min(1, 'reason is required (max 500 chars)')
    .max(500, 'reason is required (max 500 chars)'),
  params: z.object(
    {
      owner_id: z
        .string({
          required_error: 'params.owner_id is required',
          invalid_type_error: 'params.owner_id must be a valid id',
        })
        .uuid('params.owner_id must be a valid id'),
    },
    {
      required_error: 'params is required',
      invalid_type_error: 'params must be an object',
    },
  ),
});
export type BulkActionDto = z.infer<typeof BulkActionDto>;
