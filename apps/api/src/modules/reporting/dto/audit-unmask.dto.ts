import { z } from 'zod';

import { AUDIT_DETAIL_PII_FIELDS, AUDIT_DETAIL_REDACT_FIELDS } from '../reporting.constants';

/** The PII `detail` keys that may be individually unmasked (format + redact sets). */
const UNMASKABLE_FIELDS = [
  ...Object.keys(AUDIT_DETAIL_PII_FIELDS),
  ...AUDIT_DETAIL_REDACT_FIELDS,
] as [string, ...string[]];

/**
 * FR-123 / FR-003 — `POST /api/v1/audit/unmask` body. A privileged, single-field
 * reveal of ONE PII value from ONE audit row's `detail`. Deliberately scalar (no
 * arrays / no row lists): the endpoint can never bulk-unmask — each reveal is one
 * field on one record, separately audited with the supplied `reason`.
 */
export const AuditUnmaskDto = z.object({
  audit_id: z.string().uuid({ message: 'audit_id must be a valid UUID.' }),
  field: z.enum(UNMASKABLE_FIELDS, {
    errorMap: () => ({ message: 'field is not an unmaskable PII attribute.' }),
  }),
  reason: z
    .string()
    .trim()
    .min(10, { message: 'reason must be at least 10 characters.' })
    .max(500, { message: 'reason must be at most 500 characters.' }),
});

export type AuditUnmaskDto = z.infer<typeof AuditUnmaskDto>;
