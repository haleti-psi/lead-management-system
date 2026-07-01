import * as React from 'react';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  EventCode,
  IntegrationDirection,
  IntegrationKind,
  IntegrationStatus,
} from '@lms/shared';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionTabs } from '@/components/workspace/SectionTabs';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { useCan } from '@/lib/auth/capabilities';
import { cn } from '@/lib/utils';
import {
  useCreateWebhook,
  INTEGRATION_LOG_DEFAULT_SORT,
  useIntegrationLogs,
  useWebhooks,
  type IntegrationLog,
  type IntegrationLogFilters,
  type Webhook,
} from '@/hooks/use-integrations';

/** "los_push" / "LEAD_CREATED" → "Los push" / "Lead created" — normalise an
 * opaque enum value (lowercase then sentence-case, so UPPER_SNAKE isn't shouted). */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

interface Option {
  value: string;
  label: string;
}
const allOption = (text: string): Option => ({ value: '', label: text });
const fromEnum = (e: Record<string, string>): Option[] =>
  Object.values(e).map((v) => ({ value: v, label: humanize(v) }));

/** Integration / delivery status → chip tone (substring-robust to enum spelling). */
function statusTone(status: string): ChipTone {
  const v = status.toLowerCase();
  if (v.includes('success') || v.includes('delivered')) return 'success';
  if (v.includes('fail')) return 'danger';
  if (v.includes('retry')) return 'warning';
  if (v.includes('pending') || v.includes('queued') || v.includes('sent')) return 'progress';
  return 'neutral';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * FR-140 §UI — Integration console (M15), mounted at `/admin/integrations`
 * (capability `configuration`; server also enforces scope A → ADMIN/HEAD, so a
 * branch-scoped holder sees the table's FORBIDDEN error state). Two tabs: the
 * integration activity log (filterable, paginated) and webhook subscriptions
 * (list + register). `secret_ref` is never shown — the API never returns it.
 */
export function IntegrationsPage(): JSX.Element {
  const can = useCan();

  if (!can('configuration')) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground" role="status">
          You don&apos;t have access to integration administration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/admin"
        backLabel="Configuration"
        title="Integrations"
        description="Monitor external integration activity and manage webhook subscriptions."
      />
      <SectionTabs
        ariaLabel="Integration sections"
        tabs={[
          { id: 'activity', label: 'Activity log', content: <ActivityLogTab /> },
          { id: 'webhooks', label: 'Webhooks', content: <WebhooksTab /> },
        ]}
      />
    </div>
  );
}

function ActivityLogTab(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [filters, setFilters] = React.useState<IntegrationLogFilters>({});

  const query = useIntegrationLogs({ page, limit, filters, sort: INTEGRATION_LOG_DEFAULT_SORT });
  const result = query.data;

  const setFilter = (key: keyof IntegrationLogFilters, value: string): void => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setPage(1);
  };

  const columns: DataTableColumn<IntegrationLog>[] = [
    { id: 'createdAt', header: 'Time', cell: (r) => <span className="whitespace-nowrap">{formatWhen(r.createdAt)}</span> },
    { id: 'integration', header: 'Integration', cell: (r) => humanize(r.integration) },
    {
      id: 'direction',
      header: 'Direction',
      cell: (r) => <StatusChip label={humanize(r.direction)} tone="info" />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusChip label={humanize(r.status)} tone={statusTone(r.status)} />,
    },
    { id: 'httpStatus', header: 'HTTP', cell: (r) => (r.httpStatus == null ? '—' : <span className="tabular-nums">{r.httpStatus}</span>) },
    { id: 'retryCount', header: 'Retries', cell: (r) => <span className="tabular-nums">{r.retryCount}</span> },
    { id: 'errorCode', header: 'Error', cell: (r) => r.errorCode ?? '—' },
    {
      id: 'correlationId',
      header: 'Correlation',
      defaultHidden: true,
      cell: (r) => <span className="font-mono text-xs">{r.correlationId}</span>,
    },
    {
      id: 'leadId',
      header: 'Lead',
      defaultHidden: true,
      cell: (r) => <span className="font-mono text-xs">{r.leadId ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Integration"
          value={filters.integration ?? ''}
          onChange={(v) => setFilter('integration', v)}
          options={[allOption('All integrations'), ...fromEnum(IntegrationKind)]}
        />
        <FilterSelect
          label="Status"
          value={filters.status ?? ''}
          onChange={(v) => setFilter('status', v)}
          options={[allOption('All statuses'), ...fromEnum(IntegrationStatus)]}
        />
        <FilterSelect
          label="Direction"
          value={filters.direction ?? ''}
          onChange={(v) => setFilter('direction', v)}
          options={[allOption('All directions'), ...fromEnum(IntegrationDirection)]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(r) => r.integrationLogId}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load integration activity.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No integration activity"
        emptyMessage="No outbound/inbound calls match the current filters."
      />
    </div>
  );
}

function WebhooksTab(): JSX.Element {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(25);
  const [createOpen, setCreateOpen] = React.useState(false);

  const query = useWebhooks(page, limit);
  const result = query.data;

  const columns: DataTableColumn<Webhook>[] = [
    { id: 'eventCode', header: 'Event', cell: (r) => humanize(r.eventCode) },
    {
      id: 'targetUrl',
      header: 'Target URL',
      cell: (r) => <span className="font-mono text-xs">{r.targetUrl}</span>,
    },
    {
      id: 'isActive',
      header: 'Status',
      cell: (r) => (
        <StatusChip label={r.isActive ? 'Active' : 'Inactive'} tone={r.isActive ? 'success' : 'neutral'} />
      ),
    },
    {
      id: 'lastStatus',
      header: 'Last delivery',
      cell: (r) => (r.lastStatus ? <StatusChip label={humanize(r.lastStatus)} tone={statusTone(r.lastStatus)} /> : '—'),
    },
    { id: 'createdAt', header: 'Created', cell: (r) => <span className="whitespace-nowrap">{formatWhen(r.createdAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          New webhook
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={result?.data ?? []}
        getRowId={(r) => r.webhookSubscriptionId}
        pagination={{ page, limit, total: result?.pagination?.total ?? 0 }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        isLoading={query.isLoading}
        error={query.isError ? 'Could not load webhooks.' : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No webhooks yet"
        emptyMessage="Register a webhook to receive event notifications."
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Register webhook">
        <CreateWebhookForm onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  );
}

const WebhookSchema = z.object({
  eventCode: z.string().min(1, 'Select an event'),
  targetUrl: z
    .string()
    .min(10, 'Enter the target URL')
    .refine((v) => v.startsWith('https://'), 'Must begin with https://'),
  secretRef: z
    .string()
    .min(10, 'Enter the Secret Manager path')
    .refine((v) => v.startsWith('projects/'), 'Must be a Secret Manager path (projects/…)'),
});
type WebhookValues = z.infer<typeof WebhookSchema>;

function CreateWebhookForm({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useCreateWebhook();
  // One key per form mount → a user-driven retry replays instead of duplicating.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());
  return (
    <EntityForm<WebhookValues>
      schema={WebhookSchema}
      defaultValues={{ eventCode: '', targetUrl: '', secretRef: '' }}
      submitLabel="Register webhook"
      onSubmit={async (values) => {
        await create.mutateAsync({ body: values, idempotencyKey });
        toast.success('Webhook registered.');
        onClose();
      }}
      onError={() => toast.error('Could not register the webhook. Please try again.')}
    >
      <FormSelect
        name="eventCode"
        label="Event"
        required
        placeholder="Select an event…"
        options={fromEnum(EventCode)}
      />
      <FormField name="targetUrl" label="Target URL" placeholder="https://…" required />
      <FormField
        name="secretRef"
        label="Secret reference"
        placeholder="projects/…/secrets/…/versions/latest"
        required
      />
    </EntityForm>
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
  options: ReadonlyArray<Option>;
}): JSX.Element {
  const active = value !== '';
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        className={cn(
          'h-9 rounded-md border bg-background px-2 text-sm transition-colors',
          active ? 'border-primary text-foreground ring-1 ring-primary/30' : 'border-input text-muted-foreground',
        )}
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
