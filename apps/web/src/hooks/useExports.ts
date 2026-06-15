import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MaskingLevel } from '@lms/shared';

import { isApiClientError } from '@/lib/api';
import {
  approveExport,
  createExport,
  getExport,
  listExports,
} from '@/lib/api/exports';
import type { CreateExportRequest, ExportJob, ListExportsParams } from '@/lib/api/exports';

/**
 * FR-122 — role → minimum allowed masking_level.
 * Used by the export form to filter select options.
 */
const ROLE_MIN_MASKING: Readonly<Partial<Record<string, MaskingLevel>>> = {
  RM: 'full',
  KYC: 'full',
  PARTNER: 'full',
  BM: 'partial',
  SM: 'partial',
  HEAD: 'partial',
  DPO: 'unmasked',
  ADMIN: 'partial',
};

const MASKING_RANK: Readonly<Record<MaskingLevel, number>> = {
  full: 0,
  partial: 1,
  unmasked: 2,
};

/**
 * Returns allowed masking_level options for the given role.
 * Options are those AT or MORE restrictive than the role's minimum.
 * MASKING_RANK: full=0 (most restrictive), partial=1, unmasked=2 (least restrictive).
 * Allowed = rank <= minRank (same or more restrictive than the minimum).
 * e.g. RM minimum is 'full' (rank 0) → only 'full' is allowed.
 * e.g. DPO minimum is 'unmasked' (rank 2) → all three are allowed.
 */
export function maskingOptionsForRole(role: string): MaskingLevel[] {
  const minLevel = ROLE_MIN_MASKING[role] ?? 'full';
  const minRank = MASKING_RANK[minLevel];
  const all: MaskingLevel[] = ['full', 'partial', 'unmasked'];
  return all.filter((l) => MASKING_RANK[l] <= minRank);
}

/**
 * Returns true when the requested masking_level is allowed for the given role.
 * Allowed = rank <= minRank (same or more restrictive than the role minimum).
 */
export function isMaskingAllowed(requested: MaskingLevel, role: string): boolean {
  const minLevel = ROLE_MIN_MASKING[role] ?? 'full';
  return MASKING_RANK[requested] <= MASKING_RANK[minLevel];
}

/**
 * FR-122 — role → the data scope an export is issued at (mirrors the `export`
 * capability scopes in auth-matrix.json). The form hardcoded 'A', so every
 * non-scope-A user (RM=O, BM=B, SM=T, KYC=B, DPO=M, PARTNER=P) failed the
 * server-side scope cross-check with FORBIDDEN and could never export.
 */
const ROLE_SCOPE: Readonly<Partial<Record<string, string>>> = {
  RM: 'O',
  KYC: 'B',
  PARTNER: 'P',
  BM: 'B',
  SM: 'T',
  HEAD: 'A',
  DPO: 'M',
  ADMIN: 'A',
};

export function scopeForRole(role: string): string {
  return ROLE_SCOPE[role] ?? 'O';
}

// ── Hooks ──────────────────────────────────────────────────────────────────

/**
 * FR-122 — mutation hook for creating an export job.
 * On success (202): job is queued.
 * On 409 EXPORT_APPROVAL_REQUIRED: the error carries `detail.export_job_id`.
 */
export function useCreateExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ req, idempotencyKey }: { req: CreateExportRequest; idempotencyKey?: string }) =>
      createExport(req, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
  });
}

/** FR-122 — query hook for listing export jobs. */
export function useListExports(params: ListExportsParams = {}) {
  return useQuery({
    queryKey: ['exports', params],
    queryFn: ({ signal }) => listExports(params, signal),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (isApiClientError(error) && [400, 403].includes(error.status)) return false;
      return failureCount < 1;
    },
  });
}

/** FR-122 — query hook for a single export job (on-demand download URL). */
export function useGetExport(id: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['exports', id],
    queryFn: ({ signal }) => getExport(id!, signal),
    enabled: (options?.enabled ?? true) && id != null,
    staleTime: 0,
    retry: false,
  });
}

/** FR-122 — mutation hook for approving an awaiting_approval export job. */
export function useApproveExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => approveExport(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
  });
}

export type { ExportJob };
