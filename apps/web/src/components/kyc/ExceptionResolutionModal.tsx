import { useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { EntityForm, FormField, FormSelect, FormTextarea } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useResolveKycException } from '@/hooks/use-resolve-kyc-exception';
import type { ResolveKycExceptionData } from '@/types/kyc';

/** Mirror of the server ALLOWED_RESOLUTION_CODES (kyc.constants.ts). */
const RESOLUTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 're_verified', label: 'Re-verified' },
  { value: 'document_replaced', label: 'Document replaced' },
  { value: 'name_variance_waiver', label: 'Name variance — waived' },
  { value: 'address_variance_waiver', label: 'Address variance — waived' },
  { value: 'waiver', label: 'Authorised waiver' },
  { value: 'provider_down_manual', label: 'Manual capture (provider down)' },
  { value: 'ckyc_manual_capture', label: 'CKYC manual capture' },
  { value: 'duplicate_ckyc_resolved', label: 'Duplicate CKYC resolved' },
  { value: 'vcip_retaken', label: 'V-CIP retaken' },
];

const EVIDENCE_REQUIRED = new Set(['waiver', 'provider_down_manual']);
const RESOLUTION_VALUES = RESOLUTION_OPTIONS.map((o) => o.value) as [string, ...string[]];

const resolveSchema = z
  .object({
    resolutionCode: z.enum(RESOLUTION_VALUES, { errorMap: () => ({ message: 'Resolution code is not valid.' }) }),
    remarks: z.string().trim().min(1, 'Remarks are required.').max(1000, 'Remarks must be 1000 characters or fewer.'),
    evidenceRef: z.string().trim().max(255).optional(),
  })
  .superRefine((data, ctx) => {
    if (EVIDENCE_REQUIRED.has(data.resolutionCode) && !data.evidenceRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceRef'],
        message: 'Evidence reference is required for waiver and provider downtime manual resolution.',
      });
    }
  });
type ResolveFormValues = z.infer<typeof resolveSchema>;

/** Renders the evidence field only for codes that require it (RHF watch). */
function EvidenceField(): JSX.Element | null {
  const { watch } = useFormContext<ResolveFormValues>();
  const code = watch('resolutionCode');
  if (!EVIDENCE_REQUIRED.has(code)) return null;
  return <FormField name="evidenceRef" label="Evidence reference" required placeholder="gcs://… or document ref" />;
}

/**
 * FR-072 §UI — resolve an open KYC exception (LLD ExceptionResolutionModal).
 * Audited action; `evidenceRef` shows conditionally for waiver / provider-down
 * codes. Server-authoritative — field errors map back via EntityForm.
 */
export function ExceptionResolutionModal({
  leadId,
  kycVerificationId,
  exceptionLabel,
  open,
  onClose,
  onResolved,
}: {
  leadId: string;
  kycVerificationId: string;
  exceptionLabel: string;
  open: boolean;
  onClose: () => void;
  onResolved: (data: ResolveKycExceptionData) => void;
}): JSX.Element {
  const resolve = useResolveKycException(leadId);

  async function onSubmit(values: ResolveFormValues): Promise<void> {
    const data = await resolve.mutateAsync({
      kycVerificationId,
      body: {
        resolutionCode: values.resolutionCode,
        remarks: values.remarks.trim(),
        ...(values.evidenceRef?.trim() ? { evidenceRef: values.evidenceRef.trim() } : {}),
      },
    });
    toast.success('KYC exception resolved.');
    onResolved(data);
    onClose();
  }

  function onError(error: unknown): void {
    if (isApiClientError(error)) {
      if (error.code === 'FORBIDDEN') {
        toast.error("You don't have access to resolve this exception (or manual fallback is not enabled).");
        return;
      }
      if (error.code === 'CONFLICT') {
        toast.error('This exception has already been resolved.');
        return;
      }
    }
    toast.error('Could not resolve the exception. Please try again.');
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resolve ${exceptionLabel}`}
      description="Recorded as an audited action."
    >
      <EntityForm
        schema={resolveSchema}
        defaultValues={{ resolutionCode: 're_verified', remarks: '', evidenceRef: '' }}
        onSubmit={onSubmit}
        onError={onError}
        submitLabel="Resolve exception"
      >
        <FormSelect name="resolutionCode" label="Resolution code" required options={RESOLUTION_OPTIONS} />
        <FormTextarea name="remarks" label="Remarks" required rows={3} maxLength={1000} />
        <EvidenceField />
      </EntityForm>
    </Modal>
  );
}
