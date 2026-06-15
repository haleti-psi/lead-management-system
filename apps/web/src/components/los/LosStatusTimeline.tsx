import { type ReactElement } from 'react';

import { StatusChip } from '@/components/workspace/StatusChip';
import { formatStatusDate } from './LosStatusPanel';
import type { LosStatusEntry } from './los-status.types';

/**
 * FR-082 — LOS Status Timeline.
 *
 * Chronological list of all LOS mirror entries for a lead, newest first
 * (max 25 returned by backend LIMIT). Each entry shows:
 *   - StatusChip with role="status" + aria-label (WCAG 2.1 AA 4.1.3).
 *   - status_date formatted in IST (dd-MM-yyyy HH:mm).
 *   - received_via label: "Webhook" or "Reconciliation poll" (U02).
 *
 * No write actions — read-only display.
 */
export function LosStatusTimeline({ entries }: { entries: LosStatusEntry[] }): ReactElement {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No status history.</p>;
  }

  return (
    <ul className="space-y-2" aria-label="LOS status history">
      {entries.map((entry) => (
        <li
          key={entry.losMirrorId}
          className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
        >
          {/*
           * role="status" on the span satisfies WCAG 4.1.3 — status messages.
           * aria-label provides the full "LOS status: <value>" for screen readers (U01).
           */}
          <span
            role="status"
            aria-label={`LOS status: ${entry.status}`}
          >
            <StatusChip status={entry.status} />
          </span>
          <span className="text-xs text-muted-foreground">
            {formatStatusDate(entry.statusDate)}
          </span>
          <span className="text-xs text-muted-foreground">
            {entry.receivedVia === 'poll' ? 'Reconciliation poll' : 'Webhook'}
          </span>
        </li>
      ))}
    </ul>
  );
}
