import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField } from '@/components/forms/EntityForm';
import { useCreateMaster, useUpdateMaster } from '@/hooks/use-master-data';
import type { RegionView } from '@/types/master-data';
import { masterFormError } from './form-utils';

/** FR-131 — region create/edit (descriptor: regions; code ≤20, name ≤80). Regions
 * have no activeness, so there is no deactivate toggle. */
const schema = z.object({
  code: z.string().trim().min(1, 'code is required.').max(20, 'code must not exceed 20 characters.'),
  name: z.string().trim().min(1, 'name is required.').max(80, 'name must not exceed 80 characters.'),
});
type Values = z.infer<typeof schema>;

export function RegionForm({ region, onClose }: { region?: RegionView; onClose: () => void }): JSX.Element {
  const create = useCreateMaster('regions');
  const update = useUpdateMaster('regions');

  async function onSubmit(v: Values): Promise<void> {
    if (region) {
      await update.mutateAsync({ id: region.id, body: { code: v.code.trim(), name: v.name.trim() } });
      toast.success('Region updated.');
    } else {
      await create.mutateAsync({ code: v.code.trim(), name: v.name.trim() });
      toast.success('Region created.');
    }
    onClose();
  }

  return (
    <EntityForm
      schema={schema}
      defaultValues={{ code: region?.code ?? '', name: region?.name ?? '' }}
      onSubmit={onSubmit}
      onError={(e) => masterFormError('region', e)}
      submitLabel={region ? 'Save changes' : 'Create region'}
    >
      <FormField name="code" label="Code" required />
      <FormField name="name" label="Name" required />
    </EntityForm>
  );
}
