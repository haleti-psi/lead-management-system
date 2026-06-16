import { useState } from 'react';
import { X } from 'lucide-react';

import { AuditAction } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuditFilters } from '@/types/audit';

/**
 * FR-123 — audit explorer filter bar (LLD §UI Component Tree). Emits the applied
 * filter set to the host (which owns the query + pagination). Every control has a
 * visible <label> (WCAG 2.1 AA — never placeholder-only). On mobile the controls
 * stack; on ≥sm they flow inline.
 *
 * `lead_id` is intentionally NOT offered here: the explorer is DPO/ADMIN-only and
 * ADMIN is forbidden from filtering by lead (server returns 403). Lead-scoped
 * audit lookups are reached from the Lead 360 view, not this cross-cutting bar.
 */

/**
 * Canonical entity types accepted by the `entity_type` filter — a UI mirror of
 * the server allow-list (apps/api/src/modules/reporting/reporting.constants.ts
 * `ENTITY_TYPE_ALLOWLIST`). Anything outside it is rejected by the API as a
 * VALIDATION_ERROR, so the dropdown only ever offers valid values.
 */
const ENTITY_TYPES: readonly string[] = [
  'leads',
  'users',
  'roles',
  'consent_records',
  'stage_history',
  'documents',
  'kyc_verifications',
  'export_jobs',
  'configuration_versions',
  'break_glass_grants',
  'partners',
  'tasks',
  'grievances',
  'data_rights_requests',
  'import_jobs',
  'communication_logs',
  'dla_registry',
];

const ACTION_OPTIONS: readonly AuditAction[] = Object.values(AuditAction);

/** A blank, fully-cleared filter form. */
const EMPTY: Required<Pick<AuditFilters, 'from' | 'to' | 'actor_id'>> & {
  action: string;
  entity_type: string;
} = {
  action: '',
  entity_type: '',
  actor_id: '',
  from: '',
  to: '',
};

export interface AuditFilterBarProps {
  onApply: (filters: AuditFilters) => void;
}

const fieldClass = 'flex flex-col gap-1';

export function AuditFilterBar({ onApply }: AuditFilterBarProps): JSX.Element {
  const [form, setForm] = useState(EMPTY);

  function buildFilters(state: typeof EMPTY): AuditFilters {
    const next: AuditFilters = {};
    if (state.action) next.action = state.action as AuditAction;
    if (state.entity_type) next.entity_type = state.entity_type;
    if (state.actor_id.trim()) next.actor_id = state.actor_id.trim();
    if (state.from) next.from = state.from;
    if (state.to) next.to = state.to;
    return next;
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onApply(buildFilters(form));
  }

  function handleClear(): void {
    setForm(EMPTY);
    onApply({});
  }

  return (
    <form
      role="search"
      aria-label="Audit filters"
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className={fieldClass}>
        <Label htmlFor="audit-action">Action</Label>
        <select
          id="audit-action"
          aria-label="Filter by action"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={form.action}
          onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <Label htmlFor="audit-entity-type">Entity type</Label>
        <select
          id="audit-entity-type"
          aria-label="Filter by entity type"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={form.entity_type}
          onChange={(e) => setForm((f) => ({ ...f, entity_type: e.target.value }))}
        >
          <option value="">All entities</option>
          {ENTITY_TYPES.map((entity) => (
            <option key={entity} value={entity}>
              {entity}
            </option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <Label htmlFor="audit-from">From</Label>
        <Input
          id="audit-from"
          type="date"
          className="sm:w-40"
          value={form.from}
          max={form.to || undefined}
          onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
        />
      </div>

      <div className={fieldClass}>
        <Label htmlFor="audit-to">To</Label>
        <Input
          id="audit-to"
          type="date"
          className="sm:w-40"
          value={form.to}
          min={form.from || undefined}
          onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
        />
      </div>

      <div className={fieldClass}>
        <Label htmlFor="audit-actor">Actor ID</Label>
        <Input
          id="audit-actor"
          type="text"
          inputMode="text"
          placeholder="UUID"
          className="sm:w-64"
          value={form.actor_id}
          onChange={(e) => setForm((f) => ({ ...f, actor_id: e.target.value }))}
        />
      </div>

      <div className="flex items-end gap-2">
        <Button type="submit">Apply filters</Button>
        <Button type="button" variant="outline" onClick={handleClear}>
          <X className="h-4 w-4" aria-hidden />
          Clear
        </Button>
      </div>
    </form>
  );
}
