import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import type { AuditIntegrityMeta, IntegrityBadge as IntegrityBadgeValue } from '@/types/audit';

/**
 * FR-123 — per-page hash-chain integrity indicator (LLD §UI Component Tree).
 * Reads the verdict from the response `meta`/`data` and renders it as a
 * {@link StatusChip}. It is informational and NON-BLOCKING: a broken chain is
 * surfaced loudly (destructive tone + the offending record id) but the rows are
 * never hidden — evidence must always be shown. Wrapped in `role="status"` so a
 * screen reader announces the verdict when it changes.
 */

const TONE: Readonly<Record<IntegrityBadgeValue, ChipTone>> = {
  intact: 'success',
  broken: 'danger',
  not_checked: 'neutral',
};

const ICON: Readonly<Record<IntegrityBadgeValue, typeof ShieldCheck>> = {
  intact: ShieldCheck,
  broken: ShieldAlert,
  not_checked: ShieldQuestion,
};

function label(integrity: AuditIntegrityMeta): string {
  switch (integrity.badge) {
    case 'intact':
      return `Chain intact (${integrity.checkedCount} records verified)`;
    case 'broken':
      return integrity.breakAt
        ? `Chain break at record ${integrity.breakAt}`
        : 'Chain break detected';
    case 'not_checked':
    default:
      return 'Too few records to verify';
  }
}

export function IntegrityBadge({ integrity }: { integrity: AuditIntegrityMeta }): JSX.Element {
  const Icon = ICON[integrity.badge];
  const text = label(integrity);
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2"
      data-integrity={integrity.badge}
    >
      <Icon
        className={
          integrity.badge === 'broken'
            ? 'h-4 w-4 text-red-600 dark:text-red-400'
            : integrity.badge === 'intact'
              ? 'h-4 w-4 text-green-600 dark:text-green-400'
              : 'h-4 w-4 text-muted-foreground'
        }
        aria-hidden
      />
      <StatusChip label={text} tone={TONE[integrity.badge]} className="normal-case" />
    </div>
  );
}
