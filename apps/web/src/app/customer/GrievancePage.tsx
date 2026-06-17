import * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityForm, FormField, FormSelect, FormTextarea } from '@/components/forms/EntityForm';
import { isApiClientError } from '@/lib/api';
import { useCreateGrievance, type CreateGrievanceData } from '@/hooks/use-create-grievance';

/** Mirror of the server GrievanceCategory enum (labels customer-facing). */
const CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'service_delay', label: 'Service delay' },
  { value: 'mis_selling', label: 'Mis-selling' },
  { value: 'data_privacy', label: 'Data privacy' },
  { value: 'document_issue', label: 'Document issue' },
  { value: 'staff_conduct', label: 'Staff conduct' },
  { value: 'other', label: 'Other' },
];
const CATEGORY_VALUES = CATEGORY_OPTIONS.map((o) => o.value) as [string, ...string[]];

const grievanceSchema = z.object({
  category: z.enum(CATEGORY_VALUES, { errorMap: () => ({ message: 'Please choose a category.' }) }),
  description: z.string().trim().min(1, 'Please describe your grievance.').max(2000, 'Maximum 2000 characters.'),
  attachmentNote: z.string().trim().max(500, 'Maximum 500 characters.').optional(),
});
type GrievanceFormValues = z.infer<typeof grievanceSchema>;

/**
 * FR-061 §UI — public grievance intake at `/c/:token/grievance`. Customer-facing
 * (no AppShell). On success shows the reference number; an invalid/expired
 * link/session (404) is surfaced inline, never as a login redirect.
 */
export function GrievancePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [done, setDone] = React.useState<CreateGrievanceData | null>(null);
  const create = useCreateGrievance(token ?? '');

  if (!token) return <Navigate to="/" replace />;

  async function onSubmit(values: GrievanceFormValues): Promise<void> {
    const data = await create.mutateAsync({
      category: values.category,
      description: values.description.trim(),
      ...(values.attachmentNote?.trim() ? { attachmentNote: values.attachmentNote.trim() } : {}),
    });
    setDone(data);
  }

  function onError(error: unknown): void {
    if (isApiClientError(error) && error.code === 'NOT_FOUND') {
      toast.error('This link is no longer valid, or your session has expired. Please reopen your link.');
      return;
    }
    toast.error('Could not register your grievance. Please try again.');
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden>
          L
        </div>
        <span className="text-base font-semibold tracking-tight">LMS</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Raise a grievance</CardTitle>
          <CardDescription>Tell us about your concern and we'll register it with a reference number.</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
              <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
              <p className="font-medium">Grievance registered</p>
              <p className="text-sm text-muted-foreground">
                Your reference number is <span className="font-semibold">{done.grievanceNo}</span>. Please keep it for
                follow-up.
              </p>
            </div>
          ) : (
            <EntityForm
              schema={grievanceSchema}
              defaultValues={{ category: 'service_delay', description: '', attachmentNote: '' }}
              onSubmit={onSubmit}
              onError={onError}
              submitLabel="Submit grievance"
            >
              <FormSelect name="category" label="Category" required options={CATEGORY_OPTIONS} />
              <FormTextarea name="description" label="Description" required rows={5} maxLength={2000} />
              <FormField name="attachmentNote" label="Reference note (optional)" maxLength={500} placeholder="e.g. email ref REF-20260601" />
            </EntityForm>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
