import { z } from 'zod';

/**
 * FR-054 — `GET /search` query grammar (LLD §Validation Logic).
 * `q` is required, min 2 chars, max 100 chars. Unknown params stripped.
 */
export const SearchQuerySchema = z
  .object({
    q: z
      .string({ required_error: 'must be at least 2 characters' })
      .min(2, 'must be at least 2 characters')
      .max(100, 'must not exceed 100 characters'),
  })
  .strip();

export type SearchQueryDto = z.infer<typeof SearchQuerySchema>;
