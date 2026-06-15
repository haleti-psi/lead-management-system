import { z } from 'zod';

import { DataScope, MaskingLevel } from '@lms/shared';

import { REPORT_CODES } from '../reporting.constants';

const DATA_SCOPE_VALUES = Object.values(DataScope) as [DataScope, ...DataScope[]];
const MASKING_LEVEL_VALUES = Object.values(MaskingLevel) as [MaskingLevel, ...MaskingLevel[]];

/**
 * FR-122 — Zod DTO for `POST /api/v1/exports`.
 * Validates shape; role-level masking enforcement and scope checks run in ExportService.
 */
export const CreateExportDto = z.object({
  report_code: z
    .string()
    .min(1, { message: 'report_code is required and must be a recognised report code.' })
    .max(60, { message: 'report_code is required and must be a recognised report code.' })
    .refine((v) => (REPORT_CODES as readonly string[]).includes(v), {
      message: 'report_code is required and must be a recognised report code.',
    }),
  filters: z.record(z.unknown()).default({}),
  scope: z.enum(DATA_SCOPE_VALUES, {
    errorMap: () => ({ message: 'scope must be a valid data scope code.' }),
  }),
  masking_level: z.enum(MASKING_LEVEL_VALUES, {
    errorMap: () => ({ message: 'masking_level must be full, partial, or unmasked.' }),
  }),
  purpose: z
    .string()
    .min(1, { message: 'purpose is required.' })
    .max(255, { message: 'purpose is required.' }),
});

export type CreateExportDto = z.infer<typeof CreateExportDto>;
