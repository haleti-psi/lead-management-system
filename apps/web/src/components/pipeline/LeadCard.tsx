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
      className="cursor-grab select-none active:cursor-grabbing"
      data-testid="lead-card"
      data-lead-id={card.leadId}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header row: code + hot flag */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-mono text-muted-foreground">{card.leadCode}</span>
          {card.isHot ? (
            <Flame className="h-4 w-4 text-orange-500 shrink-0" aria-label="Hot lead" />
          ) : null}
        </div>

        {/* Customer name — already server-masked (FR-002) */}
        <p className="text-sm font-medium truncate" aria-label="Customer name">
          {card.customerName}
        </p>

        {/* Product + amount */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{card.productCode}</span>
          <span aria-hidden>·</span>
          <span>{formatAmount(card.requestedAmount)}</span>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-1">
          <StatusChip status={card.consentStatus} label="Consent" />
          <StatusChip status={card.kycStatus} label="KYC" />
        </div>

        {/* Owner + ageing */}
        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          <span className="truncate">{card.ownerName ?? 'Unassigned'}</span>
          <span className={cn('shrink-0 font-medium', card.ageingDays > 30 ? 'text-destructive' : '')}>
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
            className="md:hidden w-full mt-1 rounded border border-input py-1 text-xs hover:bg-accent"
            onClick={() => onMoveClick(card)}
          >
            Move stage
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
