import { z } from 'zod';

/**
 * FR-132 — path parameter `id` (the `configuration_versions` UUID). Validated by
 * {@link ZodValidationPipe} on the `@Param('id')`; a non-UUID maps to
 * `VALIDATION_ERROR` (400) with field `id` before the service is reached.
 */
export const ConfigIdParam = z
  .string({ required_error: 'id must be a valid UUID' })
  .uuid('id must be a valid UUID');

export type ConfigIdParam = z.infer<typeof ConfigIdParam>;
