// Uniform API envelope — BRD §4.4 / docs/architecture.md §4. Shared by the API
// response interceptor and the web apiClient. Do not switch to a bare resource body.
import type { ErrorCode } from '../errors';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiMeta {
  correlation_id: string;
  pagination?: PaginationMeta;
}

export interface ApiFieldError {
  field: string;
  issue: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  fields?: ApiFieldError[];
  detail?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  data: T | null;
  meta: ApiMeta;
  error: ApiError | null;
}
