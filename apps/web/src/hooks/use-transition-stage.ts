/**
 * FR-052 — useTransitionStage hook.
 *
 * Calls PATCH /api/v1/leads/{id}/stage and handles the three outcomes:
 *   success   → caller's onSuccess callback (typically refetch + update card)
 *   409       → CONFLICT (stale version) — toast + snap-back
 *   4xx guard → STAGE_GUARD_FAILED detail listed in toast
 *   other err → generic error toast
 *
 * The hook is intentionally stateless (no loading indicator) to avoid blocking
 * the Kanban board during a transition. The caller owns optimistic-update state.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api';
import { ApiClientError } from '@/lib/api/errors';
import type { StageChangeBody, StageTransitionResult } from '@/components/pipeline/pipeline-board.types';

export interface UseTransitionStageOptions {
  /** Called when the transition succeeds so the caller can update local state. */
  onSuccess?: (result: StageTransitionResult) => void;
  /**
   * Called on any failure so the caller can snap the card back to its original
   * position (undo the optimistic update).
   */
  onSnapBack?: (leadId: string) => void;
}

export interface UseTransitionStageResult {
  transition: (leadId: string, body: StageChangeBody) => Promise<void>;
  isTransitioning: boolean;
}

export function useTransitionStage(opts?: UseTransitionStageOptions): UseTransitionStageResult {
  const [isTransitioning, setIsTransitioning] = useState(false);

  async function transition(leadId: string, body: StageChangeBody): Promise<void> {
    setIsTransitioning(true);
    try {
      const result = await apiClient.patch<StageTransitionResult>(`/leads/${leadId}/stage`, body);
      opts?.onSuccess?.(result);
    } catch (err) {
      opts?.onSnapBack?.(leadId);

      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          toast.error('Conflict', {
            description: 'Another change was made to this lead. Please refresh and try again.',
          });
        } else if (err.status === 400) {
          // STAGE_GUARD_FAILED — the error detail carries the guard names.
          const rawGuards = err.detail?.['failed_guards'];
          const guards: string[] = Array.isArray(rawGuards)
            ? rawGuards.filter((g): g is string => typeof g === 'string')
            : [];
          toast.error('Stage transition blocked', {
            description: guards.length > 0 ? `Guards failed: ${guards.join(', ')}` : err.message,
          });
        } else if (err.status === 403) {
          toast.error('Permission denied', {
            description: 'You do not have permission to move this lead.',
          });
        } else {
          toast.error('Could not move lead', { description: 'Please try again.' });
        }
      } else {
        toast.error('Could not move lead', { description: 'Please check your connection and try again.' });
      }
    } finally {
      setIsTransitioning(false);
    }
  }

  return { transition, isTransitioning };
}
