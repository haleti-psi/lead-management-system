/**
 * FR-114 — Resolution / status-update form for a single grievance.
 * Only valid next statuses per the state machine are offered in the select.
 * Guards: response required for → resolved; closureProofRef required for → closed.
 * A ConfirmDialog is presented before committing the `closed` transition.
 */

import { useState } from 'react';
import { z } from 'zod';
import { useFormContext } from 'react-hook-form';
import { EntityForm, FormField } from '@/components/forms/EntityForm';
import { Button } from '@/components/ui/button';
import type { GrievanceItem, GrievanceStatus, UpdateGrievanceInput } from './grievance.types';
import { VALID_NEXT_STATUSES } from './grievance.types';

// ── Zod schema mirrors UpdateGrievanceDto guards ─────────────────────────────

const ResolutionSchema = z
  .object({
    status: z.string().optional(),
    response: z.string().max(2000).optional(),
    closureProofRef: z.string().max(255).optional(),
    ownerId: z.string().optional(),
  })
  .refine(
    (d) => {
      if (d.status === 'resolved' && (!d.response || d.response.trim() === '')) return false;
      return true;
    },
    { message: 'Response is required to resolve a grievance.', path: ['response'] },
  )
  .refine(
    (d) => {
      if (d.status === 'closed' && (!d.closureProofRef || d.closureProofRef.trim() === '')) return false;
      return true;
    },
    { message: 'Closure proof reference is required to close a grievance.', path: ['closureProofRef'] },
  );

type ResolutionValues = z.infer<typeof ResolutionSchema>;

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ open, onConfirm, onCancel }: ConfirmDialogProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-6 shadow-xl">
        <h2 id="confirm-title" className="text-base font-semibold">
          Close grievance?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Closing a grievance cannot be undone. To reopen, you must create a new linked grievance.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Confirm close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── TextareaField (mirrors FormField but renders <textarea>) ──────────────────

interface TextareaFieldProps {
  name: string;
  label: string;
  rows?: number;
}

function TextareaField({ name, label, rows = 3 }: TextareaFieldProps): JSX.Element {
  const {
    register,
    formState: { errors },
  } = useFormContext<ResolutionValues>();
  const error = errors[name as keyof ResolutionValues];
  const errorId = `${name}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium leading-none">
        {label}
      </label>
      <textarea
        id={name}
        rows={rows}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...register(name as keyof ResolutionValues)}
      />
      {error ? (
        <p id={errorId} role="alert" aria-live="polite" className="text-sm text-destructive">
          {String(error.message ?? 'Invalid value')}
        </p>
      ) : null}
    </div>
  );
}

// ── StatusSelect ─────────────────────────────────────────────────────────────
// Exported so tests can render it in isolation (T40).

interface StatusSelectProps {
  currentStatus: GrievanceStatus;
  validNextStatuses: GrievanceStatus[];
}

export function StatusSelect({ currentStatus, validNextStatuses }: StatusSelectProps): JSX.Element {
  const { register } = useFormContext<ResolutionValues>();
  return (
    <select
      id="status"
      aria-label="Status"
      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      {...register('status')}
    >
      <option value="">— keep current ({currentStatus.replaceAll('_', ' ')}) —</option>
      {validNextStatuses.map((s) => (
        <option key={s} value={s}>
          {s.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

interface GrievanceResolutionFormProps {
  grievance: GrievanceItem;
  onSubmit: (input: UpdateGrievanceInput) => Promise<void>;
  onError?: (error: unknown) => void;
}

export function GrievanceResolutionForm({
  grievance,
  onSubmit,
  onError,
}: GrievanceResolutionFormProps): JSX.Element {
  const [pendingValues, setPendingValues] = useState<ResolutionValues | null>(null);
  const [confirming, setConfirming] = useState(false);

  const validNextStatuses: GrievanceStatus[] =
    (VALID_NEXT_STATUSES[grievance.status] as GrievanceStatus[] | undefined) ?? [];

  async function handleFormSubmit(values: ResolutionValues): Promise<void> {
    if (values.status === 'closed') {
      setPendingValues(values);
      setConfirming(true);
      return;
    }
    await commit(values);
  }

  async function commit(values: ResolutionValues): Promise<void> {
    const input: UpdateGrievanceInput = {};
    if (values.status) input.status = values.status as GrievanceStatus;
    if (values.response) input.response = values.response;
    if (values.closureProofRef) input.closureProofRef = values.closureProofRef;
    if (values.ownerId) input.ownerId = values.ownerId;
    await onSubmit(input);
  }

  async function handleConfirm(): Promise<void> {
    setConfirming(false);
    if (pendingValues) {
      await commit(pendingValues);
    }
    setPendingValues(null);
  }

  function handleCancel(): void {
    setConfirming(false);
    setPendingValues(null);
  }

  if (grievance.status === 'closed') {
    return (
      <p className="text-sm text-muted-foreground">
        This grievance is closed and cannot be updated.
      </p>
    );
  }

  return (
    <>
      <ConfirmDialog open={confirming} onConfirm={handleConfirm} onCancel={handleCancel} />

      <EntityForm<ResolutionValues>
        schema={ResolutionSchema}
        defaultValues={{
          status: '',
          response: grievance.response ?? '',
          closureProofRef: grievance.closureProofRef ?? '',
          ownerId: grievance.ownerId ?? '',
        }}
        onSubmit={handleFormSubmit}
        onError={onError}
        submitLabel="Save"
      >
        {/* Status select — only valid next transitions */}
        <div className="space-y-1.5">
          <label htmlFor="status" className="text-sm font-medium leading-none">
            Status
          </label>
          <StatusSelect
            currentStatus={grievance.status}
            validNextStatuses={validNextStatuses}
          />
        </div>

        <TextareaField name="response" label="Response" rows={3} />

        <FormField
          name="closureProofRef"
          label="Closure proof reference"
          placeholder="gcs://bucket/path/to/proof.pdf"
        />

        <FormField
          name="ownerId"
          label="Reassign owner (UUID)"
          placeholder="Leave blank to keep current owner"
        />
      </EntityForm>
    </>
  );
}
