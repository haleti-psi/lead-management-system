import * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Loader2, LinkIcon, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { EntityForm, FormField, FormTextarea } from '@/components/forms/EntityForm';
import { StatusChip } from '@/components/ui/StatusChip';
import { isApiClientError } from '@/lib/api';
import {
  useCustomerStatus,
  useRequestCallback,
  type CustomerStatusData,
} from '@/hooks/use-customer-status';

/**
 * FR-062 §UI — public customer status view at `/c/:token/status`. Customer-safe
 * stage label + description, outstanding actions, and a callback request form
 * (hidden once the application is with the lending team). 404 surfaces a friendly
 * terminal state — never a login redirect.
 */
export function StatusPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useCustomerStatus(token ?? '');

  if (!token) return <Navigate to="/" replace />;

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
          <CardTitle>Application status</CardTitle>
          <CardDescription>Track the progress of your application.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10" role="status" aria-label="Loading">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : isError || !data ? (
            <EmptyState
              icon={<LinkIcon className="h-8 w-8" aria-hidden />}
              title="This link is no longer valid"
              message="The link may have expired. Please contact your relationship manager for a new link."
            />
          ) : (
            <StatusBody data={data} />
          )}
        </CardContent>
      </Card>

      {data && !data.is_handed_off ? <CallbackCard token={token} /> : null}
    </main>
  );
}

function StatusBody({ data }: { data: CustomerStatusData }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{data.lead_code}</span>
        <StatusChip label={data.stage_label} tone={data.is_handed_off ? 'success' : 'info'} />
      </div>
      <p className="text-sm">{data.stage_description}</p>
      {data.pending_actions.length > 0 ? (
        <div>
          <h2 className="mb-1 text-sm font-medium">What we need from you</h2>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {data.pending_actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const callbackSchema = z.object({
  preferred_slot: z.string().min(1, 'Please choose a preferred time.'),
  note: z.string().trim().max(500, 'Maximum 500 characters.').optional(),
});
type CallbackFormValues = z.infer<typeof callbackSchema>;

/** Minimum selectable slot = now + 30 min, formatted for a datetime-local input. */
function minSlotLocal(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CallbackCard({ token }: { token: string }): JSX.Element {
  const [done, setDone] = React.useState(false);
  const callback = useRequestCallback(token);

  async function onSubmit(values: CallbackFormValues): Promise<void> {
    await callback.mutateAsync({
      // datetime-local has no timezone; toISOString() yields a UTC offset the API accepts.
      preferred_slot: new Date(values.preferred_slot).toISOString(),
      ...(values.note?.trim() ? { note: values.note.trim() } : {}),
    });
    setDone(true);
  }

  function onError(error: unknown): void {
    if (isApiClientError(error) && error.code === 'RATE_LIMITED') {
      toast.error('Too many requests. Please wait a moment and try again.');
      return;
    }
    if (isApiClientError(error) && error.code === 'NOT_FOUND') {
      toast.error('This link is no longer valid. Please reopen your link.');
      return;
    }
    toast.error('Could not request a callback. Please try again.');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a callback</CardTitle>
        <CardDescription>Tell us when it's convenient and we'll call you.</CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
            <CheckCircle2 className="h-8 w-8 text-green-600" aria-hidden />
            <p className="text-sm">Your callback request has been received. We'll call you at your preferred time.</p>
          </div>
        ) : (
          <EntityForm
            schema={callbackSchema}
            defaultValues={{ preferred_slot: '', note: '' }}
            onSubmit={onSubmit}
            onError={onError}
            submitLabel="Request callback"
          >
            <FormField name="preferred_slot" label="Preferred time" type="datetime-local" required min={minSlotLocal()} />
            <FormTextarea name="note" label="Message (optional)" rows={2} maxLength={500} />
          </EntityForm>
        )}
      </CardContent>
    </Card>
  );
}
