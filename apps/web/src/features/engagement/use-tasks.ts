import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, isApiClientError } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'overdue' | 'cancelled';
export type TaskType =
  | 'call'
  | 'visit'
  | 'doc_request'
  | 'kyc_appt'
  | 'dealer_followup'
  | 'callback'
  | 'approval'
  | 'handoff_retry'
  | 'nurture';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskDisposition =
  | 'connected'
  | 'no_answer'
  | 'wrong_number'
  | 'not_interested'
  | 'visited'
  | 'rescheduled'
  | 'callback_requested'
  | 'docs_promised';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Full task object as returned by the API. */
export interface TaskDto {
  task_id: string;
  lead_id: string;
  type: TaskType;
  owner_id: string;
  due_at: string;
  priority: TaskPriority;
  sla_policy_id: string | null;
  status: TaskStatus;
  disposition: TaskDisposition | null;
  result_note: string | null;
  geo: GeoPoint | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListMeta {
  page: number;
  limit: number;
  total: number;
  correlation_id?: string;
}

export interface TaskListResult {
  data: TaskDto[];
  meta: TaskListMeta;
}

export interface TaskFilters {
  lead_id?: string;
  status?: TaskStatus;
  owner_id?: string;
  type?: TaskType;
  due_before?: string;
  page?: number;
  limit?: number;
}

export interface CreateTaskInput {
  lead_id: string;
  type: TaskType;
  owner_id: string;
  due_at: string;
  priority?: TaskPriority;
  sla_policy_id?: string | null;
  result_note?: string | null;
  next_action_at?: string | null;
  geo?: GeoPoint | null;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  disposition?: TaskDisposition | null;
  result_note?: string | null;
  geo?: GeoPoint | null;
  next_action_at?: string | null;
  owner_id?: string;
  due_at?: string;
  priority?: TaskPriority;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const taskKeys = {
  all: ['tasks'] as const,
  list: (filters: TaskFilters) => ['tasks', 'list', filters] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * FR-100 — Paginated, scoped task list.
 * `staleTime: 30_000` keeps data fresh without hammering the API.
 * On 403, the caller should navigate to /forbidden.
 */
export function useTasks(filters: TaskFilters = {}): {
  data: TaskListResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () =>
      apiClient.get<TaskListResult>('/tasks', {
        query: {
          ...(filters.lead_id && { lead_id: filters.lead_id }),
          ...(filters.status && { status: filters.status }),
          ...(filters.owner_id && { owner_id: filters.owner_id }),
          ...(filters.type && { type: filters.type }),
          ...(filters.due_before && { due_before: filters.due_before }),
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
 * FR-100 — Create a new task.
 * Invalidates the task list cache on success.
 */
export function useCreateTask(): {
  mutate: (input: CreateTaskInput) => void;
  mutateAsync: (input: CreateTaskInput) => Promise<TaskDto>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateTaskInput) => apiClient.post<TaskDto>('/tasks', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
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

/**
 * FR-100 — Update / complete a task.
 * Invalidates the task list cache on success.
 */
export function useUpdateTask(taskId: string): {
  mutate: (input: UpdateTaskInput) => void;
  mutateAsync: (input: UpdateTaskInput) => Promise<TaskDto>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateTaskInput) => apiClient.patch<TaskDto>(`/tasks/${taskId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
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
