// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KycType } from '@lms/shared';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiClient: { post: mocks.post } }));

import { useRunKyc } from './use-kyc';

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useRunKyc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /leads/{id}/kyc/{type} with the body', async () => {
    mocks.post.mockResolvedValue({ kycVerificationId: 'kv-1', status: 'success' });
    const { result } = renderHook(() => useRunKyc('lead-1'), { wrapper });

    await result.current.mutateAsync({ kycType: KycType.PAN, body: { pan: 'ABCDE1234F' } });

    expect(mocks.post).toHaveBeenCalledWith('/leads/lead-1/kyc/pan', { pan: 'ABCDE1234F' });
  });
});
