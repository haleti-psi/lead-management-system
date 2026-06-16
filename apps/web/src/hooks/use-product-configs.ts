import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient, type PageResult, type QueryParams } from '@/lib/api';
import type {
  CreateProductConfigBody,
  CreateProductConfigResult,
  EditProductConfigResult,
  ProductConfig,
  ProductConfigListRow,
  RetireProductConfigResult,
  UpdateProductConfigBody,
} from '@/types/product-config';

/**
 * FR-040 — TanStack Query hooks for the Product Configuration admin screen
 * (`/api/v1/admin/products`). Reads go through `apiClient.getPage` (so the
 * server-paginated DataTable receives `meta.pagination`) and `apiClient.get`;
 * mutations POST a new draft / PATCH an active config into a new draft version /
 * PATCH a retire. Every mutation invalidates the list so the table reflects the new
 * draft. Activation is NOT done here — a created/edited config is a pending
 * `configuration_versions` row activated through the FR-132 maker-checker flow.
 */

export interface ProductConfigListParams {
  page: number;
  limit: number;
  /** Signed sort token from the API allow-list (e.g. `-created_at`, `version`). */
  sort: string;
  status?: string;
  productCode?: string;
}

export const productConfigKeys = {
  all: ['product-configs'] as const,
  list: (params: ProductConfigListParams) => ['product-configs', 'list', params] as const,
  detail: (id: string) => ['product-configs', 'detail', id] as const,
};

/** `GET /admin/products` (server-paginated). Filters are sent bracketed exactly as
 * the api-contract spells them (`filter[status]`, `filter[product_code]`). */
export function useProductConfigs(
  params: ProductConfigListParams,
  enabled = true,
): UseQueryResult<PageResult<ProductConfigListRow>> {
  return useQuery({
    queryKey: productConfigKeys.list(params),
    enabled,
    queryFn: ({ signal }) => {
      const query: QueryParams = { page: params.page, limit: params.limit, sort: params.sort };
      if (params.status) query['filter[status]'] = params.status;
      if (params.productCode) query['filter[product_code]'] = params.productCode;
      return apiClient.getPage<ProductConfigListRow>('/admin/products', { query, signal });
    },
  });
}

/** `GET /admin/products/{id}` — full config (with the JSONB payloads). */
export function useProductConfig(
  id: string | null,
  enabled = true,
): UseQueryResult<ProductConfig> {
  return useQuery({
    queryKey: productConfigKeys.detail(id ?? ''),
    enabled: enabled && id != null,
    queryFn: ({ signal }) => apiClient.get<ProductConfig>(`/admin/products/${id}`, { signal }),
  });
}

/** `POST /admin/products` — maker step; creates a draft + pending version. */
export function useCreateProductConfig(): UseMutationResult<
  CreateProductConfigResult,
  unknown,
  CreateProductConfigBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductConfigBody) =>
      apiClient.post<CreateProductConfigResult>('/admin/products', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productConfigKeys.all }),
  });
}

export interface UpdateProductConfigInput {
  productConfigId: string;
  body: UpdateProductConfigBody;
}

/** `PATCH /admin/products/{id}` — edit an ACTIVE config into a new draft version
 * (the live row is never mutated; the new version awaits checker approval). */
export function useUpdateProductConfig(): UseMutationResult<
  EditProductConfigResult,
  unknown,
  UpdateProductConfigInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productConfigId, body }: UpdateProductConfigInput) =>
      apiClient.patch<EditProductConfigResult>(`/admin/products/${productConfigId}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productConfigKeys.all }),
  });
}

/** `PATCH /admin/products/{id}` with `status:'retired'` — status-only retire of an
 * ACTIVE config (in-flight leads keep their pinned version). */
export function useRetireProductConfig(): UseMutationResult<
  RetireProductConfigResult,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productConfigId: string) =>
      apiClient.patch<RetireProductConfigResult>(`/admin/products/${productConfigId}`, {
        status: 'retired',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productConfigKeys.all }),
  });
}
