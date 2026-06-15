// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApiClientError } from '@/lib/api';
import type { PartnerQualityData } from '@/types/partner-quality';

const mocks = vi.hoisted(() => ({ quality: vi.fn() }));
vi.mock('@/hooks/use-partner-quality', () => ({ usePartnerQuality: () => mocks.quality() }));

import { PartnerQualityPage } from './PartnerQualityPage';

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/partner/p1/quality']}>
      <Routes>
        <Route path="/partner/:id/quality" element={<PartnerQualityPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const data = (overrides: Partial<PartnerQualityData> = {}): PartnerQualityData => ({
  partner_id: 'p1',
  partner_code: 'DSA-001',
  legal_name: 'Sharma Finance DSA',
  type: 'DSA',
  status: 'active',
  quality_score: 72,
  insufficient_data: false,
  window: { from: '2026-05-10', to: '2026-06-09' },
  metrics: {
    total_leads: 45,
    contactable_leads: 38,
    duplicate_leads: 4,
    rejected_leads: 6,
    handed_off_leads: 18,
    uploaded_docs: 90,
    verified_docs_first_time: 72,
    kyc_mismatch_leads: 3,
  },
  factors: {
    contactability_index: 84.44,
    duplicate_penalty: 8.89,
    rejection_penalty: 13.33,
    handoff_index: 40,
    document_quality_index: 80,
    speed_index: 91.2,
  },
  factor_weights: {
    contactability_index: 0.25,
    handoff_index: 0.3,
    document_quality_index: 0.2,
    speed_index: 0.15,
    duplicate_penalty: -0.05,
    rejection_penalty: -0.05,
  },
  ...overrides,
});

describe('PartnerQualityPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the score, band, factor breakdown and metrics', () => {
    mocks.quality.mockReturnValue({ isLoading: false, isError: false, data: data({ quality_score: 73 }) });
    renderAt();
    expect(screen.getByText('73')).toBeTruthy();
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText('Contactability')).toBeTruthy();
    expect(screen.getByText('84.44%')).toBeTruthy();
    expect(screen.getByText('Total leads')).toBeTruthy();
  });

  it('renders "–" for a null factor', () => {
    mocks.quality.mockReturnValue({
      isLoading: false,
      isError: false,
      data: data({ factors: { ...data().factors, speed_index: null } }),
    });
    renderAt();
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('shows the insufficient-data banner', () => {
    mocks.quality.mockReturnValue({
      isLoading: false,
      isError: false,
      data: data({ insufficient_data: true, quality_score: null }),
    });
    renderAt();
    expect(screen.getByText('Not enough data')).toBeTruthy();
  });

  it('maps FORBIDDEN to a friendly access message', () => {
    mocks.quality.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new ApiClientError({ code: 'FORBIDDEN', message: 'x', status: 403, retryable: false }),
      refetch: vi.fn(),
    });
    renderAt();
    expect(screen.getByText(/don't have access/i)).toBeTruthy();
  });
});
