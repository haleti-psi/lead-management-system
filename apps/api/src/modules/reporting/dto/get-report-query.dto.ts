import { z } from 'zod';

import { LeadSource, ProductCode } from '@lms/shared';

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';
import { REPORT_CODES } from '../reporting.constants';

/**
 * FR-120 — `GET /api/v1/reports/{code}` query-string schema (LLD §Validation
 * Logic). Validated at the controller boundary by {@link ZodValidationPipe};
 * failures become `VALIDATION_ERROR` (400) with field-level `fields[]`.
 * Query-string values arrive as strings so numerics/dates are coerced.
 */

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be a valid ISO date.' })
  .transform((s) => new Date(s));

const PRODUCT_CODE_VALUES = Object.values(ProductCode) as [ProductCode, ...ProductCode[]];
const LEAD_SOURCE_VALUES = Object.values(LeadSource) as [LeadSource, ...LeadSource[]];

export const GetReportQueryDto = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    branch_id: z.string().uuid({ message: 'branch_id must be a valid UUID.' }).optional(),
    team_id: z.string().uuid({ message: 'team_id must be a valid UUID.' }).optional(),
    owner_id: z.string().uuid({ message: 'owner_id must be a valid UUID.' }).optional(),
    product_code: z
      .enum(PRODUCT_CODE_VALUES, {
        errorMap: () => ({ message: 'product_code is not a valid product code.' }),
      })
      .optional(),
    source: z
      .enum(LEAD_SOURCE_VALUES, {
        errorMap: () => ({ message: 'source is not a valid lead source.' }),
      })
      .optional(),
    partner_id: z.string().uuid({ message: 'partner_id must be a valid UUID.' }).optional(),
    page: z.coerce.number().int().min(1, { message: 'page must be a positive integer.' }).default(1),
    limit: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT, { message: `limit must be between 1 and ${MAX_PAGE_LIMIT}.` })
      .default(DEFAULT_PAGE_LIMIT),
  })
  .superRefine((val, ctx) => {
    if (val.from && val.to && val.from > val.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from must be a valid ISO date and not later than to.',
      });
    }
  });

export type GetReportQueryDto = z.infer<typeof GetReportQueryDto>;

/**
 * The path `code` param for a report — validated separately so unknown codes
 * produce VALIDATION_ERROR (400) with `fields[{field:"code"}]`.
 */
export const ReportCodeParam = z
  .string()
  .refine((s): s is (typeof REPORT_CODES)[number] => (REPORT_CODES as readonly string[]).includes(s), {
    message: `Invalid report code. Allowed: ${REPORT_CODES.join(', ')}.`,
  });

export type ReportCode = typeof REPORT_CODES[number];
