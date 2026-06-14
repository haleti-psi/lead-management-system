import { z } from 'zod';

/**
 * FR-111 — query params for `GET /leads/{id}/sharing-logs`.
 * Default page = 1, default limit = 25, max limit = 100 (performance.md /
 * LLD §Validation). Validated by ZodValidationPipe in the controller.
 */
export const ListSharingLogsQuery = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v != null ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v != null ? parseInt(v, 10) : 25))
    .pipe(z.number().int().min(1).max(100)),
});

export type ListSharingLogsQuery = z.infer<typeof ListSharingLogsQuery>;
