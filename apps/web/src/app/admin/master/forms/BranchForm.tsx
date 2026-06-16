import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { useCreateMaster, useMasterList, useUpdateMaster } from '@/hooks/use-master-data';
import type { BranchView, PatchBranchBody, RegionView } from '@/types/master-data';
import { masterFormError } from './form-utils';

const PIN = /^\d{6}$/;
const BOOL_OPTIONS = [
  { value: 'yes', label: 'Active' },
  { value: 'no', label: 'Inactive' },
];

/** Parse a comma/space separated PIN list into a unique array (or undefined). */
function splitPins(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  const pins = value
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return pins.length > 0 ? pins : undefined;
}

const pinCodes = z
  .string()
  .optional()
  .refine(
    (v) => !v?.trim() || (splitPins(v) ?? []).every((p) => PIN.test(p)),
    'Each pin code must be a 6-digit number.',
  );

const baseShape = {
  code: z.string().trim().min(1, 'code is required.').max(20, 'code must not exceed 20 characters.'),
  name: z.string().trim().min(1, 'name is required.').max(120, 'name must not exceed 120 characters.'),
  regionId: z.string().uuid('regionId must reference an active region.'),
  pinCodes,
  address: z.string().trim().max(255, 'address must not exceed 255 characters.').optional(),
};
const createSchema = z.object(baseShape);
type CreateValues = z.infer<typeof createSchema>;
const editSchema = z.object({ ...baseShape, isActive: z.enum(['yes', 'no']) });
type EditValues = z.infer<typeof editSchema>;

/**
 * FR-131 — branch create/edit. `regionId` must reference an existing active region
 * (the select is populated from the regions list; the server re-validates the FK
 * → VALIDATION_ERROR on `regionId`). `pinCodes` is a 6-digit list; on edit an
 * active/inactive toggle is shown (deactivation blocked while active users exist).
 */
export function BranchForm({ branch, onClose }: { branch?: BranchView; onClose: () => void }): JSX.Element {
  // Load active regions for the region picker (LIMIT-bounded; a single page covers
  // the realistic region count for this org).
  const regionsQuery = useMasterList('regions', { page: 1, limit: 100 });
  const regionOptions = ((regionsQuery.data?.data ?? []) as RegionView[]).map((r) => ({
    value: r.id,
    label: `${r.code} — ${r.name}`,
  }));

  const create = useCreateMaster('branches');
  const update = useUpdateMaster('branches');

  async function onSubmit(v: CreateValues | EditValues): Promise<void> {
    const common = {
      code: v.code.trim(),
      name: v.name.trim(),
      regionId: v.regionId,
      ...(splitPins(v.pinCodes) ? { pinCodes: splitPins(v.pinCodes) } : {}),
      ...(v.address?.trim() ? { address: v.address.trim() } : {}),
    };
    if (branch) {
      const body: PatchBranchBody = { ...common, isActive: (v as EditValues).isActive === 'yes' };
      await update.mutateAsync({ id: branch.id, body });
      toast.success('Branch updated.');
    } else {
      await create.mutateAsync(common);
      toast.success('Branch created.');
    }
    onClose();
  }

  const fields = (
    <>
      <FormField name="code" label="Code" required />
      <FormField name="name" label="Name" required />
      <FormSelect
        name="regionId"
        label="Region"
        required
        options={regionOptions}
        placeholder={regionsQuery.isLoading ? 'Loading regions…' : 'Select a region'}
      />
      <FormField name="pinCodes" label="PIN codes (comma-separated)" />
      <FormField name="address" label="Address" />
    </>
  );

  if (branch) {
    return (
      <EntityForm
        schema={editSchema}
        defaultValues={{
          code: branch.code,
          name: branch.name,
          regionId: branch.regionId,
          pinCodes: (branch.pinCodes ?? []).join(', '),
          address: branch.address ?? '',
          isActive: branch.isActive ? 'yes' : 'no',
        }}
        onSubmit={onSubmit}
        onError={(e) => masterFormError('branch', e)}
        submitLabel="Save changes"
      >
        {fields}
        <FormSelect name="isActive" label="Status" options={BOOL_OPTIONS} />
      </EntityForm>
    );
  }

  return (
    <EntityForm
      schema={createSchema}
      defaultValues={{ code: '', name: '', regionId: '', pinCodes: '', address: '' }}
      onSubmit={onSubmit}
      onError={(e) => masterFormError('branch', e)}
      submitLabel="Create branch"
    >
      {fields}
    </EntityForm>
  );
}
