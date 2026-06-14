import { z } from 'zod';

/**
 * FR-053 — `GET /dashboard` query-string DTO. Validated by `ZodValidationPipe`
 * before the service sees it. `branch_id` and `team_id` are mutually exclusive;
 * `as_of` must not be in the future.
 */
export const GetDashboardQuerySchema = z
  .object({
    as_of: z
      .string()
      .datetime({ offset: true, message: 'as_of must be an ISO 8601 datetime string.' })
      .refine((v) => new Date(v) <= new Date(), {
        message: 'as_of must not be a future timestamp.',
        path: ['as_of'],
      })
      .optional(),
    branch_id: z.string().uuid({ message: 'branch_id must be a valid UUID.' }).optional(),
    team_id: z.string().uuid({ message: 'team_id must be a valid UUID.' }).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.branch_id !== undefined && val.team_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide branch_id or team_id, not both.',
        path: ['branch_id'],
      });
    }
  });

export type GetDashboardQueryDto = z.infer<typeof GetDashboardQuerySchema>;
