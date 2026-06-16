// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ getPage: vi.fn(), get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  apiClient: { getPage: mocks.getPage, get: mocks.get, post: mocks.post, patch: mocks.patch },
}));

import {
  useProductConfigs,
  useCreateProductConfig,
  useUpdateProductConfig,
  useRetireProductConfig,
} from './use-product-configs';
import type { CreateProductConfigBody } from '@/types/product-config';

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('use-product-configs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /admin/products with bracketed filters and sort', async () => {
    mocks.getPage.mockResolvedValue({ data: [], pagination: { page: 1, limit: 25, total: 0 } });
    const { result } = renderHook(
      () => useProductConfigs({ page: 1, limit: 25, sort: '-created_at', status: 'active', productCode: 'CV' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.getPage).toHaveBeenCalledWith(
      '/admin/products',
      expect.objectContaining({
        query: expect.objectContaining({
          page: 1,
          limit: 25,
          sort: '-created_at',
          'filter[status]': 'active',
          'filter[product_code]': 'CV',
        }),
      }),
    );
  });

  it('POSTs the create body to /admin/products', async () => {
    mocks.post.mockResolvedValue({ product_config_id: 'pc-1', version: 1, config_version_status: 'pending' });
    const { result } = renderHook(() => useCreateProductConfig(), { wrapper });
    const body = { product_code: 'CV', name: 'X', pan_required_at: 'before_kyc' } as unknown as CreateProductConfigBody;
    await result.current.mutateAsync(body);
    expect(mocks.post).toHaveBeenCalledWith('/admin/products', body);
  });

  it('PATCHes an edit to /admin/products/{id}', async () => {
    mocks.patch.mockResolvedValue({ product_config_id: 'pc-2', version: 4, based_on_version: 3 });
    const { result } = renderHook(() => useUpdateProductConfig(), { wrapper });
    await result.current.mutateAsync({ productConfigId: 'pc-1', body: { name: 'New' } });
    expect(mocks.patch).toHaveBeenCalledWith('/admin/products/pc-1', { name: 'New' });
  });

  it('PATCHes a retire as status:retired', async () => {
    mocks.patch.mockResolvedValue({ product_config_id: 'pc-1', status: 'retired' });
    const { result } = renderHook(() => useRetireProductConfig(), { wrapper });
    await result.current.mutateAsync('pc-1');
    expect(mocks.patch).toHaveBeenCalledWith('/admin/products/pc-1', { status: 'retired' });
  });
});
