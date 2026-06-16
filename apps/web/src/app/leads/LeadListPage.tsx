import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Flame, Save, Search, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { MaskedField } from '@/components/ui/MaskedField';
import { DataTable, type DataTableColumn, type SortState } from '@/components/data/DataTable';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/lib/auth/capabilities';
import { isApiClientError } from '@/lib/api';
import { useCreateSavedView, useLeads, useSavedViews } from '@/hooks/use-leads';
import type { LeadListFilters, LeadListItem, SavedView } from '@/types/lead';
import {
  BUILTIN_QUEUES,
  CONSENT_OPTIONS,
  consentTone,
  humanise,
  KYC_OPTIONS,
  kycTone,
  PRIORITY_OPTIONS,
  PRODUCT_OPTIONS,
  SCORE_BAND_OPTIONS,
  SLA_STATE_OPTIONS,
  SORT_FIELD,
  STAGE_OPTIONS,
  stageTone,
  type QueuePreset,
  type SelectOption,
} from './lead-list.constants';

const DEFAULT_LIMIT = 25;
const DEFAULT_SORT = 'created_at:desc';
/** Filter keys the UI controls drive (a subset of the server FILTER_ALLOWLIST). */
const FILTER_KEYS = [
  'stage',
  'product_code',
  'priority',
  'consent_status',
  'kyc_status',
  'score_band',
  'sla_state',
  'owner_id',
  'branch_id',
  'team_id',
  'partner',
  'is_hot',
  'date_from',
  'date_to',
] as const;

/** Read the allow-listed filters out of the URL query (`filter[<key>]=<value>`). */
function readFilters(sp: URLSearchParams): LeadListFilters {
  const filters: LeadListFilters = {};
  for (const key of FILTER_KEYS) {
    const raw = sp.get(`filter[${key}]`);
    if (raw == null) continue;
    if (key === 'is_hot') filters.is_hot = raw === 'true';
    else (filters as Record<string, string>)[key] = raw;
  }
  return filters;
}

/** Are any filters / search currently active? (drives the "Clear" affordance.) */
function hasActiveQuery(filters: LeadListFilters, q: string): boolean {
  return q.trim().length > 0 || Object.values(filters).some((v) => v !== undefined && v !== '');
}

/**
 * FR-050 — Lead List & saved work queues. The core role-scoped work-queue screen
 * (mounts at `/leads`, capability `view_lead`). A server-driven, paginated
 * `DataTable` of scope-filtered, masked leads with free-text search, allow-listed
 * column filters, and saved-view chips (built-in queues + user-saved views via
 * the saved-view API). All state lives in the URL query so dashboard drill-through
 * links apply and views are shareable; the server enforces scope + masking.
 */
export function LeadListPage(): JSX.Element {
  const can = useCan();
  const { user } = useAuth();
  const canView = can('view_lead');

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = React.useState(() => searchParams.get('q') ?? '');
  const [saveOpen, setSaveOpen] = React.useState(false);

  // Derive the query from the URL (single source of truth).
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limit = Number(searchParams.get('limit') ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT;
  const sortParam = searchParams.get('sort') ?? DEFAULT_SORT;
  const q = searchParams.get('q') ?? '';
  const filters = React.useMemo(() => readFilters(searchParams), [searchParams]);

  // Keep the search box in sync if the URL changes externally (e.g. a chip click).
  React.useEffect(() => {
    setSearchInput(searchParams.get('q') ?? '');
  }, [searchParams]);

  const leadsQuery = useLeads({ page, limit, sort: sortParam, q: q || undefined, filters });
  const savedViewsQuery = useSavedViews();
  const result = leadsQuery.data;

  // Map the DataTable sort state ↔ the `<field>:<dir>` URL param.
  const [sortField, sortDir] = sortParam.split(':');
  const sortColumnId = Object.keys(SORT_FIELD).find((id) => SORT_FIELD[id] === sortField) ?? null;
  const sort: SortState | null =
    sortColumnId && (sortDir === 'asc' || sortDir === 'desc')
      ? { columnId: sortColumnId, dir: sortDir }
      : null;

  /** Replace the URL query, resetting to page 1 on any filter/search/sort change. */
  const updateQuery = React.useCallback(
    (mutate: (next: URLSearchParams) => void, resetPage = true): void => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          if (resetPage) next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFilter = (key: keyof LeadListFilters, value: string): void => {
    updateQuery((next) => {
      if (value === '') next.delete(`filter[${key}]`);
      else next.set(`filter[${key}]`, value);
    });
  };

  const applyPreset = (preset: LeadListFilters): void => {
    updateQuery((next) => {
      for (const key of FILTER_KEYS) next.delete(`filter[${key}]`);
      next.delete('q');
      for (const [key, value] of Object.entries(preset)) {
        if (value !== undefined && value !== '') next.set(`filter[${key}]`, String(value));
      }
    });
  };

  const clearAll = (): void => {
    setSearchInput('');
    updateQuery((next) => {
      for (const key of FILTER_KEYS) next.delete(`filter[${key}]`);
      next.delete('q');
    });
  };

  const submitSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    const value = searchInput.trim();
    updateQuery((next) => {
      if (value.length >= 2) next.set('q', value);
      else next.delete('q');
    });
  };

  // "My Leads" needs the caller id (kept out of the static preset table).
  const myLeadsPreset: QueuePreset | null = user
    ? { id: 'my_leads', label: 'My Leads', filters: { owner_id: user.userId } }
    : null;
  const queues: QueuePreset[] = myLeadsPreset ? [myLeadsPreset, ...BUILTIN_QUEUES] : [...BUILTIN_QUEUES];

  const activeQueueId = matchActiveQueue(queues, filters);

  const columns: DataTableColumn<LeadListItem>[] = [
    {
      id: 'lead_code',
      header: 'Lead',
      sortable: true,
      cell: (l) => (
        <Link to={`/leads/${l.lead_id}`} className="font-medium text-primary hover:underline">
          {l.lead_code}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      cell: (l) =>
        l.name_masked ? <span>{l.name_masked}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'mobile',
      header: 'Mobile',
      cell: (l) =>
        l.mobile_masked ? (
          <MaskedField maskedValue={l.mobile_masked} fieldType="mobile" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: 'product_code', header: 'Product', cell: (l) => l.product_code },
    {
      id: 'stage',
      header: 'Stage',
      sortable: true,
      cell: (l) => <StatusChip label={humanise(l.stage)} tone={stageTone(l.stage)} />,
    },
    {
      id: 'score',
      header: 'Score',
      sortable: true,
      cell: (l) =>
        l.score == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {l.is_hot ? <Flame className="h-3.5 w-3.5 text-orange-500" aria-label="Hot lead" /> : null}
            {l.score}
          </span>
        ),
    },
    {
      id: 'consent_status',
      header: 'Consent',
      defaultHidden: true,
      cell: (l) => <StatusChip label={humanise(l.consent_status)} tone={consentTone(l.consent_status)} />,
    },
    {
      id: 'kyc_status',
      header: 'KYC',
      cell: (l) => <StatusChip label={humanise(l.kyc_status)} tone={kycTone(l.kyc_status)} />,
    },
  ];

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don&apos;t have access to the lead list.
        </p>
      </div>
    );
  }

  const errorMessage = leadsQuery.isError
    ? isApiClientError(leadsQuery.error) && leadsQuery.error.status === 403
      ? 'You don’t have access to these leads.'
      : 'Could not load leads.'
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Button variant="outline" onClick={() => setSaveOpen(true)}>
          <Save className="h-4 w-4" aria-hidden />
          Save current view
        </Button>
      </div>

      {/* Saved-view chips: built-in queues + user-saved views */}
      <SavedViewChips
        queues={queues}
        activeQueueId={activeQueueId}
        savedViews={savedViewsQuery.data?.data ?? []}
        onApplyQueue={(preset) => applyPreset(preset.filters)}
        onApplySavedView={(view) => applyPreset(view.filter_json)}
      />

      {/* Free-text search */}
      <form role="search" onSubmit={submitSearch} className="flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, mobile, lead code…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {/* Column filters */}
      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Stage" value={filters.stage ?? ''} onChange={(v) => setFilter('stage', v)} options={STAGE_OPTIONS} />
        <FilterSelect label="Product" value={filters.product_code ?? ''} onChange={(v) => setFilter('product_code', v)} options={PRODUCT_OPTIONS} />
        <FilterSelect label="Priority" value={filters.priority ?? ''} onChange={(v) => setFilter('priority', v)} options={PRIORITY_OPTIONS} />
        <FilterSelect label="Score" value={filters.score_band ?? ''} onChange={(v) => setFilter('score_band', v)} options={SCORE_BAND_OPTIONS} />
        <FilterSelect label="SLA" value={filters.sla_state ?? ''} onChange={(v) => setFilter('sla_state', v)} options={SLA_STATE_OPTIONS} />
        <FilterSelect label="Consent" value={filters.consent_status ?? ''} onChange={(v) => setFilter('consent_status', v)} options={CONSENT_OPTIONS} />
        <FilterSelect label="KYC" value={filters.kyc_status ?? ''} onChange={(v) => setFilter('kyc_status', v)} options={KYC_OPTIONS} />
        {hasActiveQuery(filters, q) ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="h-4 w-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(l) => l.lead_id}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={(p) =>
          updateQuery((next) => next.set('page', String(p)), false)
        }
        onLimitChange={(l) => updateQuery((next) => next.set('limit', String(l)))}
        sort={sort}
        onSortChange={(s) =>
          updateQuery((next) => next.set('sort', `${SORT_FIELD[s.columnId] ?? 'created_at'}:${s.dir}`))
        }
        isLoading={leadsQuery.isLoading}
        error={errorMessage}
        onRetry={() => void leadsQuery.refetch()}
        emptyTitle="No leads match this queue"
        emptyMessage="Try clearing a filter or adjusting your search."
      />

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save current view">
        <SaveViewForm
          filters={filters}
          onSaved={() => {
            setSaveOpen(false);
            toast.success('View saved.');
          }}
          onClose={() => setSaveOpen(false)}
        />
      </Modal>
    </div>
  );
}

/** Find which queue (if any) the current filters exactly match (highlights the chip). */
function matchActiveQueue(queues: QueuePreset[], filters: LeadListFilters): string | null {
  const norm = (f: LeadListFilters): string =>
    JSON.stringify(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').sort());
  const current = norm(filters);
  return queues.find((queue) => norm(queue.filters) === current)?.id ?? null;
}

function SavedViewChips({
  queues,
  activeQueueId,
  savedViews,
  onApplyQueue,
  onApplySavedView,
}: {
  queues: QueuePreset[];
  activeQueueId: string | null;
  savedViews: SavedView[];
  onApplyQueue: (preset: QueuePreset) => void;
  onApplySavedView: (view: SavedView) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Saved work queues">
      {queues.map((queue) => (
        <Chip key={queue.id} active={activeQueueId === queue.id} onClick={() => onApplyQueue(queue)}>
          {queue.label}
        </Chip>
      ))}
      {savedViews.map((view) => (
        <Chip key={view.saved_view_id} onClick={() => onApplySavedView(view)}>
          {view.name}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  children,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
          : 'rounded-full border border-input bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      }
    >
      {children}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<SelectOption>;
}): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveViewForm({
  filters,
  onSaved,
  onClose,
}: {
  filters: LeadListFilters;
  onSaved: () => void;
  onClose: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const createView = useCreateSavedView();
  const [name, setName] = React.useState('');
  const [isShared, setIsShared] = React.useState(false);

  const activeCount = Object.values(filters).filter((v) => v !== undefined && v !== '').length;

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    createView.mutate(
      {
        name: trimmed,
        filter_json: filters,
        is_shared: isShared,
        // Share within the caller's own scope (server rejects a wider share).
        scope: user?.scope ?? 'O',
      },
      {
        onSuccess: onSaved,
        onError: (error) =>
          toast.error(
            isApiClientError(error) && error.code === 'VALIDATION_ERROR'
              ? 'That view could not be saved. Check the name and filters.'
              : 'Could not save the view. Please try again.',
          ),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="saved-view-name" className="text-sm font-medium">
          View name
        </label>
        <Input
          id="saved-view-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="e.g. Hot CV — North"
          required
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {activeCount === 0
          ? 'No filters are active — this view will show all leads in your scope.'
          : `Saves the ${activeCount} active filter${activeCount === 1 ? '' : 's'}.`}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
        Share with my team / scope
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={createView.isPending || name.trim().length === 0}>
          {createView.isPending ? 'Saving…' : 'Save view'}
        </Button>
      </div>
    </form>
  );
}
