import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, isApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton';
import { ErrorState } from '@/components/common/ErrorState';

import type { CommChannel, ConsentPurpose, PreferenceItem } from '../engagement/PreferenceCentre';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GetCustomerPreferencesResponse {
  data: {
    subject_type: 'customer';
    subject_ref: string;
    preferences: PreferenceItem[];
  };
}

interface UpsertCustomerPreferencesResponse {
  data: {
    subject_type: 'customer';
    subject_ref: string;
    preferences: PreferenceItem[];
  };
  warnings?: Array<{ field: string; message: string }>;
}

// ── Constants (mirrored from PreferenceCentre) ────────────────────────────────

const ALL_CHANNELS: CommChannel[] = ['in_app', 'email', 'sms', 'whatsapp'];

const ALL_PURPOSES: Array<{ key: ConsentPurpose; label: string }> = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'lead_contact', label: 'Lead Contact' },
  { key: 'product_eligibility', label: 'Product Eligibility' },
  { key: 'kyc', label: 'KYC' },
  { key: 'document_processing', label: 'Document Processing' },
  { key: 'communication', label: 'Communication' },
  { key: 'grievance', label: 'Grievance' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildKey(purpose: ConsentPurpose, channel: CommChannel): string {
  return `${purpose}::${channel}`;
}

function buildMatrixFromRows(rows: PreferenceItem[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const row of rows) {
    m.set(buildKey(row.purpose, row.channel), row.opted_in);
  }
  return m;
}

function getOptedIn(
  matrix: Map<string, boolean>,
  purpose: ConsentPurpose,
  channel: CommChannel,
): boolean {
  const key = buildKey(purpose, channel);
  if (matrix.has(key)) return matrix.get(key) as boolean;
  return purpose !== 'marketing';
}

// ── CustomerPreferenceCentre ──────────────────────────────────────────────────

interface CustomerPreferenceCentreProps {
  /** The opaque link token from the URL. */
  token: string;
  /** The customer_profile_id bound to the token (provided by the link resolution step). */
  customerProfileId: string;
}

/**
 * FR-103 — Customer self-service preference panel.
 *
 * Same preference matrix layout as PreferenceCentre, simplified shell (no AppShell;
 * micro-site layout). Uses the `/c/{token}/preferences` routes, which are
 * public (no JWT) but require the token to be valid (CustomerLinkPort).
 *
 * Accessible: keyboard toggle via Space, aria-label per toggle, role="switch".
 */
export function CustomerPreferenceCentre({
  token,
  customerProfileId,
}: CustomerPreferenceCentreProps) {
  const queryClient = useQueryClient();
  const [localMatrix, setLocalMatrix] = React.useState<Map<string, boolean>>(new Map());
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [warnings, setWarnings] = React.useState<Array<{ field: string; message: string }>>([]);

  const queryKey = ['customer-preferences', token, customerProfileId] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<GetCustomerPreferencesResponse>(`/c/${token}/preferences`, {
        query: { subject_type: 'customer', subject_ref: customerProfileId },
      }),
  });

  React.useEffect(() => {
    if (data?.data?.preferences) {
      setLocalMatrix(buildMatrixFromRows(data.data.preferences));
    }
  }, [data]);

  const { mutate: upsert, isPending } = useMutation({
    mutationFn: (preferences: Array<{ channel: CommChannel; purpose: ConsentPurpose; opted_in: boolean }>) =>
      apiClient.put<UpsertCustomerPreferencesResponse>(`/c/${token}/preferences`, {
        subject_type: 'customer',
        subject_ref: customerProfileId,
        preferences,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey });
      setToast({ type: 'success', message: 'Your preferences have been saved.' });
      setWarnings(res.warnings ?? []);
    },
    onError: (err: unknown) => {
      if (isApiClientError(err)) {
        setToast({ type: 'error', message: err.message ?? 'Failed to save preferences.' });
      } else {
        setToast({ type: 'error', message: 'Unexpected error. Please try again.' });
      }
    },
  });

  function handleToggle(purpose: ConsentPurpose, channel: CommChannel, newValue: boolean) {
    setLocalMatrix((prev) => {
      const next = new Map(prev);
      next.set(buildKey(purpose, channel), newValue);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWarnings([]);
    const preferences: Array<{ channel: CommChannel; purpose: ConsentPurpose; opted_in: boolean }> = [];
    for (const { key: purpose } of ALL_PURPOSES) {
      for (const channel of ALL_CHANNELS) {
        const key = buildKey(purpose, channel);
        if (localMatrix.has(key)) {
          preferences.push({ channel, purpose, opted_in: localMatrix.get(key) as boolean });
        }
      }
    }
    if (preferences.length === 0) return;
    upsert(preferences);
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading preferences" className="p-4">
        <LoadingSkeleton rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Unable to load your preferences"
        message="Please try again later."
        onRetry={() => void queryClient.invalidateQueries({ queryKey })}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Notification Preferences</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Manage how we contact you about your application.
      </p>

      {warnings.length > 0 && (
        <div role="alert" className="mb-4 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          {warnings.map((w) => (
            <p key={w.field}>{w.message}</p>
          ))}
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'mb-4 rounded-md p-3 text-sm',
            toast.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800',
          ].join(' ')}
        >
          {toast.message}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Purpose</th>
                {ALL_CHANNELS.map((ch) => (
                  <th key={ch} className="px-3 py-2 font-medium text-muted-foreground capitalize">
                    {ch.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PURPOSES.map(({ key: purpose, label }) => (
                <tr key={purpose} className="border-t">
                  <td className="py-2 pr-4 font-medium">{label}</td>
                  {ALL_CHANNELS.map((channel) => {
                    const optedIn = getOptedIn(localMatrix, purpose, channel);
                    const id = `pref-${purpose}-${channel}`;
                    return (
                      <td key={channel} className="px-3 py-2 text-center">
                        <button
                          role="switch"
                          aria-checked={optedIn}
                          aria-label={`${channel.replace('_', ' ')} for ${label}`}
                          id={id}
                          className={[
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                            'transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                            optedIn ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-600',
                          ].join(' ')}
                          onClick={() => handleToggle(purpose, channel, !optedIn)}
                          onKeyDown={(e) => {
                            if (e.key === ' ') {
                              e.preventDefault();
                              handleToggle(purpose, channel, !optedIn);
                            }
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-200 shadow ring-0',
                              'transition duration-200 ease-in-out',
                              optedIn ? 'translate-x-5' : 'translate-x-0',
                            ].join(' ')}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button type="submit" disabled={isPending} className="mt-6 w-full">
          {isPending ? 'Saving…' : 'Save Preferences'}
        </Button>
      </form>
    </div>
  );
}
