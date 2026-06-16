/**
 * FR-052 — LeadCard
 *
 * Renders one lead in a Kanban column. Fields: leadCode, masked customerName
 * (via MaskedField pattern — already server-masked so rendered as plain text
 * in a visually-accessible container), productCode, requestedAmount (INR),
 * ageingDays, isHot flame, consent/KYC StatusChips, ownerName, nextActionAt.
 *
 * The card is draggable (`draggable` attribute); DragStart sets the data
 * transfer with leadId + version so KanbanBoard can call the PATCH on drop.
 * On mobile, the stage selector sheet is opened via the "Move" button.
 *
 * Accessibility: the card is role="article" with an aria-label. The flame icon
 * has aria-label="Hot lead". Drag affordance is keyboard-skipped (D&D is a
 * progressive enhancement; the mobile sheet covers non-pointer devices).
 */

import type { DragEvent, ReactElement } from 'react';
import { Flame } from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/workspace/StatusChip';
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
        {/* Header row: code + hot flag */}
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-xs text-muted-foreground">{card.leadCode}</span>
          {card.isHot ? (
            <Flame className="h-4 w-4 shrink-0 text-orange-500 dark:text-orange-400" aria-label="Hot lead" />
          ) : null}
        </div>

        {/* Customer name — already server-masked (FR-002); primary line */}
        <p className="truncate text-sm font-semibold" aria-label="Customer name">
          {card.customerName}
        </p>

        {/* Product + requested amount — amount is the key scannable number */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{card.productCode}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{formatAmount(card.requestedAmount)}</span>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-1">
          <StatusChip status={card.consentStatus} label="Consent" />
          <StatusChip status={card.kycStatus} label="KYC" />
        </div>

        {/* Owner + ageing */}
        <div className="flex items-center justify-between gap-1 text-xs">
          <span className="truncate text-muted-foreground">{card.ownerName ?? 'Unassigned'}</span>
          <span className={cn('shrink-0 font-medium tabular-nums', ageingTone(card.ageingDays))}>
            {card.ageingDays}d
          </span>
        </div>

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
