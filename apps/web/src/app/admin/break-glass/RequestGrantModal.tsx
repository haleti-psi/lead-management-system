import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect, FormTextarea } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useRequestBreakGlass } from '@/hooks/use-break-glass';
import type { BreakGlassRequestBody } from '@/types/break-glass';

/**
 * FR-003 §UI — Request a break-glass grant. Mirrors the server's
 * `makeBreakGlassRequestSchema` (`break-glass.dto.ts`) so the obvious mistakes are
 * caught inline before the round-trip; the server re-validates and remains
 * authoritative (any `VALIDATION_ERROR.fields[]` is mapped back onto the fields by
 * {@link EntityForm}). Four-eyes is enforced here (approver ≠ grantee) and again
 * server-side.
 *
 * Grantee selection: defaults to the current user (the common self-request), but
 * the field is editable so an ADMIN/DPO can request access *for* another user by
 * entering their user id (grant-to-other) — the LLD's "user picker" without a
 * users-list dependency (this screen has no such endpoint).
 */

/** Documented default of `BREAK_GLASS_MAX_WINDOW_HOURS` (environment-contract.md;
 * server-side and not exposed to the client, so we mirror the default as a hint). */
const MAX_WINDOW_HOURS = 48;
const MILLIS_PER_HOUR = 1000 * 60 * 60;

const SCOPE_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'branch', label: 'Branch' },
  { value: 'all', label: 'All (org-wide)' },
] as const;

const requestSchema = z
  .object({
    granteeId: z.string().uuid('Grantee must be a valid user id.'),
    approverId: z.string().uuid('Approver must be a valid user id.'),
    scopeType: z.enum(['lead', 'branch', 'all']),
    scopeRef: z.string().trim().optional().or(z.literal('')),
    reason: z
      .string()
      .trim()
      .min(1, 'A reason is required.')
      .max(500, 'Reason must be 500 characters or fewer.'),
    validFrom: z.string().min(1, 'Valid from is required.'),
    validUntil: z.string().min(1, 'Valid until is required.'),
  })
  .superRefine((val, ctx) => {
    if (val.approverId && val.granteeId && val.approverId === val.granteeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approverId'],
        message: 'Approver must be different from grantee (four-eyes required).',
      });
    }
    if (val.scopeType !== 'all' && !val.scopeRef?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopeRef'],
        message: 'A scope reference is required when scope is lead or branch.',
      });
    } else if (val.scopeType !== 'all' && val.scopeRef?.trim()) {
      const uuid = z.string().uuid();
      if (!uuid.safeParse(val.scopeRef.trim()).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scopeRef'],
          message: 'Scope reference must be a valid id.',
        });
      }
    }

    const from = new Date(val.validFrom).getTime();
    const until = new Date(val.validUntil).getTime();
    if (Number.isNaN(from) || Number.isNaN(until)) return;
    if (until <= from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'Valid until must be after valid from.',
      });
    } else if ((until - from) / MILLIS_PER_HOUR > MAX_WINDOW_HOURS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: `Access window must not exceed ${MAX_WINDOW_HOURS} hours.`,
      });
    }
  });

type RequestValues = z.infer<typeof requestSchema>;

function onError(error: unknown): void {
  if (isApiClientError(error) && error.code === 'FORBIDDEN') {
    toast.error("You don't have permission to request this grant.");
    return;
  }
  if (isApiClientError(error) && error.code === 'NOT_FOUND') {
    toast.error('A referenced user or scope reference does not exist.');
    return;
  }
  if (isApiClientError(error) && error.code === 'CONFLICT') {
    toast.error('This request conflicts with the current state. Refresh and retry.');
    return;
  }
  toast.error('Could not request the grant. Please try again.');
}

/** Convert a `datetime-local` value (`YYYY-MM-DDTHH:mm`, local) to a full
 * ISO-8601 timestamp the API accepts. */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

export function RequestGrantModal({
  currentUserId,
  onClose,
}: {
  currentUserId: string;
  onClose: () => void;
}): JSX.Element {
  const request = useRequestBreakGlass();

  async function onSubmit(v: RequestValues): Promise<void> {
    const body: BreakGlassRequestBody = {
      granteeId: v.granteeId.trim(),
      approverId: v.approverId.trim(),
      scopeType: v.scopeType,
      reason: v.reason.trim(),
      validFrom: toIso(v.validFrom),
      validUntil: toIso(v.validUntil),
      ...(v.scopeType !== 'all' && v.scopeRef?.trim() ? { scopeRef: v.scopeRef.trim() } : {}),
    };
    await request.mutateAsync(body);
    toast.success('Grant requested. Awaiting approver confirmation.');
    onClose();
  }

  return (
    <EntityForm
      schema={requestSchema}
      defaultValues={{
        granteeId: currentUserId,
        approverId: '',
        scopeType: 'lead',
        scopeRef: '',
        reason: '',
        validFrom: '',
        validUntil: '',
      }}
      onSubmit={onSubmit}
      onError={onError}
      submitLabel="Request grant"
    >
      <FormField
        name="granteeId"
        label="Grantee user id"
        required
        autoComplete="off"
        placeholder="Defaults to you; enter another user id to grant on their behalf"
      />
      <FormField
        name="approverId"
        label="Approver user id"
        required
        autoComplete="off"
        placeholder="A different ADMIN/DPO user id (four-eyes)"
      />
      <FormSelect name="scopeType" label="Scope" required options={SCOPE_OPTIONS} />
      <FormField
        name="scopeRef"
        label="Scope reference (lead / branch id)"
        autoComplete="off"
        placeholder="Required for lead or branch scope"
      />
      <FormTextarea name="reason" label="Reason" required maxLength={500} rows={3} />
      <FormField name="validFrom" label="Valid from" type="datetime-local" required />
      <FormField
        name="validUntil"
        label={`Valid until (within ${MAX_WINDOW_HOURS}h)`}
        type="datetime-local"
        required
      />
    </EntityForm>
  );
}
