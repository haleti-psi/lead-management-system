// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocStatus, DocType, ApplicantScope, KycStatus } from '@lms/shared';
import type { DocumentChecklistResponse } from '@/types/documents';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/hooks/use-document-checklist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-document-checklist')>();
  return { ...actual, useDocumentChecklist: () => mocks.query() };
});
vi.mock('@/lib/auth/capabilities', () => ({
  useCan: () => (cap: string) => mocks.can(cap),
}));

import { DocumentChecklistPanel } from './DocumentChecklistPanel';

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentChecklistPanel leadId="lead-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const checklistData: DocumentChecklistResponse = {
  lead_id: 'lead-1',
  kyc_status: KycStatus.IN_PROGRESS,
  mandatory_complete: false,
  optional_complete: true,
  checklist: [
    {
      doc_type: DocType.PAN,
      applicant_scope: ApplicantScope.APPLICANT,
      label: 'PAN Card',
      mandatory: true,
      status: DocStatus.PENDING,
      document_id: null,
      version: null,
    },
    {
      doc_type: DocType.ADDRESS,
      applicant_scope: ApplicantScope.APPLICANT,
      label: 'Address Proof',
      mandatory: true,
      status: DocStatus.UPLOADED,
      document_id: 'doc-1',
      version: 1,
    },
  ],
};

describe('DocumentChecklistPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(false);
  });

  it('shows the loading skeleton while fetching', () => {
    mocks.query.mockReturnValue({ isLoading: true });
    renderPanel();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows an error state with retry on failure', () => {
    mocks.query.mockReturnValue({ isLoading: false, isError: true, refetch: vi.fn() });
    renderPanel();
    expect(screen.getByText("Couldn't load documents")).toBeTruthy();
  });

  it('shows an empty state when the checklist is empty', () => {
    mocks.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { ...checklistData, checklist: [] },
    });
    renderPanel();
    expect(screen.getByText('No documents required')).toBeTruthy();
  });

  it('renders items and the kyc status chip', () => {
    mocks.query.mockReturnValue({ isLoading: false, isError: false, data: checklistData });
    renderPanel();
    expect(screen.getByText('PAN Card')).toBeTruthy();
    expect(screen.getByText('Address Proof')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('hides upload/waive actions without the capabilities', () => {
    mocks.query.mockReturnValue({ isLoading: false, isError: false, data: checklistData });
    renderPanel();
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Waive' })).toBeNull();
  });

  it('shows upload for uploadable items and waive only when a document exists', () => {
    mocks.can.mockImplementation((cap: string) => cap === 'upload_doc' || cap === 'verify_doc');
    mocks.query.mockReturnValue({ isLoading: false, isError: false, data: checklistData });
    renderPanel();
    // Both rows are uploadable (pending + uploaded); only the row with a
    // document_id (Address Proof) exposes Waive.
    expect(screen.getAllByRole('button', { name: /upload/i }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Waive' }).length).toBe(1);
  });
});
