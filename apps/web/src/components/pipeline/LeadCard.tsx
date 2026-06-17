/**
 * FR-052 — LeadCard
 *
 * Renders one lead in a Kanban column. Core fields come from the contract `Lead`
 * list projection (already server-masked, FR-002): leadCode, masked customerName,
 * productCode, score, is_hot flame, consent/KYC StatusChips. Richer fields
 * (requestedAmount, ownerName, ageingDays, nextActionAt) render only when a
 * projection supplies them — the list endpoint does not, so they are optional.
 *
 * The card is draggable (`draggable` attribute); DragStart sets the data
 * transfer with leadId so KanbanBoard can move it on drop (the optimistic-lock
 * version is fetched just-in-time at drop). On mobile, the stage selector sheet
 * is opened via the "Move" button.
 *
 * Accessibility: the card is role="article" with an aria-label. The flame icon
 * has aria-label="Hot lead". Drag affordance is keyboard-skipped (D&D is a
 * progressive enhancement; the mobile sheet covers non-pointer devices).
 */

import type { DragEvent, ReactElement } from 'react';
import { Flame } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/StatusChip';
import { cn } from '@/lib/utils';
import type { PipelineLeadCard } from './pipeline-board.types';

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function formatAmount(amount: string | null): string {
  if (!amount) return '—';
  const n = Number(amount);
  return Number.isFinite(n) ? INR.format(n) : amount;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM, HH:mm');
  } catch {
    return iso;
  }
}

/** Ageing colour tiers: calm under 2 weeks, amber 15–30d, destructive past 30d. */
function ageingTone(days: number): string {
  if (days > 30) return 'text-destructive';
  if (days > 14) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export interface LeadCardProps {
  card: PipelineLeadCard;
  onDragStart?: (e: DragEvent<HTMLDivElement>, card: PipelineLeadCard) => void;
  /** Mobile stage move button handler. */
  onMoveClick?: (card: PipelineLeadCard) => void;
}

export function LeadCard({ card, onDragStart, onMoveClick }: LeadCardProps): ReactElement {
  const hasAmount = card.requestedAmount !== undefined && card.requestedAmount !== null;
  const hasOwner = card.ownerName !== undefined;
  const hasAgeing = card.ageingDays !== undefined;

  return (
    <Card
      role="article"
      aria-label={`Lead ${card.leadCode}`}
      draggable
      onDragStart={onDragStart ? (e) => onDragStart(e, card) : undefined}
      className="cursor-grab select-none transition-colors hover:border-foreground/20 hover:bg-accent/40 active:cursor-grabbing"
      data-testid="lead-card"
      data-lead-id={card.leadId}
    >
      <CardContent className="space-y-2 p-3">
        {/* Header row: code + score + hot flag */}
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-xs text-muted-foreground">{card.leadCode}</span>
          <div className="flex items-center gap-1.5">
            {card.score != null ? (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
                aria-label={`Score ${card.score}`}
              >
                {card.score}
              </span>
            ) : null}
            {card.isHot ? (
              <Flame className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400" aria-label="Hot lead" />
            ) : null}
          </div>
        </div>

        {/* Customer name — already server-masked (FR-002); primary line */}
        <p className="truncate text-sm font-semibold" aria-label="Customer name">
          {card.customerName}
        </p>

        {/* Product + (optional) requested amount */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{card.productCode}</span>
          {hasAmount ? (
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatAmount(card.requestedAmount ?? null)}
            </span>
          ) : null}
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-1">
          <StatusChip status={card.consentStatus} label="Consent" />
          <StatusChip status={card.kycStatus} label="KYC" />
        </div>

        {/* Owner + ageing (only when the projection supplies them) */}
        {hasOwner || hasAgeing ? (
          <div className="flex items-center justify-between gap-1 text-xs">
            {hasOwner ? (
              <span className="truncate text-muted-foreground">{card.ownerName ?? 'Unassigned'}</span>
            ) : (
              <span />
            )}
            {hasAgeing ? (
              <span className={cn('shrink-0 font-medium tabular-nums', ageingTone(card.ageingDays ?? 0))}>
                {card.ageingDays}d
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Next action */}
        {card.nextActionAt ? (
          <p className="text-xs text-muted-foreground">
            Next: <time dateTime={card.nextActionAt}>{formatDate(card.nextActionAt)}</time>
          </p>
        ) : null}

        {/* Mobile move button (hidden on md+ where D&D is available) */}
        {onMoveClick ? (
          <button
            type="button"
            className="mt-1 w-full rounded border border-input py-1 text-xs hover:bg-accent md:hidden"
            onClick={() => onMoveClick(card)}
          >
            Move stage
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
