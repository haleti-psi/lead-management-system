/**
 * FR-113 — Slide-in drawer for creating / editing DLA/LSP registry entries.
 *
 * Hosts a form (create or update mode).
 * On status transition to 'retired', shows a ConfirmDialog before submitting.
 * Maps VALIDATION_ERROR.fields[] from the server to inline field errors.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CreateDlaInput,
  DlaItem,
  DlaType,
  ConfigStatus,
  UpdateDlaInput,
} from './dla-registry.types';
import {
  DLA_TYPE_LABELS,
  CONFIG_STATUS_LABELS,
  nextDlaStatuses,
} from './dla-registry.types';

// ── field error shape from the API envelope ───────────────────────────────────

interface ApiFieldError {
  field: string;
  issue: string;
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

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
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-white dark:bg-card p-6 shadow-xl">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          This will hide the entry from customer disclosures. Confirm?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Retire
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── DlaRegistryDrawer ─────────────────────────────────────────────────────────

export interface DlaRegistryDrawerProps {
  /** Null → drawer is closed (add mode); populated DlaItem → edit mode. */
  entry: DlaItem | null;
  /** True when the drawer should be open in create mode (no entry). */
  open: boolean;
  onClose: () => void;
  onSave: (input: CreateDlaInput | UpdateDlaInput) => Promise<void>;
  /** Role of the current user — reserved for future role-based field hiding. */
  callerRole?: string;
}

interface FormValues {
  name: string;
  type: string;
  owner: string;
  url: string;
  grievance_officer_name: string;
  grievance_officer_email: string;
  grievance_officer_phone: string;
  storage_location: string;
  status: string;
}

export function DlaRegistryDrawer({
  entry,
  open,
  onClose,
  onSave,
}: DlaRegistryDrawerProps): JSX.Element {
  const isEdit = entry !== null;
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
  const [showRetireConfirm, setShowRetireConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: entry
      ? {
          name: entry.name,
          type: entry.type,
          owner: entry.owner ?? '',
          url: entry.url ?? '',
          grievance_officer_name: entry.grievanceOfficer?.name ?? '',
          grievance_officer_email: entry.grievanceOfficer?.email ?? '',
          grievance_officer_phone: entry.grievanceOfficer?.phone ?? '',
          storage_location: entry.storageLocation ?? '',
          status: entry.status,
        }
      : {
          name: '',
          type: '',
          owner: '',
          url: '',
          grievance_officer_name: '',
          grievance_officer_email: '',
          grievance_officer_phone: '',
          storage_location: '',
          status: 'draft',
        },
  });

  // Reset form when entry changes (drawer re-used for different rows).
  useEffect(() => {
    if (entry) {
      reset({
        name: entry.name,
        type: entry.type,
        owner: entry.owner ?? '',
        url: entry.url ?? '',
        grievance_officer_name: entry.grievanceOfficer?.name ?? '',
        grievance_officer_email: entry.grievanceOfficer?.email ?? '',
        grievance_officer_phone: entry.grievanceOfficer?.phone ?? '',
        storage_location: entry.storageLocation ?? '',
        status: entry.status,
      });
    } else {
      reset({
        name: '', type: '', owner: '', url: '',
        grievance_officer_name: '', grievance_officer_email: '', grievance_officer_phone: '',
        storage_location: '', status: 'draft',
      });
    }
    setServerErrors([]);
  }, [entry, reset]);

  // Escape key closes drawer.
  useEffect(() => {
    if (!open && !entry) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, entry, onClose]);

  if (!open && !entry) return <></>;

  function buildInput(values: FormValues): CreateDlaInput | UpdateDlaInput {
    const grievanceOfficer =
      values.grievance_officer_name || values.grievance_officer_email || values.grievance_officer_phone
        ? {
            name: values.grievance_officer_name,
            email: values.grievance_officer_email,
            phone: values.grievance_officer_phone,
          }
        : null;

    if (isEdit && entry) {
      return {
        dla_registry_id: entry.dlaRegistryId,
        ...(values.name !== entry.name && { name: values.name }),
        ...(values.type !== entry.type && values.type !== '' && { type: values.type as DlaType }),
        owner: values.owner || null,
        url: values.url || null,
        grievance_officer: grievanceOfficer,
        storage_location: values.storage_location || null,
        ...(values.status !== '' && values.status !== entry.status && { status: values.status as ConfigStatus }),
      } satisfies UpdateDlaInput;
    }

    return {
      name: values.name,
      type: values.type as DlaType,
      owner: values.owner || null,
      url: values.url || null,
      grievance_officer: grievanceOfficer,
      storage_location: values.storage_location || null,
      status: (values.status as ConfigStatus) || 'draft',
    } satisfies CreateDlaInput;
  }

  async function doSave(values: FormValues): Promise<void> {
    setIsSubmitting(true);
    setServerErrors([]);
    try {
      await onSave(buildInput(values));
      toast.success(isEdit ? 'Entry updated.' : 'Entry created.');
      onClose();
    } catch (err: unknown) {
      // Map server VALIDATION_ERROR.fields[] to inline errors.
      if (
        err !== null &&
        typeof err === 'object' &&
        'fields' in err &&
        Array.isArray((err as { fields: unknown }).fields)
      ) {
        setServerErrors((err as { fields: ApiFieldError[] }).fields);
      } else {
        const msg = err instanceof Error ? err.message : 'Something went wrong.';
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function onSubmit(values: FormValues): void {
    // Confirm dialog before retiring.
    if (isEdit && values.status === 'retired' && entry?.status !== 'retired') {
      setPendingValues(values);
      setShowRetireConfirm(true);
      return;
    }
    void doSave(values);
  }

  function onRetireConfirm(): void {
    setShowRetireConfirm(false);
    if (pendingValues) void doSave(pendingValues);
  }

  /** Find a server-side field error by field path. */
  function serverError(field: string): string | undefined {
    return serverErrors.find((e) => e.field === field)?.issue;
  }

  // For edit mode, show current status + valid next transitions.
  // For create mode, only draft | active are valid.
  const statusOptions: string[] = isEdit && entry
    ? [entry.status, ...nextDlaStatuses(entry.status)]
    : ['draft', 'active'];

  return (
    <>
      <ConfirmDialog
        open={showRetireConfirm}
        onConfirm={onRetireConfirm}
        onCancel={() => setShowRetireConfirm(false)}
      />

      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit DLA/LSP entry' : 'Add DLA/LSP entry'}
        className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white dark:bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Edit DLA/LSP Entry' : 'Add DLA/LSP Entry'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close drawer">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(onSubmit)(e); }}
          className="flex flex-1 flex-col gap-5 px-6 py-5"
          noValidate
        >
          {/* Name */}
          <div>
            <Label htmlFor="dla-name">Name *</Label>
            <Input
              id="dla-name"
              {...register('name', {
                required: 'name is required',
                maxLength: { value: 150, message: 'name must not exceed 150 characters' },
              })}
              aria-invalid={!!(errors.name || serverError('name'))}
            />
            {(errors.name || serverError('name')) && (
              <p className="mt-1 text-xs text-red-600">{errors.name?.message ?? serverError('name')}</p>
            )}
          </div>

          {/* Type */}
          <div>
            <Label htmlFor="dla-type">Type *</Label>
            <select
              id="dla-type"
              aria-label="Type"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              {...register('type', { required: 'type is required' })}
            >
              <option value="">Select type</option>
              {(Object.entries(DLA_TYPE_LABELS) as [DlaType, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            {(errors.type || serverError('type')) && (
              <p className="mt-1 text-xs text-red-600">{errors.type?.message ?? serverError('type')}</p>
            )}
          </div>

          {/* Owner */}
          <div>
            <Label htmlFor="dla-owner">Owner</Label>
            <Input id="dla-owner" {...register('owner', { maxLength: 120 })} />
            {serverError('owner') && (
              <p className="mt-1 text-xs text-red-600">{serverError('owner')}</p>
            )}
          </div>

          {/* URL */}
          <div>
            <Label htmlFor="dla-url">URL</Label>
            <Input id="dla-url" type="url" {...register('url')} />
            {serverError('url') && (
              <p className="mt-1 text-xs text-red-600">{serverError('url')}</p>
            )}
          </div>

          {/* Grievance Officer */}
          <fieldset className="rounded border p-4">
            <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">Grievance Officer</legend>
            <div className="mt-2 flex flex-col gap-3">
              <div>
                <Label htmlFor="go-name">Officer Name</Label>
                <Input id="go-name" {...register('grievance_officer_name')} />
              </div>
              <div>
                <Label htmlFor="go-email">Officer Email</Label>
                <Input
                  id="go-email"
                  type="email"
                  {...register('grievance_officer_email')}
                  aria-invalid={!!serverError('grievance_officer.email')}
                />
                {serverError('grievance_officer.email') && (
                  <p className="mt-1 text-xs text-red-600">{serverError('grievance_officer.email')}</p>
                )}
                {serverError('grievance_officer') && !serverError('grievance_officer.email') && (
                  <p className="mt-1 text-xs text-red-600">{serverError('grievance_officer')}</p>
                )}
              </div>
              <div>
                <Label htmlFor="go-phone">Officer Phone</Label>
                <Input id="go-phone" {...register('grievance_officer_phone')} />
              </div>
            </div>
          </fieldset>

          {/* Storage Location */}
          <div>
            <Label htmlFor="dla-storage">Storage Location</Label>
            <Input id="dla-storage" {...register('storage_location', { maxLength: 120 })} />
            {serverError('storage_location') && (
              <p className="mt-1 text-xs text-red-600">{serverError('storage_location')}</p>
            )}
          </div>

          {/* Status */}
          <div>
            <Label htmlFor="dla-status">Status</Label>
            <select
              id="dla-status"
              aria-label="Status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              {...register('status')}
              value={watch('status')}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {CONFIG_STATUS_LABELS[s as ConfigStatus] ?? s}
                </option>
              ))}
            </select>
          </div>

          {/* Save button */}
          <div className="mt-auto flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </aside>
    </>
  );
}
