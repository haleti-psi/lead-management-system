import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useCreatePartner, useUpdatePartner } from '@/hooks/use-partners';
import type { PartnerView } from '@/types/partner';

const TYPE_OPTIONS = ['DSA', 'Dealer', 'Connector', 'OEM', 'Aggregator', 'Referral'].map((v) => ({
  value: v,
  label: v,
}));
const RISK_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const mobile = z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile.').optional().or(z.literal(''));
const products = z.string().optional();
const validUntil = z.string().optional().or(z.literal(''));

function splitProducts(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value.split(',').map((p) => p.trim()).filter(Boolean);
}

function onError(error: unknown): void {
  if (isApiClientError(error) && error.code === 'CONFLICT') {
    toast.error('A partner with that code already exists.');
    return;
  }
  if (isApiClientError(error) && error.code === 'FORBIDDEN') {
    toast.error("You don't have access to perform this change.");
    return;
  }
  toast.error('Could not save the partner. Please try again.');
}

/** FR-090 §UI — create or edit a partner (EntityForm). `partnerCode`/`type` are
 * editable only on create; status change is shown on edit. */
export function PartnerForm({ partner, onClose }: { partner?: PartnerView; onClose: () => void }): JSX.Element {
  return partner ? <EditForm partner={partner} onClose={onClose} /> : <CreateForm onClose={onClose} />;
}

const createSchema = z.object({
  partnerCode: z
    .string()
    .trim()
    .min(1, 'Partner code is required.')
    .max(20, 'Partner code must be under 20 characters.')
    .regex(/^[A-Z0-9_-]+$/i, 'Use letters, numbers, - or _ only.'),
  type: z.enum(['DSA', 'Dealer', 'Connector', 'OEM', 'Aggregator', 'Referral']),
  legalName: z.string().trim().min(1, 'Legal name is required.').max(150),
  contactPerson: z.string().trim().max(150).optional(),
  contactMobile: mobile,
  products,
  agreementRef: z.string().trim().max(80).optional(),
  riskCategory: z.enum(['low', 'medium', 'high']).optional().or(z.literal('')),
  validUntil,
});
type CreateValues = z.infer<typeof createSchema>;

function CreateForm({ onClose }: { onClose: () => void }): JSX.Element {
  const create = useCreatePartner();
  async function onSubmit(v: CreateValues): Promise<void> {
    await create.mutateAsync({
      partnerCode: v.partnerCode.trim(),
      type: v.type,
      legalName: v.legalName.trim(),
      ...(v.contactPerson?.trim() ? { contactPerson: v.contactPerson.trim() } : {}),
      ...(v.contactMobile ? { contactMobile: v.contactMobile } : {}),
      ...(splitProducts(v.products) ? { products: splitProducts(v.products) } : {}),
      ...(v.agreementRef?.trim() ? { agreementRef: v.agreementRef.trim() } : {}),
      ...(v.riskCategory ? { riskCategory: v.riskCategory } : {}),
      ...(v.validUntil ? { validUntil: v.validUntil } : {}),
    });
    toast.success('Partner created.');
    onClose();
  }
  return (
    <EntityForm
      schema={createSchema}
      defaultValues={{ partnerCode: '', type: 'DSA', legalName: '', contactPerson: '', contactMobile: '', products: '', agreementRef: '', riskCategory: '', validUntil: '' }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Create partner"
    >
      <FormField name="partnerCode" label="Partner code" required />
      <FormSelect name="type" label="Type" required options={TYPE_OPTIONS} />
      <FormField name="legalName" label="Legal name" required />
      <FormField name="contactPerson" label="Contact person" />
      <FormField name="contactMobile" label="Contact mobile" />
      <FormField name="products" label="Products (comma-separated)" />
      <FormField name="agreementRef" label="Agreement reference" />
      <FormSelect name="riskCategory" label="Risk category" options={RISK_OPTIONS} placeholder="—" />
      <FormField name="validUntil" label="Valid until" type="date" />
    </EntityForm>
  );
}

const editSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal name is required.').max(150),
  contactPerson: z.string().trim().max(150).optional(),
  contactMobile: mobile,
  products,
  agreementRef: z.string().trim().max(80).optional(),
  riskCategory: z.enum(['low', 'medium', 'high']).optional().or(z.literal('')),
  validUntil,
});
type EditValues = z.infer<typeof editSchema>;

/** Edit covers partner METADATA only. Status transitions (suspend / reactivate /
 * expire) are handled by `PartnerStatusDialog` so the state machine is enforced
 * (only legal next states are offered) and a reason is captured. */
function EditForm({ partner, onClose }: { partner: PartnerView; onClose: () => void }): JSX.Element {
  const update = useUpdatePartner();
  async function onSubmit(v: EditValues): Promise<void> {
    await update.mutateAsync({
      partnerId: partner.partnerId,
      body: {
        legalName: v.legalName.trim(),
        ...(v.contactPerson?.trim() ? { contactPerson: v.contactPerson.trim() } : {}),
        ...(v.contactMobile ? { contactMobile: v.contactMobile } : {}),
        ...(splitProducts(v.products) ? { products: splitProducts(v.products) } : {}),
        ...(v.agreementRef?.trim() ? { agreementRef: v.agreementRef.trim() } : {}),
        ...(v.riskCategory ? { riskCategory: v.riskCategory } : {}),
        ...(v.validUntil ? { validUntil: v.validUntil } : {}),
      },
    });
    toast.success('Partner updated.');
    onClose();
  }
  return (
    <EntityForm
      schema={editSchema}
      defaultValues={{
        legalName: partner.legalName,
        contactPerson: partner.contactPerson ?? '',
        contactMobile: '',
        products: partner.products.join(', '),
        agreementRef: partner.agreementRef ?? '',
        riskCategory: (partner.riskCategory as 'low' | 'medium' | 'high' | null) ?? '',
        validUntil: partner.validUntil ?? '',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Save changes"
    >
      <p className="text-sm text-muted-foreground">
        {partner.partnerCode} · {partner.type}
      </p>
      <FormField name="legalName" label="Legal name" required />
      <FormField name="contactPerson" label="Contact person" />
      <FormField name="contactMobile" label="Contact mobile (leave blank to keep)" />
      <FormField name="products" label="Products (comma-separated)" />
      <FormField name="agreementRef" label="Agreement reference" />
      <FormSelect name="riskCategory" label="Risk category" options={RISK_OPTIONS} placeholder="—" />
      <FormField name="validUntil" label="Valid until" type="date" />
    </EntityForm>
  );
}
