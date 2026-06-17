import { useState, type ReactElement } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { Button } from '@/components/ui/button';

import type { TemplateDto, TemplateFilters, CommChannel, CommCategory, ConfigStatus } from './use-templates';
import { useTemplates } from './use-templates';
import { TemplateCreateModal } from './TemplateCreateModal';
import { TemplateBodyDrawer } from './TemplateBodyDrawer';

// ── Sub-components ────────────────────────────────────────────────────────────

const CONFIG_STATUS_LABEL: Record<ConfigStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  retired: 'Retired',
};

const CONFIG_STATUS_COLOUR: Record<ConfigStatus, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-amber-950 dark:text-amber-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  retired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function StatusChip({ status }: { status: ConfigStatus }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIG_STATUS_COLOUR[status]}`}
    >
      {CONFIG_STATUS_LABEL[status]}
    </span>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const CHANNELS: CommChannel[] = ['in_app', 'email', 'sms', 'whatsapp'];
const CATEGORIES: CommCategory[] = ['transactional', 'marketing'];
const STATUSES: ConfigStatus[] = ['draft', 'active', 'retired'];

interface FilterBarProps {
  filters: TemplateFilters;
  onFilterChange: (f: Partial<TemplateFilters>) => void;
}

function FilterBar({ filters, onFilterChange }: FilterBarProps): ReactElement {
  return (
    <div className="flex flex-wrap gap-3 py-3">
      <select
        aria-label="Channel filter"
        className="rounded border px-2 py-1 text-sm"
        value={filters.channel ?? ''}
        onChange={(e) =>
          onFilterChange({ channel: (e.target.value as CommChannel) || undefined })
        }
      >
        <option value="">All Channels</option>
        {CHANNELS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        aria-label="Category filter"
        className="rounded border px-2 py-1 text-sm"
        value={filters.category ?? ''}
        onChange={(e) =>
          onFilterChange({ category: (e.target.value as CommCategory) || undefined })
        }
      >
        <option value="">All Categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        aria-label="Status filter"
        className="rounded border px-2 py-1 text-sm"
        value={filters.status ?? ''}
        onChange={(e) =>
          onFilterChange({ status: (e.target.value as ConfigStatus) || undefined })
        }
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {CONFIG_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

/**
 * FR-101 — Admin template list page.
 * GET /api/v1/admin/templates — paginated, filterable.
 */
export function TemplateListPage(): ReactElement {
  const [filters, setFilters] = useState<TemplateFilters>({ page: 1, limit: 25 });
  const [showCreate, setShowCreate] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateDto | null>(null);

  const { data, isLoading, isError, refetch } = useTemplates(filters);

  function handleFilterChange(partial: Partial<TemplateFilters>): void {
    setFilters((prev) => ({ ...prev, ...partial, page: 1 }));
  }

  const columns: DataTableColumn<TemplateDto>[] = [
    { id: 'code', header: 'Code', cell: (r) => r.code },
    { id: 'version', header: 'Version', cell: (r) => String(r.version) },
    { id: 'channel', header: 'Channel', cell: (r) => r.channel },
    { id: 'language', header: 'Language', cell: (r) => r.language },
    { id: 'category', header: 'Category', cell: (r) => r.category },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusChip status={r.status} />,
    },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPreviewTemplate(r)}
        >
          View body
        </Button>
      ),
    },
  ];

  if (isLoading) return <LoadingSkeleton />;
  if (isError) return <ErrorState onRetry={refetch} />;

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Communication Templates"
        description="SMS / email / WhatsApp message templates (versioned, consent-gated)."
        actions={<Button onClick={() => setShowCreate(true)}>New Template</Button>}
      />

      <FilterBar filters={filters} onFilterChange={handleFilterChange} />

      {data == null || data.data.length === 0 ? (
        <EmptyState message="No templates found." />
      ) : (
        <DataTable
          columns={columns}
          rows={data.data}
          getRowId={(r) => r.template_id}
          pagination={{
            page: filters.page ?? 1,
            limit: filters.limit ?? 25,
            total: data.meta.total,
          }}
          onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
        />
      )}

      {showCreate ? (
        <TemplateCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      ) : null}

      {previewTemplate != null ? (
        <TemplateBodyDrawer
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />
      ) : null}
    </div>
  );
}
