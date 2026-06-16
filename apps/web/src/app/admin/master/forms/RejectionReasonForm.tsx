import { z } from 'zod';
import { toast } from 'sonner';
import { RejectionPrimary } from '@lms/shared';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { useCreateMaster, useUpdateMaster } from '@/hooks/use-master-data';
import type { PatchRejectionReasonBody, RejectionReasonView } from '@/types/master-data';
import { masterFormError } from './form-utils';

const PRIMARY_VALUES = Object.values(RejectionPrimary);

/** Title-case a snake_case enum value for display ("no_response" → "No response"). */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const PRIMARY_OPTIONS = PRIMARY_VALUES.map((v) => ({ value: v, label: humanize(v) }));
const BOOL_OPTIONS = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
];

/**
 * FR-131 — rejection-reason create/edit. `primaryReason` is a `rejection_primary`
 * enum (set on create only); `subReason` ≤80; `requiresRemarks` boolean. On edit
 * an active/inactive toggle is shown (deactivation is in-use-guarded server-side).
 */
const createSchema = z.object({
  primaryReason: z.enum(PRIMARY_VALUES as [string, ...string[]], {
    errorMap: () => ({ message: 'primaryReason must be a valid rejection primary reason.' }),
  }),
  subReason: z.string().trim().max(80, 'subReason must not exceed 80 characters.').optional(),
  requiresRemarks: z.enum(['yes', 'no']),
});
type CreateValues = z.infer<typeof createSchema>;

const editSchema = createSchema
  .omit({ primaryReason: true })
  .extend({ isActive: z.enum(['yes', 'no']) });
type EditValues = z.infer<typeof editSchema>;

export function RejectionReasonForm({
  reason,
  onClose,
}: {
  reason?: RejectionReasonView;
  onClose: () => void;
}): JSX.Element {
  return reason ? <EditForm reason={reason} onClose={onClose} /> : <CreateForm onClose={onClose} />;
}

function CreateForm({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useCreateMaster('rejection-reasons');
  async function onSubmit(v: CreateValues): Promise<void> {
    await create.mutateAsync({
      primaryReason: v.primaryReason,
      ...(v.subReason?.trim() ? { subReason: v.subReason.trim() } : {}),
      requiresRemarks: v.requiresRemarks === 'yes',
    });
    toast.success('Rejection reason created.');
    onClose();
  }
  return (
    <EntityForm
      schema={createSchema}
      defaultValues={{ primaryReason: PRIMARY_VALUES[0], subReason: '', requiresRemarks: 'no' }}
      onSubmit={onSubmit}
      onError={(e) => masterFormError('rejection reason', e)}
      submitLabel="Create rejection reason"
    >
      <FormSelect name="primaryReason" label="Primary reason" required options={PRIMARY_OPTIONS} />
      <FormField name="subReason" label="Sub reason" />
      <FormSelect name="requiresRemarks" label="Requires remarks" options={BOOL_OPTIONS} />
    </EntityForm>
  );
}

function EditForm({ reason, onClose }: { reason: RejectionReasonView; onClose: () => void }): JSX.Element {
  const update = useUpdateMaster('rejection-reasons');
  async function onSubmit(v: EditValues): Promise<void> {
    const body: PatchRejectionReasonBody = {
      subReason: v.subReason?.trim() ?? '',
      requiresRemarks: v.requiresRemarks === 'yes',
      isActive: v.isActive === 'yes',
    };
    await update.mutateAsync({ id: reason.id, body });
    toast.success('Rejection reason updated.');
    onClose();
  }
  return (
    <EntityForm
      schema={editSchema}
      defaultValues={{
        subReason: reason.subReason ?? '',
        requiresRemarks: reason.requiresRemarks ? 'yes' : 'no',
        isActive: reason.isActive ? 'yes' : 'no',
      }}
      onSubmit={onSubmit}
      onError={(e) => masterFormError('rejection reason', e)}
      submitLabel="Save changes"
    >
      <p className="text-sm text-muted-foreground">{humanize(reason.primaryReason)}</p>
      <FormField name="subReason" label="Sub reason" />
      <FormSelect name="requiresRemarks" label="Requires remarks" options={BOOL_OPTIONS} />
      <FormSelect name="isActive" label="Active" options={BOOL_OPTIONS} />
    </EntityForm>
  );
}
