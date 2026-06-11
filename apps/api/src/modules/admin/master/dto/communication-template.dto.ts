import { z } from 'zod';

import { CommCategory, CommChannel, Lang, ProductCode } from '@lms/shared';

import { atLeastOneKey } from './common';

const CHANNEL_VALUES = Object.values(CommChannel) as [CommChannel, ...CommChannel[]];
const CATEGORY_VALUES = Object.values(CommCategory) as [CommCategory, ...CommCategory[]];
const LANG_VALUES = Object.values(Lang) as [Lang, ...Lang[]];
const PRODUCT_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];

/**
 * FR-131 — `communication_templates` master (schema 3.16). Unique per
 * (org, code, channel, language, version). `version` is assigned by the writer
 * (next version per code/channel/language), not supplied by the client.
 * `status` follows `config_status` (created `draft`, activated via FR-132).
 */
export const CreateCommunicationTemplateDto = z.object({
  code: z
    .string({ required_error: 'code is required.' })
    .min(1, 'code is required.')
    .max(60, 'code must not exceed 60 characters.'),
  channel: z.enum(CHANNEL_VALUES, {
    errorMap: () => ({ message: 'channel must be a valid communication channel.' }),
  }),
  language: z.enum(LANG_VALUES, { errorMap: () => ({ message: 'language must be a valid language.' }) }),
  category: z.enum(CATEGORY_VALUES, {
    errorMap: () => ({ message: 'category must be a valid template category.' }),
  }),
  productCode: z
    .enum(PRODUCT_VALUES, { errorMap: () => ({ message: 'productCode must be a valid product code.' }) })
    .optional(),
  body: z.string({ required_error: 'body is required.' }).min(1, 'body is required.'),
});
export type CreateCommunicationTemplateDto = z.infer<typeof CreateCommunicationTemplateDto>;

export const PatchCommunicationTemplateDto = atLeastOneKey(
  z.object({
    body: z.string().min(1).optional(),
    category: z
      .enum(CATEGORY_VALUES, { errorMap: () => ({ message: 'category must be a valid template category.' }) })
      .optional(),
    productCode: z
      .enum(PRODUCT_VALUES, { errorMap: () => ({ message: 'productCode must be a valid product code.' }) })
      .optional(),
    status: z
      .enum(['draft', 'active', 'retired'], {
        errorMap: () => ({ message: 'status must be draft, active, or retired.' }),
      })
      .optional(),
  }),
);
export type PatchCommunicationTemplateDto = z.infer<typeof PatchCommunicationTemplateDto>;
