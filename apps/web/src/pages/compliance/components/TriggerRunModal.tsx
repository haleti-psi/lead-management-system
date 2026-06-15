/**
 * FR-115 — Modal for triggering a retention run (dry-run or apply).
 * apply mode: ADMIN/system only (enforced at API; this UI also disables it for DPO).
 * dry_run mode: available to DPO and ADMIN.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { DryRunPreviewPanel } from './DryRunPreviewPanel';
import { useRetentionRun } from '@/components/compliance/use-retention-run';
import type { DataCategory, RetentionMode, DryRunPreview } from '@/components/compliance/retention.types';
import { DATA_CATEGORY_LABELS } from '@/components/compliance/retention.types';

// ── inline confirm for destructive apply ──────────────────────────────────────

interface ApplyConfirmProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ApplyConfirm({ open, onConfirm, onCancel }: ApplyConfirmProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-red-700">This action is irreversible</h3>
        <p className="mb-4 text-sm text-gray-700">
          All eligible leads will have their data permanently purged or anonymised.
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Apply Retention
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── TriggerRunModal ───────────────────────────────────────────────────────────

interface TriggerRunModalProps {
  open: boolean;
  onClose: () => void;
  /** Caller's role — used to hide/disable apply mode for DPO. */
  callerRole?: string;
}

const DATA_CATEGORIES = ['', ...Object.keys(DATA_CATEGORY_LABELS)] as (DataCategory | '')[];
const ADMIN_ROLES = new Set(['ADMIN']);

export function TriggerRunModal({ open, onClose, callerRole }: TriggerRunModalProps): JSX.Element | null {
  const [mode, setMode] = useState<RetentionMode>('dry_run');
  const [dataCategory, setDataCategory] = useState<DataCategory | ''>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRunPreview, setDryRunPreview] = useState<DryRunPreview | null>(null);

  const runMutation = useRetentionRun();
  const canApply = callerRole ? ADMIN_ROLES.has(callerRole) : false;

  if (!open) return null;

  const handleRun = (): void => {
    if (mode === 'apply') {
      setConfirmOpen(true);
      return;
    }
    submitRun();
  };

  const submitRun = (): void => {
    setConfirmOpen(false);
    setDryRunPreview(null);

    runMutation.mutate(
      {
        mode,
        data_category: dataCategory || undefined,
      },
      {
        onSuccess: (res) => {
          if (mode === 'dry_run' && res.data.preview) {
            setDryRunPreview(res.data.preview);
          } else {
            toast.success(`Retention ${mode === 'apply' ? 'apply' : 'dry-run'} queued (run ID: ${res.data.run_id}).`);
            onClose();
          }
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Retention run failed.';
          toast.error(message);
        },
      },
    );
  };

  return (
    <>
      <ApplyConfirm
        open={confirmOpen}
        onConfirm={submitRun}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="fixed inset-0 z-40 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Trigger retention run"
          className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Trigger Retention Run</h2>
            <button
              type="button"
              aria-label="Close"
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode selector */}
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-gray-700">Run Mode</legend>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="run-mode"
                  value="dry_run"
                  checked={mode === 'dry_run'}
                  onChange={() => { setMode('dry_run'); setDryRunPreview(null); }}
                  aria-label="Dry run"
                />
                Dry Run — preview counts only, no data changes
              </label>
              <label className={`flex items-center gap-2 text-sm ${!canApply ? 'opacity-50' : ''}`}>
                <input
                  type="radio"
                  name="run-mode"
                  value="apply"
                  checked={mode === 'apply'}
                  disabled={!canApply}
                  onChange={() => { setMode('apply'); setDryRunPreview(null); }}
                  aria-label="Apply"
                />
                Apply — execute purge / anonymisation (ADMIN only)
              </label>
            </div>
          </fieldset>

          {/* Optional data_category filter */}
          <div className="mb-5">
            <label htmlFor="tr-data-category" className="mb-1.5 block text-sm font-medium text-gray-700">
              Data Category (optional — omit to run all)
            </label>
            <select
              id="tr-data-category"
              aria-label="Data category filter"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={dataCategory}
              onChange={(e) => setDataCategory(e.target.value as DataCategory | '')}
            >
              {DATA_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === '' ? '— All categories —' : DATA_CATEGORY_LABELS[cat as DataCategory] ?? cat}
                </option>
              ))}
            </select>
          </div>

          {/* Dry-run preview */}
          {dryRunPreview && <DryRunPreviewPanel preview={dryRunPreview} />}

          <div className="mt-5 flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleRun}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending
                ? 'Running…'
                : mode === 'dry_run'
                ? 'Preview'
                : 'Apply'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
