import * as React from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiClientError } from '@/lib/api';

/**
 * Shared RHF + Zod form primitive (BRD §4.5 / ui.md §Forms). Validates against a
 * Zod schema, submits on Enter, disables the submit button while submitting, and
 * maps the server's `VALIDATION_ERROR.fields[]` onto per-field inline errors.
 * Non-validation errors (RATE_LIMITED, FORBIDDEN, …) are handed to `onError` so
 * the host can surface a toast.
 */
interface EntityFormProps<T extends FieldValues> {
  schema: ZodType<T>;
  defaultValues: DefaultValues<T>;
  onSubmit: (values: T) => Promise<void>;
  /** Called for any error that isn't a per-field VALIDATION_ERROR. */
  onError?: (error: unknown) => void;
  submitLabel: string;
  children: React.ReactNode;
}

export function EntityForm<T extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  onError,
  submitLabel,
  children,
}: EntityFormProps<T>): React.ReactElement {
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues });

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR' && error.fields?.length) {
        for (const field of error.fields) {
          form.setError(field.field as Path<T>, { type: 'server', message: field.issue });
        }
        return;
      }
      onError?.(error);
    }
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {children}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </form>
    </FormProvider>
  );
}

/** A labelled input bound to the surrounding EntityForm, with an inline error
 * (`role="alert"`). Never placeholder-only (ui.md §Forms). */
interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
}

export function FormField({ name, label, required, className, ...inputProps }: FormFieldProps): React.ReactElement {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[name];
  const errorId = `${name}-error`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            {' *'}
          </span>
        ) : null}
      </Label>
      <Input
        id={name}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={className}
        {...register(name)}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} role="alert" aria-live="polite" className="text-sm text-destructive">
          {String(error.message ?? 'Invalid value')}
        </p>
      ) : null}
    </div>
  );
}
