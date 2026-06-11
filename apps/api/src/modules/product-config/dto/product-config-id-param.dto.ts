import { z } from 'zod';

/**
 * FR-040 — path parameter `id` (the `product_config_id` UUID). Validated by
 * {@link ZodValidationPipe} on `@Param('id')`; a non-UUID maps to
 * `VALIDATION_ERROR` (400) with field `id` before the service is reached.
 */
export const ProductConfigIdParam = z
  .string({ required_error: 'id must be a valid UUID' })
  .uuid('id must be a valid UUID');

export type ProductConfigIdParam = z.infer<typeof ProductConfigIdParam>;
