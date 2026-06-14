import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, isApiClientError } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommChannel = 'in_app' | 'email' | 'sms' | 'whatsapp';
export type CommCategory = 'transactional' | 'marketing';
export type ConfigStatus = 'draft' | 'active' | 'retired';
export type ProductCode = 'CV' | 'CAR' | 'TRACTOR' | 'CE' | 'TW' | 'SBL' | 'HRM';
export type Lang = 'English' | 'Hindi' | 'Marathi' | 'Tamil' | 'Telugu' | 'Kannada' | 'Gujarati' | 'Bengali';
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

export interface TemplateDto {
  template_id: string;
  code: string;
  version: number;
  channel: CommChannel;
  language: Lang;
  category: CommCategory;
  product_code: ProductCode | null;
  body: string;
  status: ConfigStatus;
  created_at: string;
  updated_at: string;
}

export interface TemplateListMeta {
  page: number;
  limit: number;
  total: number;
  correlation_id?: string;
}

export interface TemplateListResult {
  data: TemplateDto[];
  meta: TemplateListMeta;
}

export interface TemplateFilters {
  channel?: CommChannel;
  language?: Lang;
  category?: CommCategory;
  status?: ConfigStatus;
  product_code?: ProductCode;
  page?: number;
  limit?: number;
}

export interface CreateTemplateInput {
  code: string;
  version: number;
  channel: CommChannel;
  language: Lang;
  category: CommCategory;
  product_code?: ProductCode;
  body: string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const templateKeys = {
  all: ['templates'] as const,
  list: (filters: TemplateFilters) => ['templates', 'list', filters] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * FR-101 — Paginated list of communication templates.
 */
export function useTemplates(filters: TemplateFilters = {}): {
  data: TemplateListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: templateKeys.list(filters),
    queryFn: () =>
      apiClient.get<TemplateListResult>('/admin/templates', {
        query: {
          ...(filters.channel && { channel: filters.channel }),
          ...(filters.language && { language: filters.language }),
          ...(filters.category && { category: filters.category }),
          ...(filters.status && { status: filters.status }),
          ...(filters.product_code && { product_code: filters.product_code }),
          page: filters.page ?? 1,
          limit: filters.limit ?? 25,
        },
      }),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (isApiClientError(error) && (error.status === 403 || error.status === 401)) return false;
      return failureCount < 2;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * FR-101 — Create a new communication template (status=draft).
 */
export function useCreateTemplate(): {
  mutate: (input: CreateTemplateInput) => void;
  mutateAsync: (input: CreateTemplateInput) => Promise<TemplateDto>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateTemplateInput) => apiClient.post<TemplateDto>('/admin/templates', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.all });
    },
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset: mutation.reset,
  };
}
