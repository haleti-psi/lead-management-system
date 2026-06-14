// @vitest-environment jsdom
//
// FR-101 UI tests — CommunicationHistory + SendCommunicationDrawer.
// Covers UI-03 (consent warning) and UI-04 (recipient masking).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mock hooks ────────────────────────────────────────────────────────────────
vi.mock('./use-communications', () => ({
  useCommunicationLogs: vi.fn(),
  useSendCommunication: vi.fn(),
  commKeys: {
    all: (id: string) => ['leads', id, 'communications'],
    list: (id: string) => ['leads', id, 'communications', 'list'],
  },
}));

vi.mock('../../admin/templates/use-templates', () => ({
  useTemplates: vi.fn().mockReturnValue({
    data: { data: [], meta: { page: 1, limit: 25, total: 0 } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  templateKeys: { all: ['templates'], list: (f: unknown) => ['templates', 'list', f] },
}));

import { useCommunicationLogs, useSendCommunication } from './use-communications';
import type { CommLogDto, CommLogListResult } from './use-communications';
import { CommunicationHistory } from './CommunicationHistory';
import { SendCommunicationDrawer } from './SendCommunicationDrawer';

const mockUseLogs = useCommunicationLogs as ReturnType<typeof vi.fn>;
const mockUseSend = useSendCommunication as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLog(overrides: Partial<CommLogDto> = {}): CommLogDto {
  return {
    communication_log_id: 'log-1',
    lead_id: 'lead-1',
    template_id: 'tpl-1',
    channel: 'sms',
    recipient: '9876543210',
    consent_basis: 'lead_contact',
    status: 'queued',
    provider_ref: null,
    failure_reason: null,
    sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeLogList(logs: CommLogDto[]): CommLogListResult {
  return {
    data: logs,
    meta: { page: 1, limit: 25, total: logs.length },
  };
}

// ── UI-04: Recipient masked in communication history ──────────────────────────

describe('CommunicationHistory', () => {
  it('UI-04: masks mobile recipient as 98xxxxxx10', () => {
    mockUseLogs.mockReturnValue({
      data: makeLogList([makeLog({ recipient: '9876543210', channel: 'sms' })]),
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<CommunicationHistory leadId="lead-1" />);

    // Masked value visible.
    expect(screen.getByText('98xxxxxx10')).toBeTruthy();
    // Raw mobile NOT in DOM.
    expect(screen.queryByText('9876543210')).toBeNull();
  });

  it('masks email as ab****@domain.com pattern', () => {
    mockUseLogs.mockReturnValue({
      data: makeLogList([
        makeLog({ recipient: 'alice@example.com', channel: 'email' }),
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<CommunicationHistory leadId="lead-1" />);

    const masked = screen.getByLabelText('masked recipient');
    expect(masked.textContent).toMatch(/al\*+@example\.com/);
    expect(screen.queryByText('alice@example.com')).toBeNull();
  });

  it('shows empty state when no logs exist', () => {
    mockUseLogs.mockReturnValue({
      data: makeLogList([]),
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<CommunicationHistory leadId="lead-1" />);
    expect(screen.getByText(/no messages sent yet/i)).toBeTruthy();
  });
});

// ── UI-03: Consent warning shown when not granted ─────────────────────────────

describe('SendCommunicationDrawer', () => {
  beforeEach(() => {
    mockUseSend.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });
  });

  it('UI-03: renders Send button (initially enabled; consent warning appears after purpose selection)', () => {
    render(
      <SendCommunicationDrawer
        leadId="lead-1"
        consentGranted={false}
        onClose={vi.fn()}
      />,
    );

    // Send button present.
    const sendBtn = screen.getByRole('button', { name: 'Send' });
    expect(sendBtn).toBeTruthy();

    // Initially no purpose selected → no consent indicator alert yet.
    expect(screen.queryByText(/Customer has not granted consent/i)).toBeNull();
  });

  it('UI-03: Send button is disabled once a purpose is selected and consent is not granted', async () => {
    render(
      <SendCommunicationDrawer
        leadId="lead-1"
        consentGranted={false}
        onClose={vi.fn()}
      />,
    );

    // Use fireEvent.change to trigger the React synthetic event on the select.
    const purposeSelect = screen.getByLabelText('Consent Purpose *');
    fireEvent.change(purposeSelect, { target: { value: 'lead_contact' } });

    // After purpose selection with consentGranted=false, the consent warning alert appears
    // and Send becomes disabled.
    expect(await screen.findByText(/Customer has not granted consent for this purpose/i)).toBeTruthy();
    const sendBtn = screen.getByRole('button', { name: 'Send' });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
