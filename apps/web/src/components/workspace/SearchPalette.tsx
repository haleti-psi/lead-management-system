// @vitest-environment jsdom
/**
 * FR-054 — Global Search Palette.
 *
 * Implements the search palette as described in FR-054 LLD §UI Component Tree,
 * using a native <dialog> element (AMBIGUITY: cmdk/Command and
 * @radix-ui/react-dialog are not in the dependency register; a minimal native
 * accessible implementation is used instead — see AMBIGUITY.md FR-054 section).
 *
 * Primitives used: native <dialog>, sonner toast (RATE_LIMITED), MaskedField,
 * EmptyState, LoadingSkeleton. TanStack Query via useSearch hook.
 * Debounce: 300 ms. Min query length: 2 chars.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { MaskedField } from '@/components/ui/MaskedField';
import { isApiClientError } from '@/lib/api';
import {
  useSearch,
  type SearchLeadItem,
  type SearchPartnerItem,
  type SearchTaskItem,
} from '@/hooks/use-search';

// ── Debounce helper ───────────────────────────────────────────────────────────

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ── Lead result row ───────────────────────────────────────────────────────────

function LeadRow({ lead, onSelect }: { lead: SearchLeadItem; onSelect: () => void }): ReactElement {
  return (
    <li role="option">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        aria-label={`Lead ${lead.lead_code} ${lead.stage}`}
      >
        <span className="min-w-[120px] font-mono text-xs">{lead.lead_code}</span>
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ring-border">
          {lead.stage}
        </span>
        {lead.applicant_name != null && (
          <span className="flex-1 truncate text-muted-foreground">{lead.applicant_name}</span>
        )}
        {lead.mobile != null && <MaskedField maskedValue={lead.mobile} fieldType="mobile" />}
      </button>
    </li>
  );
}

// ── Partner result row ────────────────────────────────────────────────────────

function PartnerRow({
  partner,
  onSelect,
}: {
  partner: SearchPartnerItem;
  onSelect: () => void;
}): ReactElement {
  return (
    <li role="option">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        aria-label={`Partner ${partner.partner_code} ${partner.legal_name}`}
      >
        <span className="min-w-[80px] font-mono text-xs">{partner.partner_code}</span>
        <span className="flex-1 truncate">{partner.legal_name}</span>
        <span className="text-xs text-muted-foreground">{partner.type}</span>
      </button>
    </li>
  );
}

// ── Task result row ───────────────────────────────────────────────────────────

function TaskRow({
  task,
  onSelect,
}: {
  task: SearchTaskItem;
  onSelect: () => void;
}): ReactElement {
  return (
    <li role="option">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        aria-label={`Task ${task.type} for lead ${task.lead_code}`}
      >
        <span className="text-xs font-medium capitalize">{task.type}</span>
        <span className="font-mono text-xs text-muted-foreground">{task.lead_code}</span>
        <span className="ml-auto text-xs text-muted-foreground">{task.status}</span>
      </button>
    </li>
  );
}

// ── Inner palette — rendered only when open, so hooks always run consistently ─

interface PaletteInnerProps {
  onClose: () => void;
}

function PaletteInner({ onClose }: PaletteInnerProps): ReactElement {
  const [inputValue, setInputValue] = useState('');
  const debouncedQ = useDebounce(inputValue, 300);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount (palette just opened).
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDialogElement>) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const { data, isLoading, error } = useSearch(debouncedQ);

  // Show RATE_LIMITED toast.
  useEffect(() => {
    if (error != null && isApiClientError(error) && error.status === 429) {
      toast.error('Too many attempts. Please wait and try again.');
    }
  }, [error]);

  const handleLeadSelect = useCallback(
    (leadId: string) => {
      navigate(`/leads/${leadId}`);
      onClose();
    },
    [navigate, onClose],
  );

  const handleSeeAllLeads = useCallback(() => {
    navigate(`/leads?q=${encodeURIComponent(debouncedQ)}`);
    onClose();
  }, [navigate, onClose, debouncedQ]);

  const handleSeeAllPartners = useCallback(() => {
    navigate(`/partners?q=${encodeURIComponent(debouncedQ)}`);
    onClose();
  }, [navigate, onClose, debouncedQ]);

  const handleSeeAllTasks = useCallback(() => {
    navigate(`/tasks?q=${encodeURIComponent(debouncedQ)}`);
    onClose();
  }, [navigate, onClose, debouncedQ]);

  const hasLeads = (data?.leads?.length ?? 0) > 0;
  const hasPartners = (data?.partners?.length ?? 0) > 0;
  const hasTasks = (data?.tasks?.length ?? 0) > 0;
  const hasAnyResult = hasLeads || hasPartners || hasTasks;
  const showEmpty =
    debouncedQ.length >= 2 && !isLoading && error == null && data != null && !hasAnyResult;
  const showError = error != null && !(isApiClientError(error) && error.status === 429);

  return (
    /* Backdrop overlay — presentational; click outside closes */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Dialog container — stops click propagation so backdrop click only closes */}
      <dialog
        open
        role="dialog"
        aria-label="Global search"
        aria-modal="true"
        className="pointer-events-auto relative w-full max-w-lg rounded-xl border bg-background p-0 shadow-xl"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="border-b px-3 py-2">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search leads, partners and tasks"
            aria-expanded={hasAnyResult || isLoading}
            aria-autocomplete="list"
            aria-controls="search-results"
            placeholder="Search leads, partners and tasks…"
            className="h-10 w-full bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>

        {/* Results area */}
        <div
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[400px] overflow-y-auto p-2"
        >
          {/* Loading */}
          {isLoading && <LoadingSkeleton rows={3} />}

          {/* Empty state */}
          {showEmpty && (
            <EmptyState title="No results" message={`No results found for "${debouncedQ}".`} />
          )}

          {/* Prompt — less than 2 chars */}
          {debouncedQ.length < 2 && !isLoading && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search…
            </p>
          )}

          {/* Error state (non-rate-limit errors) */}
          {showError && (
            <p role="alert" className="px-3 py-4 text-center text-sm text-destructive">
              Search is unavailable. Please try again.
            </p>
          )}

          {/* Leads group */}
          {hasLeads && (
            <section aria-label="Leads">
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Leads
              </p>
              <ul role="group" aria-label="Lead results">
                {data!.leads.map((lead) => (
                  <LeadRow
                    key={lead.lead_id}
                    lead={lead}
                    onSelect={() => handleLeadSelect(lead.lead_id)}
                  />
                ))}
                <li role="option">
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-1.5 text-left text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={handleSeeAllLeads}
                  >
                    See all leads →
                  </button>
                </li>
              </ul>
            </section>
          )}

          {/* Partners group */}
          {hasPartners && (
            <section aria-label="Partners" className={hasLeads ? 'mt-3' : ''}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Partners
              </p>
              <ul role="group" aria-label="Partner results">
                {data!.partners.map((partner) => (
                  <PartnerRow
                    key={partner.partner_id}
                    partner={partner}
                    onSelect={() => {
                      navigate(`/partners/${partner.partner_id}`);
                      onClose();
                    }}
                  />
                ))}
                <li role="option">
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-1.5 text-left text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={handleSeeAllPartners}
                  >
                    See all partners →
                  </button>
                </li>
              </ul>
            </section>
          )}

          {/* Tasks group */}
          {hasTasks && (
            <section aria-label="Tasks" className={hasLeads || hasPartners ? 'mt-3' : ''}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tasks
              </p>
              <ul role="group" aria-label="Task results">
                {data!.tasks.map((task) => (
                  <TaskRow
                    key={task.task_id}
                    task={task}
                    onSelect={() => {
                      navigate(`/leads/${task.lead_id}`);
                      onClose();
                    }}
                  />
                ))}
                <li role="option">
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-1.5 text-left text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={handleSeeAllTasks}
                  >
                    See all tasks →
                  </button>
                </li>
              </ul>
            </section>
          )}
        </div>
      </dialog>
    </div>
  );
}

// ── SearchPalette — public component; conditionally mounts PaletteInner ──────

export interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * FR-054 Global Search Palette shell.
 * When `open=false` renders nothing (no hook calls in inner component).
 * When `open=true` mounts `PaletteInner` which owns all hooks and the data-fetching.
 */
export function SearchPalette({ open, onClose }: SearchPaletteProps): ReactElement | null {
  if (!open) return null;
  return <PaletteInner onClose={onClose} />;
}
