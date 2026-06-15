/**
 * FR-115 — Retention Administration page.
 *
 * Route: /compliance/retention
 * Auth:  DPO (list + dry-run) or ADMIN (list + create + apply).
 *
 * UI tree:
 *   RetentionAdmin
 *     ├── PageHeader ("Retention Policies", actions: [+ New Policy, Trigger Run])
 *     ├── RetentionPolicyTable (server-paginated)
 *     ├── NewPolicyDrawer   (ADMIN only — hidden from DPO)
 *     └── TriggerRunModal
 */

import { useState } from 'react';
import { PlusCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RetentionPolicyTable } from './components/RetentionPolicyTable';
import { NewPolicyDrawer } from './components/NewPolicyDrawer';
import { TriggerRunModal } from './components/TriggerRunModal';
import { useRetentionPolicies } from '@/components/compliance/use-retention-policies';
import type { ListRetentionPoliciesParams } from '@/components/compliance/retention.types';

// ── helpers ───────────────────────────────────────────────────────────────────

interface RetentionAdminProps {
  /** Authenticated user's role — controls "New Policy" visibility and apply access. */
  callerRole?: string;
}

const ADMIN_ROLES = new Set(['ADMIN']);

// ── RetentionAdmin ────────────────────────────────────────────────────────────

export function RetentionAdmin({ callerRole }: RetentionAdminProps): JSX.Element {
  const [params, setParams] = useState<ListRetentionPoliciesParams>({ page: 1, limit: 25 });
  const [newPolicyOpen, setNewPolicyOpen] = useState(false);
  const [triggerRunOpen, setTriggerRunOpen] = useState(false);

  const { data, isLoading, error, refetch } = useRetentionPolicies(params);

  const rows = data?.data ?? [];
  const pagination = {
    page: data?.meta.page ?? 1,
    limit: data?.meta.limit ?? 25,
    total: data?.meta.total ?? 0,
  };

  const canCreate = callerRole ? ADMIN_ROLES.has(callerRole) : false;
  const errorMessage = error instanceof Error ? error.message : error ? 'Failed to load policies.' : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Retention Policies</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Configure data retention, purge, and anonymisation rules for this organisation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTriggerRunOpen(true)}
            aria-label="Trigger retention run"
          >
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Trigger Run
          </Button>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => setNewPolicyOpen(true)}
              aria-label="New retention policy"
            >
              <PlusCircle className="mr-1.5 h-4 w-4" />
              New Policy
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <RetentionPolicyTable
        rows={rows}
        pagination={pagination}
        isLoading={isLoading}
        error={errorMessage}
        onPageChange={(page) => setParams((p) => ({ ...p, page }))}
        onRetry={() => void refetch()}
      />

      {/* Drawers / modals */}
      {canCreate && (
        <NewPolicyDrawer
          open={newPolicyOpen}
          onClose={() => setNewPolicyOpen(false)}
        />
      )}

      <TriggerRunModal
        open={triggerRunOpen}
        onClose={() => setTriggerRunOpen(false)}
        callerRole={callerRole}
      />
    </div>
  );
}
