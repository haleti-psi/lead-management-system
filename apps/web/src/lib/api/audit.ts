import { apiClient } from './apiClient';
import type { QueryParams } from './apiClient';
import type {
  AuditFilters,
  AuditPageData,
  AuditPageResult,
  AuditUnmaskRequest,
  AuditUnmaskResult,
  IntegrityBadge,
} from '@/types/audit';

/**
 * FR-123 — typed API wrappers for the audit explorer. `GET /api/v1/audit`
 * returns a full envelope whose `meta` carries the per-page integrity
 * diagnostics (`integrity_checked_count`, `integrity_break_at`) in addition to
 * pagination, so we read it via `getEnvelope` rather than `getPage`. The reveal
 * is `POST /api/v1/audit/unmask` — one field, one row, with a mandatory reason
 * (the server audits the reveal itself and gates it on an active break-glass
 * grant; no grant → FORBIDDEN, surfaced to the caller as an ApiClientError).
 */

/** Page params for the explorer query (LLD §Endpoint: page≥1, 1≤limit≤100). */
export interface AuditPageParams {
  page: number;
  limit: number;
}

/** The integrity diagnostics carried alongside pagination on the response meta. */
interface AuditMetaShape {
  pagination?: { total?: number };
  integrity_checked_count?: number;
  integrity_break_at?: string | null;
}

/**
 * Fetch one page of audit rows from `GET /api/v1/audit`. Returns the masked
 * items, the per-page integrity verdict (badge + checked count + break id), and
 * the total for pagination. Throws `ApiClientError` on any error envelope.
 */
export async function fetchAuditPage(
  filters: AuditFilters,
  page: AuditPageParams,
  signal?: AbortSignal,
): Promise<AuditPageResult> {
  const query: QueryParams = { page: page.page, limit: page.limit };
  if (filters.action) query['action'] = filters.action;
  if (filters.entity_type) query['entity_type'] = filters.entity_type;
  if (filters.actor_id) query['actor_id'] = filters.actor_id;
  if (filters.from) query['from'] = filters.from;
  if (filters.to) query['to'] = filters.to;

  const envelope = await apiClient.getEnvelope<AuditPageData>('/audit', { query, signal });
  const data = envelope.data;
  const meta = envelope.meta as AuditMetaShape | undefined;

  const items = data?.items ?? [];
  const badge: IntegrityBadge = data?.integrity_badge ?? 'not_checked';

  return {
    items,
    integrity: {
      badge,
      checkedCount: meta?.integrity_checked_count ?? items.length,
      breakAt: meta?.integrity_break_at ?? null,
    },
    total: meta?.pagination?.total ?? 0,
  };
}

/**
 * Reveal a single masked PII field on one audit row via `POST /api/v1/audit/unmask`.
 * The reveal is itself audited server-side with the supplied reason; the raw
 * value is returned transiently to the caller and never persisted client-side.
 */
export function unmaskAuditField(body: AuditUnmaskRequest): Promise<AuditUnmaskResult> {
  return apiClient.post<AuditUnmaskResult>('/audit/unmask', body);
}
