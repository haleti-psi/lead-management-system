/**
 * FR-115 — Slide-in drawer for creating a new RetentionPolicy.
 * ADMIN-only; DPO is blocked at the API layer.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateRetentionPolicy } from '@/components/compliance/use-retention-policies';
import type { CreateRetentionPolicyInput, DataCategory, RetentionAction, LeadOutcome } from '@/components/compliance/retention.types';
import {
  DATA_CATEGORY_LABELS,
  RETENTION_ACTION_LABELS,
  LEAD_OUTCOME_LABELS,
} from '@/components/compliance/retention.types';

// ── inline confirm dialog ─────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ open, onConfirm, onCancel }: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-popover p-6 shadow-xl">
        <p className="mb-4 text-sm text-muted-foreground">
          This policy will affect live data on the next retention run. Are you sure?
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── form fields ───────────────────────────────────────────────────────────────

interface FormValues {
  data_category: DataCategory;
  lead_outcome: LeadOutcome | '';
  retain_days: number;
  action: RetentionAction;
  legal_hold: boolean;
}

// ── NewPolicyDrawer ───────────────────────────────────────────────────────────

interface NewPolicyDrawerProps {
  open: boolean;
  onClose: () => void;
}

const DATA_CATEGORIES = Object.keys(DATA_CATEGORY_LABELS) as DataCategory[];
const ACTIONS = Object.keys(RETENTION_ACTION_LABELS) as RetentionAction[];
const LEAD_OUTCOMES = Object.keys(LEAD_OUTCOME_LABELS) as LeadOutcome[];

export function NewPolicyDrawer({ open, onClose }: NewPolicyDrawerProps): JSX.Element | null {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const createMutation = useCreateRetentionPolicy();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      data_category: 'identity',
      lead_outcome: '',
      retain_days: 365,
      action: 'anonymise',
      legal_hold: false,
    },
  });

  if (!open) return null;

  const handleFormSubmit = (values: FormValues): void => {
    setPendingValues(values);
    setConfirmOpen(true);
  };

  const handleConfirm = (): void => {
    if (!pendingValues) return;
    setConfirmOpen(false);

    const input: CreateRetentionPolicyInput = {
      data_category: pendingValues.data_category,
      retain_days: Number(pendingValues.retain_days),
      action: pendingValues.action,
      legal_hold: pendingValues.legal_hold,
    };
    if (pendingValues.lead_outcome) {
      input.lead_outcome = pendingValues.lead_outcome as LeadOutcome;
    }

    createMutation.mutate(input, {
      onSuccess: () => {
        toast.success('Retention policy created.');
        reset();
        onClose();
      },
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to create policy.';
        toast.error(message);
      },
    });
  };

  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* Overlay + drawer */}
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" onClick={onClose} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="New retention policy"
          className="relative z-10 flex w-full max-w-md flex-col bg-popover shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">New Retention Policy</h2>
            <button
              type="button"
              aria-label="Close drawer"
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
            onSubmit={(e) => { void handleSubmit(handleFormSubmit)(e); }}
          >
            {/* data_category */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-data-category">Data Category</Label>
              <select
                id="np-data-category"
                aria-label="Data category"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                {...register('data_category', { required: 'Required' })}
              >
                {DATA_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{DATA_CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
              {errors.data_category && (
                <p className="text-xs text-destructive" role="alert">{errors.data_category.message}</p>
              )}
            </div>

            {/* lead_outcome (optional) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-lead-outcome">Lead Outcome (optional)</Label>
              <select
                id="np-lead-outcome"
                aria-label="Lead outcome"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                {...register('lead_outcome')}
              >
                <option value="">— Any outcome —</option>
                {LEAD_OUTCOMES.map((o) => (
                  <option key={o} value={o}>{LEAD_OUTCOME_LABELS[o]}</option>
                ))}
              </select>
            </div>

            {/* retain_days */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-retain-days">Retain (days)</Label>
              <Input
                id="np-retain-days"
                type="number"
                min={0}
                aria-label="Retain days"
                {...register('retain_days', {
                  required: 'Required',
                  min: { value: 0, message: 'Must be ≥ 0' },
                  valueAsNumber: true,
                })}
              />
              {errors.retain_days && (
                <p className="text-xs text-destructive" role="alert">{errors.retain_days.message}</p>
              )}
            </div>

            {/* action */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="np-action">Action</Label>
              <select
                id="np-action"
                aria-label="Retention action"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                {...register('action', { required: 'Required' })}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{RETENTION_ACTION_LABELS[a]}</option>
                ))}
              </select>
              {errors.action && (
                <p className="text-xs text-destructive" role="alert">{errors.action.message}</p>
              )}
            </div>

            {/* legal_hold */}
            <div className="flex items-center gap-3">
              <input
                id="np-legal-hold"
                type="checkbox"
                aria-label="Legal hold"
                className="h-4 w-4 rounded border-input"
                {...register('legal_hold')}
              />
              <Label htmlFor="np-legal-hold">Legal Hold</Label>
            </div>

            <div className="mt-auto flex justify-end gap-3 pt-4">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
                {isSubmitting || createMutation.isPending ? 'Saving…' : 'Create Policy'}
              </Button>
            </div>
          </form>
        </aside>
      </div>
    </>
  );
}
