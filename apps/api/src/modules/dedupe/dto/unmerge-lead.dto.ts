import { z } from 'zod';

/**
 * FR-021 — `POST /leads/{id}/unmerge` request body (LLD §Validation Logic).
 * Window enforcement (`MERGE_UNMERGE_WINDOW_HOURS`) is a service-layer check.
 */
export const UnmergeLeadDto = z.object({
  reason: z
    .string({ required_error: 'Reason is required (max 500 characters)' })
    .min(1, 'Reason is required (max 500 characters)')
    .max(500, 'Reason is required (max 500 characters)'),
  expected_master_version: z
    .number({ required_error: 'expected_master_version must be a positive integer' })
    .int('expected_master_version must be a positive integer')
    .positive('expected_master_version must be a positive integer'),
});
export type UnmergeLeadDto = z.infer<typeof UnmergeLeadDto>;

/** `POST /leads/{id}/unmerge` 200 response `data` (LLD §Endpoints). */
export interface UnmergeLeadResponseDto {
  unmerged_lead_id: string;
  master_lead_id: string;
  unmerge_completed_at: string;
  attribution_records_restored: number;
  documents_restored: number;
  consent_records_restored: number;
  tasks_restored: number;
}
