// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocType, ApplicantScope } from '@lms/shared';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiClient: { post: mocks.post } }));

import { useUploadDocument } from './use-upload-document';

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useUploadDocument (two-phase protocol)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs initiate → PUT to signed URL → confirm, in order', async () => {
    mocks.post
      .mockResolvedValueOnce({
        document_id: 'doc-1',
        upload_url: 'https://storage.googleapis.com/put-here',
        upload_url_expires_at: '2026-06-14T00:10:00Z',
        status: 'pending',
      })
      .mockResolvedValueOnce({ document_id: 'doc-1', status: 'uploaded', virus_scan_status: 'pending' });

    const file = new File(['x'], 'pan.pdf', { type: 'application/pdf' });
    const { result } = renderHook(() => useUploadDocument({ kind: 'staff', leadId: 'lead-1' }), { wrapper });

    const confirmed = await result.current.mutateAsync({
      file,
      doc_type: DocType.PAN,
      applicant_scope: ApplicantScope.APPLICANT,
    });

    expect(confirmed.status).toBe('uploaded');

    // Phase A — initiate
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/leads/lead-1/documents', {
      doc_type: 'pan',
      applicant_scope: 'applicant',
      file_name: 'pan.pdf',
      file_type: 'application/pdf',
      file_size_kb: 1,
    });
    // Phase A binary — PUT straight to GCS (not via apiClient)
    expect(fetch).toHaveBeenCalledWith(
      'https://storage.googleapis.com/put-here',
      expect.objectContaining({ method: 'PUT' }),
    );
    // Phase B — confirm
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/leads/lead-1/documents', {
      action: 'confirm',
      document_id: 'doc-1',
    });
  });

  it('uses the customer path for token uploads', async () => {
    mocks.post
      .mockResolvedValueOnce({
        document_id: 'doc-2',
        upload_url: 'https://storage.googleapis.com/put2',
        upload_url_expires_at: '2026-06-14T00:10:00Z',
        status: 'pending',
      })
      .mockResolvedValueOnce({ document_id: 'doc-2', status: 'uploaded', virus_scan_status: 'pending' });

    const file = new File(['x'], 'addr.png', { type: 'image/png' });
    const { result } = renderHook(() => useUploadDocument({ kind: 'customer', token: 'tok-abc' }), { wrapper });

    await result.current.mutateAsync({ file, doc_type: DocType.ADDRESS, applicant_scope: ApplicantScope.APPLICANT });

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/c/tok-abc/documents', expect.any(Object));
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/c/tok-abc/documents', {
      action: 'confirm',
      document_id: 'doc-2',
    });
  });

  it('throws when the GCS PUT fails (no confirm call)', async () => {
    mocks.post.mockResolvedValueOnce({
      document_id: 'doc-3',
      upload_url: 'https://storage.googleapis.com/put3',
      upload_url_expires_at: '2026-06-14T00:10:00Z',
      status: 'pending',
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response));

    const file = new File(['x'], 'pan.pdf', { type: 'application/pdf' });
    const { result } = renderHook(() => useUploadDocument({ kind: 'staff', leadId: 'lead-1' }), { wrapper });

    await expect(
      result.current.mutateAsync({ file, doc_type: DocType.PAN, applicant_scope: ApplicantScope.APPLICANT }),
    ).rejects.toThrow(/storage/i);
    expect(mocks.post).toHaveBeenCalledTimes(1); // initiate only; no confirm
  });
});
