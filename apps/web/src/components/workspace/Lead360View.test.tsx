// @vitest-environment jsdom
//
// FR-051 §UI tests (UI-051-01..06) for the Lead360View component.
//
// These cases correspond to FR-051-tests.md §UI. The hook and apiClient are
// mocked so the component runs in isolation without a network or server.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── mock the hook (must be declared before any import of the module) ──────────
vi.mock('./use-lead360', () => ({
  useLead360: vi.fn(),
}));

import { useLead360 } from './use-lead360';
import { Lead360View } from './Lead360View';
import type { Lead360Response } from './lead360.types';
import { ApiClientError } from '@/lib/api';

const mockUseLead360 = useLead360 as ReturnType<typeof vi.fn>;

// ── minimal Lead360Response fixture ──────────────────────────────────────────
function makeResponse(overrides: Partial<Lead360Response> = {}): Lead360Response {
  return {
    leadId: 'f6b7c1de-0000-4000-8000-000000000051',
    leadCode: 'LD-2026-000042',
    stage: 'kyc_in_progress',
    priority: 'high',
    isHot: false,
    score: null,
    scoreReasons: null,
    requestedAmount: '500000.00',
    channelCreatedBy: 'manual',
    consentStatus: 'captured',
    kycStatus: 'in_progress',
    duplicateStatus: 'none',
    losApplicationId: null,
    slaFirstContactDueAt: null,
    reopenedCount: 0,
    nurtureNextAt: null,
    createdAt: '2026-06-10T08:00:00.000Z',
    updatedAt: '2026-06-10T14:00:00.000Z',
    version: 5,
    identity: {
      leadIdentityId: 'li-1',
      name: 'Rajesh K',
      mobile: '98xxxxxx10',
      email: 'ra****@example.com',
      panMasked: 'ABCxxxx1F',
      gstin: null,
      dob: null,
      preferredLanguage: 'Hindi',
    },
    customerProfile: null,
    sourceAttribution: {
      source: 'DSA',
      subSource: null,
      partnerId: null,
      campaignCode: null,
      utm: null,
    },
    productDetail: null,
    branch: null,
    owner: null,
    team: null,
    stageHistory: [],
    eligibilitySnapshot: null,
    losApplicationMirror: null,
    documentSummary: { total: 0, verified: 0, pending: 0, mismatch: 0 },
    kycSummary: { total: 0, success: 0, failed: 0, exception: 0, initiated: 0 },
    openTaskCount: 0,
    consentSummary: [],
    notes: [],
    duplicateMatches: [],
    partner: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseLead360.mockReset();
});

// UI-051-01: loading skeleton while pending
describe('Lead360View', () => {
  it('UI-051-01: renders loading skeleton while the query is pending', () => {
    mockUseLead360.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    // LoadingSkeleton renders role="status" aria-label="Loading"
    expect(screen.getByRole('status', { name: /loading/i })).not.toBeNull();
  });

  // UI-051-02: ErrorState on 404
  it('UI-051-02: renders ErrorState with 404 copy when the query fails with NOT_FOUND', () => {
    const error = new ApiClientError({
      code: 'NOT_FOUND',
      message: 'Lead not found',
      status: 404,
      retryable: false,
    });
    mockUseLead360.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    // ErrorState renders role="alert"
    const alert = screen.getByRole('alert');
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("couldn't find");
  });

  // UI-051-03: masked fields shown via MaskedField — no raw PII
  it('UI-051-03: masked PAN and mobile are rendered through MaskedField; raw PII is absent', () => {
    mockUseLead360.mockReturnValue({
      data: makeResponse(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    // MaskedField renders span[aria-label="masked PAN"] and span[aria-label="masked mobile"]
    const maskedPan = screen.getByLabelText('masked PAN');
    expect(maskedPan.textContent).toBe('ABCxxxx1F');

    const maskedMobile = screen.getByLabelText('masked mobile');
    expect(maskedMobile.textContent).toBe('98xxxxxx10');

    // Raw PII must not appear anywhere in the rendered output
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('9812345610');
    expect(body).not.toContain('rajesh@example.com');
  });

  // UI-051-04: empty sections render gracefully (EmptyState, not errors)
  it('UI-051-04: empty sub-sections (empty arrays, null snapshots, zero counts) render gracefully', () => {
    mockUseLead360.mockReturnValue({
      data: makeResponse(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    // EmptyState renders text content — spot-check a few
    expect(screen.getByText('No stage changes yet')).not.toBeNull();
    expect(screen.getByText('No notes yet')).not.toBeNull();
    expect(screen.getByText('Not scored yet')).not.toBeNull();
  });

  // UI-051-05: tab navigation renders sections
  it('UI-051-05: SectionTabs renders a tablist with the expected section tabs', () => {
    mockUseLead360.mockReturnValue({
      data: makeResponse(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    const tablist = screen.getByRole('tablist', { name: 'Lead sections' });
    expect(tablist).not.toBeNull();

    const tabs = screen.getAllByRole('tab');
    const tabLabels = tabs.map((t) => t.textContent ?? '');
    expect(tabLabels).toContain('Overview');
    expect(tabLabels).toContain('Documents');
    expect(tabLabels).toContain('KYC');
    expect(tabLabels).toContain('Consent');
    expect(tabLabels).toContain('LOS');
  });

  // UI-051-06: success render — summary card shows lead code and stage
  it('UI-051-06: success render shows the lead code, stage chip, and identity card', () => {
    mockUseLead360.mockReturnValue({
      data: makeResponse({
        leadCode: 'LD-2026-000042',
        stage: 'kyc_in_progress',
        identity: {
          leadIdentityId: 'li-1',
          name: 'Rajesh K',
          mobile: '98xxxxxx10',
          email: null,
          panMasked: 'ABCxxxx1F',
          gstin: null,
          preferredLanguage: 'Hindi',
        },
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Lead360View leadId="f6b7c1de-0000-4000-8000-000000000051" />
      </MemoryRouter>,
    );

    // The lead name appears in the summary card header
    expect(screen.getByText('Rajesh K')).not.toBeNull();
    // StatusChip renders status with _ replaced by space (e.g. 'kyc in progress').
    // Also assert via data-status attribute for exactness.
    const chip = document.querySelector('[data-status="kyc_in_progress"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('kyc in progress');
  });
});
