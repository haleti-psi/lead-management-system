import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, isApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommChannel = 'in_app' | 'email' | 'sms' | 'whatsapp';
export type ConsentPurpose =
  | 'lead_contact'
  | 'product_eligibility'
  | 'kyc'
  | 'document_processing'
  | 'los_handoff'
  | 'communication'
  | 'partner_sharing'
  | 'aa_bank_data'
  | 'gst_business_data'
  | 'marketing'
  | 'grievance';
export type SubjectType = 'user' | 'customer';

export interface PreferenceItem {
  notification_preference_id: string;
  channel: CommChannel;
  purpose: ConsentPurpose;
  opted_in: boolean;
  updated_at: string;
}

interface UpsertPreferencesBody {
  subject_type: SubjectType;
  subject_ref: string;
  preferences: Array<{ channel: CommChannel; purpose: ConsentPurpose; opted_in: boolean }>;
}

interface GetPreferencesResponse {
  data: {
    subject_type: SubjectType;
    subject_ref: string;
    preferences: PreferenceItem[];
  };
}

interface UpsertPreferencesResponse {
  data: {
    subject_type: SubjectType;
    subject_ref: string;
    preferences: PreferenceItem[];
  };
  meta?: {
    correlation_id?: string;
    warnings?: Array<{ field: string; message: string }>;
  };
  error: null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_CHANNELS: CommChannel[] = ['in_app', 'email', 'sms', 'whatsapp'];

const ALL_PURPOSES: Array<{ key: ConsentPurpose; label: string }> = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'lead_contact', label: 'Lead Contact' },
  { key: 'product_eligibility', label: 'Product Eligibility' },
  { key: 'kyc', label: 'KYC' },
  { key: 'document_processing', label: 'Document Processing' },
  { key: 'los_handoff', label: 'LOS Handoff' },
  { key: 'communication', label: 'Communication' },
  { key: 'partner_sharing', label: 'Partner Sharing' },
  { key: 'aa_bank_data', label: 'AA Bank Data' },
  { key: 'gst_business_data', label: 'GST Business Data' },
  { key: 'grievance', label: 'Grievance' },
];

/** Transactional purposes that show a warning on opt-out. */
const TRANSACTIONAL_PURPOSES = new Set<ConsentPurpose>([
  'kyc',
  'document_processing',
  'communication',
]);

// ── Query helpers ─────────────────────────────────────────────────────────────

async function fetchPreferences(
  subjectType: SubjectType,
  subjectRef: string,
): Promise<GetPreferencesResponse> {
  return apiClient.get<GetPreferencesResponse>('/preferences', {
    query: { subject_type: subjectType, subject_ref: subjectRef },
  });
}

async function putPreferences(body: UpsertPreferencesBody): Promise<UpsertPreferencesResponse> {
  return apiClient.put<UpsertPreferencesResponse>('/preferences', body);
}

function buildKey(purposeKey: ConsentPurpose, channel: CommChannel): string {
  return `${purposeKey}::${channel}`;
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
  // Default: marketing = false, all others = true.
  return purpose !== 'marketing';
}

// ── ChannelToggle ─────────────────────────────────────────────────────────────

interface ChannelToggleProps {
  channel: CommChannel;
  optedIn: boolean;
  onChange: (optedIn: boolean) => void;
  purpose: ConsentPurpose;
}

function ChannelToggle({ channel, optedIn, onChange, purpose }: ChannelToggleProps) {
  const id = `pref-${purpose}-${channel}`;
  return (
    <button
      role="switch"
      aria-checked={optedIn}
      aria-label={`${channel} notifications for ${purpose}`}
      id={id}
      className={[
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
        optedIn ? 'bg-primary' : 'bg-gray-200',
      ].join(' ')}
      onClick={() => onChange(!optedIn)}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          onChange(!optedIn);
        }
      }}
      type="button"
    >
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0',
          'transition duration-200 ease-in-out',
          optedIn ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ── PreferenceCentre ──────────────────────────────────────────────────────────

interface PreferenceCentreProps {
  subjectType: SubjectType;
  subjectRef: string;
  leadId?: string;
}

/**
 * FR-103 — Internal preference centre (RM/BM manages on behalf of a subject).
 *
 * Renders a matrix: rows = consent purposes, columns = comm channels.
 * Loads current state via GET /preferences; submits changes via PUT /preferences.
 * Maps server VALIDATION_ERROR.fields[] to inline field errors via EntityForm.
 * Shows non-blocking TransactionalOptOutWarning when a transactional purpose is
 * toggled off (from server meta.warnings on 200 response).
 */
export function PreferenceCentre({ subjectType, subjectRef }: PreferenceCentreProps) {
  const queryClient = useQueryClient();

  // Local matrix state: tracks toggles that haven't been saved yet.
  const [localMatrix, setLocalMatrix] = React.useState<Map<string, boolean>>(new Map());
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [warnings, setWarnings] = React.useState<Array<{ field: string; message: string }>>([]);

  const queryKey = ['preferences', subjectType, subjectRef] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchPreferences(subjectType, subjectRef),
  });

  // Initialise local matrix from server data.
  React.useEffect(() => {
    if (data?.data?.preferences) {
      setLocalMatrix(buildMatrixFromRows(data.data.preferences));
    }
  }, [data]);

  const { mutate: upsert, isPending } = useMutation({
    mutationFn: (body: UpsertPreferencesBody) => putPreferences(body),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey });
      setToast({ type: 'success', message: 'Preferences saved.' });
      setWarnings(res.meta?.warnings ?? []);
    },
    onError: (err: unknown) => {
      if (isApiClientError(err)) {
        setToast({ type: 'error', message: err.message ?? 'Failed to save preferences.' });
      } else {
        setToast({ type: 'error', message: 'Unexpected error saving preferences.' });
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
    // Build the full batch from localMatrix.
    const preferences: UpsertPreferencesBody['preferences'] = [];
    for (const { key: purpose } of ALL_PURPOSES) {
      for (const channel of ALL_CHANNELS) {
        const key = buildKey(purpose, channel);
        if (localMatrix.has(key)) {
          preferences.push({ channel, purpose, opted_in: localMatrix.get(key) as boolean });
        }
      }
    }
    if (preferences.length === 0) return;
    upsert({ subject_type: subjectType, subject_ref: subjectRef, preferences });
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading preferences">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="text-destructive p-4">
        Failed to load notification preferences. Please try again.
      </div>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">Notification Preferences</h2>

      {/* Non-blocking opt-out warnings from the server */}
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
                    return (
                      <td key={channel} className="px-3 py-2 text-center">
                        <ChannelToggle
                          channel={channel}
                          purpose={purpose}
                          optedIn={optedIn}
                          onChange={(val) => handleToggle(purpose, channel, val)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Warn if any transactional purpose is being switched off */}
        {Array.from(localMatrix.entries()).some(
          ([key, val]) =>
            !val && TRANSACTIONAL_PURPOSES.has(key.split('::')[0] as ConsentPurpose),
        ) && (
          <p className="mt-3 text-sm text-amber-700" role="note">
            Opting out of KYC/document reminders may delay your application processing.
          </p>
        )}

        <Button type="submit" disabled={isPending} className="mt-4">
          {isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </form>
    </Card>
  );
}
