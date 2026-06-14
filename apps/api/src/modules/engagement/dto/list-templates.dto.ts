import { z } from 'zod';

import { CommCategory, CommChannel, ConfigStatus, Lang, ProductCode } from '@lms/shared';

/**
 * FR-101 — Query params for GET /api/v1/admin/templates.
 */
export const ListTemplatesDto = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  channel: z.nativeEnum(CommChannel).optional(),
  language: z.nativeEnum(Lang).optional(),
  category: z.nativeEnum(CommCategory).optional(),
  status: z.nativeEnum(ConfigStatus).optional(),
  product_code: z.nativeEnum(ProductCode).optional(),
});

export type ListTemplatesDto = z.infer<typeof ListTemplatesDto>;
