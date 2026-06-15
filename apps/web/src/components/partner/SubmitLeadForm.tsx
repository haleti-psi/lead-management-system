import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useSubmitPartnerLead } from '@/hooks/use-partner-leads';

const PRODUCT_OPTIONS = ['CV', 'CAR', 'TRACTOR', 'CE', 'TW', 'SBL', 'HRM'].map((v) => ({ value: v, label: v }));

const schema = z.object({
  product_code: z.enum(['CV', 'CAR', 'TRACTOR', 'CE', 'TW', 'SBL', 'HRM'], {
    errorMap: () => ({ message: 'Select a valid product.' }),
  }),
  identity: z.object({
    name: z.string().trim().min(1, 'Name is required.').max(150, 'Name is too long.'),
    mobile: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number.'),
    email: z.string().email('Enter a valid email address.').or(z.literal('')).optional(),
  }),
  sub_source: z.string().trim().max(80, 'Sub-source is too long.').optional(),
  pin_code: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit PIN code.').or(z.literal('')).optional(),
  requested_amount: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

/**
 * FR-091 §UI — partner lead submission form. The partner cannot set source/owner;
 * the server forces them. A strong duplicate returns a GENERIC message (no other-
 * customer info); a suspended partner gets a clear account message.
 */
export function SubmitLeadForm({ onClose }: { onClose: () => void }): JSX.Element {
  const submit = useSubmitPartnerLead();

  async function onSubmit(v: FormValues): Promise<void> {
    const amount = v.requested_amount?.trim() ? Number(v.requested_amount) : undefined;
    await submit.mutateAsync({
      product_code: v.product_code,
      identity: {
        name: v.identity.name.trim(),
        mobile: v.identity.mobile,
        ...(v.identity.email ? { email: v.identity.email } : {}),
      },
      ...(v.sub_source?.trim() ? { sub_source: v.sub_source.trim() } : {}),
      ...(v.pin_code ? { pin_code: v.pin_code } : {}),
      ...(amount != null && !Number.isNaN(amount) ? { requested_amount: amount } : {}),
    });
    toast.success('Lead submitted.');
    onClose();
  }

  function onError(error: unknown): void {
    if (isApiClientError(error)) {
      if (error.code === 'CONFLICT') {
        toast.error('A lead with these details already exists.');
        return;
      }
      if (error.code === 'FORBIDDEN') {
        toast.error('Your partner account cannot submit leads. Contact your branch.');
        return;
      }
    }
    toast.error('Could not submit the lead. Please try again.');
  }

  return (
    <EntityForm
      schema={schema}
      defaultValues={{
        product_code: 'CV',
        identity: { name: '', mobile: '', email: '' },
        sub_source: '',
        pin_code: '',
        requested_amount: '',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Submit lead"
    >
      <FormSelect name="product_code" label="Product" required options={PRODUCT_OPTIONS} />
      <FormField name="identity.name" label="Customer name" required />
      <FormField name="identity.mobile" label="Mobile" required />
      <FormField name="identity.email" label="Email" type="email" />
      <FormField name="sub_source" label="Sub-source" />
      <FormField name="pin_code" label="PIN code" />
      <FormField name="requested_amount" label="Requested amount" type="number" />
    </EntityForm>
  );
}
