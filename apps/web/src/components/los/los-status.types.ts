/**
 * FR-082 — Shared type definitions for the LOS Status Panel and Timeline.
 */

/** Mirror row shape returned by GET /api/v1/leads/{id}/los-status. */
export interface LosStatusEntry {
  losMirrorId: string;
  leadId: string;
  losApplicationId: string;
  status: string;
  statusDate: string;
  receivedVia: 'webhook' | 'poll';
  correlationId: string | null;
  createdAt: string;
}

/** API response type for the los-status read endpoint. */
export type LosStatusResponse = LosStatusEntry[];
