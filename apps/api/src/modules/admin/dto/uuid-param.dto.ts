import { z } from 'zod';

/**
 * FR-130 — generic `{id}` path-parameter schema (a resource UUID for users /
 * roles / teams). Validated by {@link ZodValidationPipe} on the `@Param('id')`; a
 * non-UUID maps to `VALIDATION_ERROR` (400) with field `id` before the service is
 * reached.
 */
export const UuidParam = z
  .string({ required_error: 'id must be a valid UUID' })
  .uuid('id must be a valid UUID');

export type UuidParam = z.infer<typeof UuidParam>;
