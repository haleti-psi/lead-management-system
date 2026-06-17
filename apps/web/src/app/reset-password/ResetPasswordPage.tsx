import { useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityForm, FormField } from '@/components/forms/EntityForm';
import { apiClient, isApiClientError } from '@/lib/api';

const ResetSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
});
type ResetValues = z.infer<typeof ResetSchema>;

export function ResetPasswordPage(): JSX.Element {
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async ({ email }: ResetValues): Promise<void> => {
    // Always 200 (no user enumeration); the success copy is intentionally generic.
    await apiClient.post('/auth/reset', { email }, { skipAuthRefresh: true });
    setSubmitted(true);
  };

  const onError = (error: unknown): void => {
    if (isApiClientError(error) && error.code === 'RATE_LIMITED') {
      toast.error('Too many attempts. Please wait and try again.');
      return;
    }
    toast.error('Something went wrong. Please try again.');
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-[420px]">
        <CardHeader className="space-y-3 text-center">
          <div
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground"
            aria-hidden
          >
            L
          </div>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <p role="status" className="text-sm text-muted-foreground">
              If that email is registered, a reset link has been sent.
            </p>
          ) : (
            <EntityForm<ResetValues>
              schema={ResetSchema}
              defaultValues={{ email: '' }}
              onSubmit={onSubmit}
              onError={onError}
              submitLabel="Send reset link"
            >
              <FormField name="email" label="Email" type="email" autoComplete="email" required />
            </EntityForm>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
