import { useState, type ReactElement, type FormEvent } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { CreateTemplateInput, CommChannel, CommCategory, Lang } from './use-templates';
import { useCreateTemplate } from './use-templates';
import { isApiClientError } from '@/lib/api';

// ── Client-side Zod schema (mirrors backend CreateTemplateDto). ────────────────
const CreateTemplateSchema = z.object({
  code: z
    .string()
    .min(1, 'Template code must be alphanumeric/underscore, max 60 chars.')
    .max(60, 'Template code must be alphanumeric/underscore, max 60 chars.')
    .regex(/^[A-Za-z0-9_]+$/, 'Template code must be alphanumeric/underscore, max 60 chars.'),
  version: z.coerce
    .number()
    .int('Version must be a positive integer.')
    .min(1, 'Version must be a positive integer.'),
  channel: z.enum(['in_app', 'email', 'sms', 'whatsapp'] as [CommChannel, ...CommChannel[]]),
  language: z.enum([
    'English', 'Hindi', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Gujarati', 'Bengali',
  ] as [Lang, ...Lang[]]),
  category: z.enum(['transactional', 'marketing'] as [CommCategory, ...CommCategory[]]),
  body: z
    .string()
    .min(1, 'Template body is required and must not exceed 4000 characters.')
    .max(4000, 'Template body is required and must not exceed 4000 characters.'),
});

interface TemplateCreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

/**
 * FR-101 — Modal form to create a new communication template.
 * UI-02 compliance: inline validation errors with role="alert".
 */
export function TemplateCreateModal({ onClose, onCreated }: TemplateCreateModalProps): ReactElement {
  const { mutateAsync, isPending, reset } = useCreateTemplate();

  const [formData, setFormData] = useState({
    code: '',
    version: '1',
    channel: '' as CommChannel | '',
    language: '' as Lang | '',
    category: '' as CommCategory | '',
    body: '',
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  function handleChange(field: string, value: string): void {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error on change.
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setServerError(null);

    const parseResult = CreateTemplateSchema.safeParse({
      ...formData,
      version: formData.version,
    });

    if (!parseResult.success) {
      const errors: Record<string, string> = {};
      for (const issue of parseResult.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in errors)) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    try {
      await mutateAsync(parseResult.data as CreateTemplateInput);
      setToastMsg('Template created successfully.');
      setTimeout(() => {
        setToastMsg(null);
        onCreated();
      }, 1500);
    } catch (err: unknown) {
      reset();
      if (isApiClientError(err)) {
        // Map field-level VALIDATION_ERROR onto inline errors.
        if (err.fields != null && err.fields.length > 0) {
          const errors: Record<string, string> = {};
          for (const f of err.fields) {
            if (!(f.field in errors)) errors[f.field] = f.issue;
          }
          setFieldErrors(errors);
          return;
        }
        setServerError(err.message);
        return;
      }
      setServerError('An unexpected error occurred. Please try again.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Template"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-lg rounded-lg bg-white dark:bg-card p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">New Template</h2>

        {toastMsg != null ? (
          <p role="status" className="mb-4 rounded bg-green-100 px-3 py-2 text-sm text-green-800">
            {toastMsg}
          </p>
        ) : null}

        {serverError != null ? (
          <p role="alert" className="mb-4 rounded bg-red-100 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="code">Template Code *</Label>
            <Input
              id="code"
              value={formData.code}
              onChange={(e) => handleChange('code', e.target.value)}
              aria-describedby={fieldErrors['code'] != null ? 'code-error' : undefined}
              aria-invalid={fieldErrors['code'] != null}
            />
            {fieldErrors['code'] != null ? (
              <p id="code-error" role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors['code']}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="version">Version *</Label>
            <Input
              id="version"
              type="number"
              min={1}
              value={formData.version}
              onChange={(e) => handleChange('version', e.target.value)}
              aria-invalid={fieldErrors['version'] != null}
            />
            {fieldErrors['version'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['version']}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="channel">Channel *</Label>
            <select
              id="channel"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.channel}
              onChange={(e) => handleChange('channel', e.target.value)}
              aria-invalid={fieldErrors['channel'] != null}
            >
              <option value="">Select channel</option>
              {(['in_app', 'email', 'sms', 'whatsapp'] as CommChannel[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {fieldErrors['channel'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['channel']}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="language">Language *</Label>
            <select
              id="language"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.language}
              onChange={(e) => handleChange('language', e.target.value)}
              aria-invalid={fieldErrors['language'] != null}
            >
              <option value="">Select language</option>
              {(['English', 'Hindi', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Gujarati', 'Bengali'] as Lang[]).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            {fieldErrors['language'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['language']}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="category">Category *</Label>
            <select
              id="category"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.category}
              onChange={(e) => handleChange('category', e.target.value)}
              aria-invalid={fieldErrors['category'] != null}
            >
              <option value="">Select category</option>
              {(['transactional', 'marketing'] as CommCategory[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {fieldErrors['category'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['category']}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="body">Template Body *</Label>
            <textarea
              id="body"
              rows={4}
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.body}
              onChange={(e) => handleChange('body', e.target.value)}
              aria-invalid={fieldErrors['body'] != null}
            />
            {fieldErrors['body'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['body']}</p>
            ) : null}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
