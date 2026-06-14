import { useState, type ReactElement, type FormEvent } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiClientError } from '@/lib/api';

import type { CommChannel, ConsentPurpose, TemplateDto } from '../../admin/templates/use-templates';
import { useTemplates } from '../../admin/templates/use-templates';
import { useSendCommunication } from './use-communications';

/** Consent status display — derived from consent_records (FR-110). */
interface ConsentIndicatorProps {
  isGranted: boolean;
  purpose: ConsentPurpose | '';
}

function ConsentIndicator({ isGranted, purpose }: ConsentIndicatorProps): ReactElement | null {
  if (purpose === '') return null;
  if (isGranted) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        Consent: Granted
      </span>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        Consent: Not Granted
      </span>
      <p role="alert" className="mt-1 text-xs text-red-600">
        Customer has not granted consent for this purpose.
      </p>
    </div>
  );
}

// ── Client-side schema ────────────────────────────────────────────────────────

const INDIA_MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SendSchema = z
  .object({
    template_id: z.string().uuid('Please select a valid template.'),
    channel: z.string().min(1, 'Please select a channel.') as z.ZodType<CommChannel>,
    consent_basis: z.string().min(1, 'Please select a consent purpose.') as z.ZodType<ConsentPurpose>,
    recipient: z.string().min(1, 'Recipient is required.'),
  })
  .superRefine((data, ctx) => {
    if (data.channel === 'sms' || data.channel === 'whatsapp') {
      if (!INDIA_MOBILE_RE.test(data.recipient)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Recipient format is invalid for the selected channel.',
          path: ['recipient'],
        });
      }
    } else if (data.channel === 'email') {
      if (!EMAIL_RE.test(data.recipient)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Recipient format is invalid for the selected channel.',
          path: ['recipient'],
        });
      }
    }
  });

interface SendCommunicationDrawerProps {
  leadId: string;
  /** Pre-filled recipient (from lead identity, editable). */
  defaultRecipient?: string;
  /**
   * Whether the current purpose has granted consent.
   * The host resolves this from FR-110 consent status; absence = not granted.
   */
  consentGranted?: boolean;
  onClose: () => void;
  onSent?: () => void;
}

/**
 * FR-101 — Drawer for sending a templated message to a lead.
 * UI-03: disables Send when consent is not granted; shows consent warning alert.
 */
export function SendCommunicationDrawer({
  leadId,
  defaultRecipient = '',
  consentGranted = false,
  onClose,
  onSent,
}: SendCommunicationDrawerProps): ReactElement {
  const [formData, setFormData] = useState({
    template_id: '',
    channel: '' as CommChannel | '',
    consent_basis: '' as ConsentPurpose | '',
    recipient: defaultRecipient,
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Fetch active templates for the template selector.
  const { data: templatesData } = useTemplates({ status: 'active', limit: 100 });
  const activeTemplates: TemplateDto[] = templatesData?.data ?? [];

  // Filter templates by selected channel for consistency.
  const channelTemplates = formData.channel
    ? activeTemplates.filter((t) => t.channel === formData.channel)
    : activeTemplates;

  const { mutateAsync, isPending, reset } = useSendCommunication(leadId);

  function handleChange(field: string, value: string): void {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  // Consent check: only show/block when purpose is selected.
  const showConsentWarning = formData.consent_basis !== '' && !consentGranted;
  const canSend = !showConsentWarning && !isPending;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setServerError(null);

    const parseResult = SendSchema.safeParse(formData);
    if (!parseResult.success) {
      const errors: Record<string, string> = {};
      for (const issue of parseResult.error.issues) {
        const f = issue.path[0];
        if (typeof f === 'string' && !(f in errors)) errors[f] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    try {
      await mutateAsync(parseResult.data);
      setToastMsg('Message queued for delivery.');
      setTimeout(() => {
        setToastMsg(null);
        onSent?.();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      reset();
      if (isApiClientError(err)) {
        // Consent gate: FORBIDDEN + CONSENT_MISSING sub-reason.
        if (err.detail != null && (err.detail as { reason?: string })['reason'] === 'CONSENT_MISSING') {
          setServerError('Cannot send: consent is not granted for this purpose.');
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
      aria-label="Send Message"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="text-base font-semibold">Send Message</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
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

        <form
          id="send-comm-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4"
          noValidate
        >
          <div>
            <Label htmlFor="channel">Channel *</Label>
            <select
              id="channel"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.channel}
              onChange={(e) => {
                handleChange('channel', e.target.value);
                // Clear template when channel changes (consistency gate).
                handleChange('template_id', '');
              }}
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
            <Label htmlFor="template_id">Template *</Label>
            <select
              id="template_id"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.template_id}
              onChange={(e) => handleChange('template_id', e.target.value)}
              aria-invalid={fieldErrors['template_id'] != null}
            >
              <option value="">Select template</option>
              {channelTemplates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.code} (v{t.version})
                </option>
              ))}
            </select>
            {fieldErrors['template_id'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['template_id']}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="consent_basis">Consent Purpose *</Label>
            <select
              id="consent_basis"
              className="w-full rounded border px-2 py-1.5 text-sm"
              value={formData.consent_basis}
              onChange={(e) => handleChange('consent_basis', e.target.value)}
              aria-invalid={fieldErrors['consent_basis'] != null}
            >
              <option value="">Select purpose</option>
              <option value="lead_contact">Lead Contact</option>
              <option value="communication">Communication</option>
              <option value="marketing">Marketing</option>
            </select>
            {fieldErrors['consent_basis'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {fieldErrors['consent_basis']}
              </p>
            ) : null}
          </div>

          {/* Consent status indicator (UI-03). */}
          <ConsentIndicator
            isGranted={consentGranted}
            purpose={formData.consent_basis as ConsentPurpose | ''}
          />

          <div>
            <Label htmlFor="recipient">Recipient *</Label>
            <Input
              id="recipient"
              value={formData.recipient}
              onChange={(e) => handleChange('recipient', e.target.value)}
              placeholder={formData.channel === 'email' ? 'email@example.com' : '9876543210'}
              aria-invalid={fieldErrors['recipient'] != null}
            />
            {fieldErrors['recipient'] != null ? (
              <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors['recipient']}</p>
            ) : null}
          </div>
        </form>
      </div>

      <div className="border-t px-6 py-4">
        <Button
          type="submit"
          form="send-comm-form"
          className="w-full"
          disabled={!canSend}
          aria-disabled={!canSend}
        >
          {isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
