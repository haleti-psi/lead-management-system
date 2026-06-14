// @vitest-environment jsdom
//
// FR-103 frontend component tests for PreferenceCentre.
// Covers T20, T21, T22 from FR-103-tests.md §Test Cases.
// All API calls are mocked; no network required.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock API client before component imports ──────────────────────────────────

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
  isApiClientError: (e: unknown): e is { message: string } =>
    typeof e === 'object' && e !== null && 'message' in e,
}));

import { apiClient } from '@/lib/api';
import { PreferenceCentre } from './PreferenceCentre';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockPut = apiClient.put as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SUBJECT_REF = '00000000-0000-0000-0001-000000000001';

function makeGetResponse(
  preferences: Array<{
    channel: string;
    purpose: string;
    opted_in: boolean;
    notification_preference_id: string;
    updated_at: string;
  }>,
) {
  return {
    data: {
      subject_type: 'customer' as const,
      subject_ref: SUBJECT_REF,
      preferences,
    },
  };
}

function makeUpsertResponse(
  preferences: Array<{
    channel: string;
    purpose: string;
    opted_in: boolean;
    notification_preference_id: string;
    updated_at: string;
  }>,
  warnings?: Array<{ field: string; message: string }>,
) {
  return {
    data: {
      subject_type: 'customer' as const,
      subject_ref: SUBJECT_REF,
      preferences,
    },
    meta: {
      correlation_id: 'corr_test',
      ...(warnings && warnings.length > 0 ? { warnings } : {}),
    },
    error: null,
  };
}

function makePrefRow(channel: string, purpose: string, optedIn: boolean) {
  return {
    notification_preference_id: `pref-${channel}-${purpose}`,
    channel,
    purpose,
    opted_in: optedIn,
    updated_at: new Date().toISOString(),
  };
}

/** Wrap component in a fresh QueryClient per test to avoid cache sharing. */
function renderCentre() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PreferenceCentre subjectType="customer" subjectRef={SUBJECT_REF} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
});

describe('PreferenceCentre (FR-103)', () => {
  /**
   * T20 — Preference matrix renders correct initial state from GET response.
   * Mock GET returns one opted-out row for (whatsapp, marketing).
   * Toggle for (whatsapp, marketing) renders as unchecked; all others checked.
   */
  it('T20 — renders opted-out toggle as unchecked', async () => {
    mockGet.mockResolvedValue(
      makeGetResponse([
        makePrefRow('whatsapp', 'marketing', false),
      ]),
    );

    renderCentre();

    // Wait for GET to resolve and UI to update.
    const toggle = await screen.findByRole('switch', {
      name: /whatsapp.*marketing/i,
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('T20 — renders opted-in toggle as checked for lead_contact / sms', async () => {
    mockGet.mockResolvedValue(
      makeGetResponse([
        makePrefRow('sms', 'lead_contact', true),
        makePrefRow('whatsapp', 'marketing', false),
      ]),
    );

    renderCentre();

    const toggle = await screen.findByRole('switch', {
      name: /sms.*lead_contact|lead contact.*sms/i,
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  /**
   * T21 — Submit sends correct payload and shows success toast.
   * User toggles (sms, document_processing) to off, submits.
   */
  it('T21 — toggles a channel and shows success toast on submit', async () => {
    // Initial state: sms/document_processing is opted-in.
    mockGet.mockResolvedValue(
      makeGetResponse([
        makePrefRow('sms', 'document_processing', true),
      ]),
    );
    mockPut.mockResolvedValue(
      makeUpsertResponse([makePrefRow('sms', 'document_processing', false)]),
    );

    renderCentre();

    // Wait for the toggle to render.
    const toggle = await screen.findByRole('switch', {
      name: /sms.*document.processing|document.*sms/i,
    });

    // Verify initial state.
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    // Toggle it off.
    fireEvent.click(toggle);

    // Submit the form.
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    // Verify PUT was called.
    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        '/preferences',
        expect.objectContaining({
          subject_type: 'customer',
          subject_ref: SUBJECT_REF,
          preferences: expect.arrayContaining([
            expect.objectContaining({
              channel: 'sms',
              purpose: 'document_processing',
              opted_in: false,
            }),
          ]),
        }),
      );
    });

    // Verify success toast appeared.
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Preferences saved');
    });
  });

  /**
   * T22 — VALIDATION_ERROR from server shows alert (error toast).
   * Server returns a non-200 response; the component shows an error message.
   */
  it('T22 — server error shows error toast', async () => {
    mockGet.mockResolvedValue(makeGetResponse([]));
    const err = Object.assign(new Error('VALIDATION_ERROR: invalid channel'), {
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    mockPut.mockRejectedValue(err);

    renderCentre();

    // Wait for loading to finish.
    await screen.findByRole('button', { name: /save changes/i });

    // Need at least one changed pref to trigger submit; toggle a default.
    // marketing is opted-out by default, so toggle whatsapp/marketing to true.
    const toggle = await screen.findByRole('switch', {
      name: /whatsapp.*marketing|marketing.*whatsapp/i,
    });
    fireEvent.click(toggle);

    // Submit.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // Verify error toast.
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('VALIDATION_ERROR');
    });
  });

  /**
   * T14 — Transactional opt-out warning shown pre-save when a critical
   * purpose toggle is switched off.
   */
  it('T14 — shows transactional opt-out warning in the UI', async () => {
    mockGet.mockResolvedValue(
      makeGetResponse([
        makePrefRow('email', 'kyc', true),
      ]),
    );

    renderCentre();

    const toggle = await screen.findByRole('switch', {
      name: /email.*kyc|kyc.*email/i,
    });

    // Toggle kyc/email off.
    fireEvent.click(toggle);

    // The pre-save warning note should appear.
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/KYC\/document reminders/i);
  });

  /**
   * Loading state — shows skeleton (aria-busy=true).
   */
  it('shows skeleton while loading', () => {
    // GET never resolves.
    mockGet.mockImplementation(() => new Promise(() => {}));

    renderCentre();

    // The aria-busy div wraps the Skeleton.
    const busyEl = document.querySelector('[aria-busy="true"]');
    expect(busyEl).not.toBeNull();
    expect(busyEl?.getAttribute('aria-label')).toContain('Loading');
  });

  /**
   * Error state — shows error message.
   */
  it('shows error state on fetch failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));

    renderCentre();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
  });
});
