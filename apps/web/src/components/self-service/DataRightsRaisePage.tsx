// @vitest-environment jsdom
/**
 * FR-112 — Customer link micro-site: raise a data-rights request.
 *
 * Route: /c/{token}/data-rights
 * Auth:  CustomerLinkGuard (OTP step-up; no JWT). No DPO role required.
 *
 * The page submits to `POST /api/v1/c/{token}/data-rights` (customer link path).
 * On success it shows the request reference number in a toast / success message.
 *
 * LLD §UI Component Tree §Customer Link Micro-site.
 * WCAG 2.1 AA: all interactive elements keyboard-reachable; Radix/shadcn
 * Select primitives provide accessible focus management.
 */

import { useState } from 'react';
import type { ApiEnvelope } from '@lms/shared';
import type { RightsType, DataRightsItem } from '../compliance/data-rights.types';

interface DataRightsRaisePageProps {
  /** Opaque customer-link token from the URL. */
  token: string;
  /** Bound lead_id from the validated customer-link token (null if no lead). */
  boundLeadId: string | null;
}

const RIGHTS_TYPE_OPTIONS: Array<{ value: RightsType; label: string }> = [
  { value: 'access', label: 'Access my data' },
  { value: 'correction', label: 'Correct my data' },
  { value: 'update', label: 'Update my data' },
  { value: 'erasure', label: 'Erase my data' },
  { value: 'withdrawal', label: 'Withdraw consent' },
  { value: 'grievance', label: 'File a grievance about my data' },
];

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Customer-facing data-rights intake form.
 * Submits to the CustomerLinkGuard-protected endpoint (no JWT).
 */
export function DataRightsRaisePage({
  token,
  boundLeadId,
}: DataRightsRaisePageProps) {
  const [requestType, setRequestType] = useState<RightsType | ''>('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [referenceId, setReferenceId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [typeError, setTypeError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requestType) {
      setTypeError('Please select a request type.');
      return;
    }
    setTypeError('');
    setSubmitState('submitting');
    setErrorMessage('');

    try {
      const res = await fetch(`/api/v1/c/${encodeURIComponent(token)}/data-rights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: requestType,
          lead_id: boundLeadId ?? undefined,
        }),
      });

      const json = (await res.json()) as ApiEnvelope<DataRightsItem>;

      if (!res.ok || json.error) {
        setErrorMessage(json.error?.message ?? 'Something went wrong. Please try again.');
        setSubmitState('error');
        return;
      }

      setReferenceId(json.data?.dataRightsRequestId ?? '');
      setSubmitState('success');
    } catch {
      setErrorMessage('A network error occurred. Please try again.');
      setSubmitState('error');
    }
  }

  if (submitState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div
          role="alert"
          className="max-w-md w-full bg-white dark:bg-card rounded-lg shadow p-8 text-center"
        >
          <div className="text-green-600 text-4xl mb-4" aria-hidden="true">
            ✓
          </div>
          <h1 className="text-xl font-semibold mb-2">Request Registered</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
            Your request has been registered.
            {referenceId && (
              <>
                {' '}
                Reference:{' '}
                <span className="font-mono font-medium">{referenceId}</span>
              </>
            )}
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-xs">
            Our Data Protection Officer will review and respond within the applicable
            regulatory timeframe.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-card rounded-lg shadow p-8">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
          Exercise Your Data Rights
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
          Submit a request to access, correct, update, erase, or withdraw consent for
          your personal data.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-6">
          {/* Request type select */}
          <div>
            <label
              htmlFor="request-type"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Request Type <span className="text-red-500">*</span>
            </label>
            <select
              id="request-type"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={requestType}
              onChange={(e) => {
                setRequestType(e.target.value as RightsType | '');
                setTypeError('');
              }}
              aria-required
              aria-describedby={typeError ? 'type-error' : undefined}
            >
              <option value="">Select a request type…</option>
              {RIGHTS_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeError && (
              <p id="type-error" className="mt-1 text-sm text-red-600" role="alert">
                {typeError}
              </p>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="w-full bg-indigo-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
            disabled={submitState === 'submitting'}
            aria-busy={submitState === 'submitting'}
          >
            {submitState === 'submitting' ? 'Submitting…' : 'Submit Request'}
          </button>

          {/* Error feedback */}
          {submitState === 'error' && (
            <p className="text-sm text-red-600" role="alert">
              {errorMessage}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
