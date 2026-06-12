import { z } from 'zod';

import { DataScope } from '@lms/shared';

import { buildLeadFilterSchema } from './list-leads.dto';

const DATA_SCOPE_VALUES = Object.values(DataScope) as [DataScope, ...DataScope[]];

/**
 * Saved-view `filter_json` reuses the list FILTER_ALLOWLIST grammar (single
 * source of truth, LLD §Validation); only the unknown-key wording differs.
 */
const SavedViewFilterSchema = buildLeadFilterSchema(
  () => 'saved view contains an unsupported filter',
);

/**
 * FR-050 — `POST /saved-views` request body (LLD §Endpoint 3). The cross-field
 * rule — `is_shared=true` requires `scope ⊆` the caller's own `view_lead`
 * scope — needs the AbacGuard-resolved scope, so it is enforced in
 * `SavedViewService.create`, not here.
 */
export const CreateSavedViewDto = z.object({
  name: z
    .string({
      required_error: 'name is required (max 120 chars)',
      invalid_type_error: 'name is required (max 120 chars)',
    })
    .min(1, 'name is required (max 120 chars)')
    .max(120, 'name is required (max 120 chars)'),
  filter_json: SavedViewFilterSchema,
  is_shared: z
    .boolean({ invalid_type_error: 'is_shared must be a boolean' })
    .default(false),
  scope: z.enum(DATA_SCOPE_VALUES, { errorMap: () => ({ message: 'invalid scope' }) }),
});
export type CreateSavedViewDto = z.infer<typeof CreateSavedViewDto>;
