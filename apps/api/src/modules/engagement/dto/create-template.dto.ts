import { z } from 'zod';

import { CommCategory, CommChannel, Lang, ProductCode } from '@lms/shared';

/**
 * FR-101 — Zod schema for POST /api/v1/admin/templates.
 * Validated at the controller boundary before service call.
 */
export const CreateTemplateDto = z.object({
  code: z
    .string({ required_error: 'Template code must be alphanumeric/underscore, max 60 chars.' })
    .min(1, 'Template code must be alphanumeric/underscore, max 60 chars.')
    .max(60, 'Template code must be alphanumeric/underscore, max 60 chars.')
    .regex(/^[A-Za-z0-9_]+$/, 'Template code must be alphanumeric/underscore, max 60 chars.'),
  version: z
    .number({ required_error: 'Version must be a positive integer.' })
    .int('Version must be a positive integer.')
    .min(1, 'Version must be a positive integer.'),
  channel: z.nativeEnum(CommChannel, {
    errorMap: () => ({ message: 'Channel must be one of: in_app, email, sms, whatsapp.' }),
  }),
  language: z.nativeEnum(Lang, {
    errorMap: () => ({ message: 'Language must be one of the supported values.' }),
  }),
  category: z.nativeEnum(CommCategory, {
    errorMap: () => ({ message: 'Category must be transactional or marketing.' }),
  }),
  product_code: z
    .nativeEnum(ProductCode, {
      errorMap: () => ({ message: 'Invalid product code.' }),
    })
    .optional(),
  body: z
    .string({ required_error: 'Template body is required and must not exceed 4000 characters.' })
    .min(1, 'Template body is required and must not exceed 4000 characters.')
    .max(4000, 'Template body is required and must not exceed 4000 characters.'),
});

export type CreateTemplateDto = z.infer<typeof CreateTemplateDto>;
