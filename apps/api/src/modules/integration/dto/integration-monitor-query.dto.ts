import { z } from 'zod';

import {
  IntegrationDirection,
  IntegrationKind,
  IntegrationStatus,
} from '@lms/shared';

import { PaginationParams } from '../../../core/common';

/** Allowed sort tokens for the integration monitor (LLD §Endpoints). */
export const INTEGRATION_SORTS = ['-created_at', 'created_at', '-retry_count'] as const;
export type IntegrationSort = (typeof INTEGRATION_SORTS)[number];

/**
 * Query schema for `GET /admin/integrations` (LLD §Validation Logic —
 * IntegrationMonitorQuerySchema). Extends the shared {@link PaginationParams}
 * (page ≥ 1 default 1; limit 1..100 default 25 — the server always applies a
 * LIMIT). Filter keys are bracketed exactly as the contract spells them; all are
 * optional. Unknown sort values are rejected (defence against SQL-shaped input).
 */
export const IntegrationMonitorQuerySchema = PaginationParams.extend({
  'filter[integration]': z.nativeEnum(IntegrationKind).optional(),
  'filter[status]': z.nativeEnum(IntegrationStatus).optional(),
  'filter[direction]': z.nativeEnum(IntegrationDirection).optional(),
  'filter[lead_id]': z.string().uuid().optional(),
  sort: z.enum(INTEGRATION_SORTS).default('-created_at'),
});

export type IntegrationMonitorQueryDto = z.infer<typeof IntegrationMonitorQuerySchema>;

/** Normalised filter set the service/repository consume (camelCase, no brackets). */
export interface IntegrationLogFilters {
  integration?: IntegrationKind;
  status?: IntegrationStatus;
  direction?: IntegrationDirection;
  leadId?: string;
}

/** Map the bracketed query DTO to the internal filter shape. */
export function toLogFilters(query: IntegrationMonitorQueryDto): IntegrationLogFilters {
  return {
    integration: query['filter[integration]'],
    status: query['filter[status]'],
    direction: query['filter[direction]'],
    leadId: query['filter[lead_id]'],
  };
}
