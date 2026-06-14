import { z } from 'zod';

import { ScanStatus } from '@lms/shared';

/**
 * FR-070 — internal Cloud Tasks scan-result webhook body for
 * `POST /internal/documents/{did}/scan-result` (LLD §Virus scan async callback).
 * Only the terminal verdicts are accepted (`clean` | `infected`); `pending` is
 * the initial state and is never a callback result.
 */
export const ScanResultDto = z.object({
  status: z.enum([ScanStatus.CLEAN, ScanStatus.INFECTED], {
    errorMap: () => ({ message: 'scan status must be clean or infected.' }),
  }),
});
export type ScanResultDto = z.infer<typeof ScanResultDto>;
