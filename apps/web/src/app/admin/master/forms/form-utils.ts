import { toast } from 'sonner';
import { isApiClientError } from '@/lib/api';

/**
 * Shared non-field error handler for the master forms. The EntityForm already
 * maps `VALIDATION_ERROR.fields[]` to inline errors; this covers the rest:
 * CONFLICT (duplicate code / in-use), FORBIDDEN (scope), and a generic fallback.
 * `noun` is the singular resource label (e.g. "region").
 */
export function masterFormError(noun: string, error: unknown): void {
  if (isApiClientError(error)) {
    if (error.code === 'CONFLICT') {
      const reason = readConflictReason(error.detail);
      toast.error(reason ?? `A ${noun} with that code already exists.`);
      return;
    }
    if (error.code === 'FORBIDDEN') {
      toast.error("You don't have access to perform this change.");
      return;
    }
    if (error.code === 'RATE_LIMITED') {
      toast.error('Too many changes — please wait a moment and try again.');
      return;
    }
  }
  toast.error(`Could not save the ${noun}. Please try again.`);
}

/** A CONFLICT envelope may carry `detail.reason` (in-use / legal hold) text. */
export function readConflictReason(detail: Record<string, unknown> | undefined): string | undefined {
  const reason = detail?.reason;
  return typeof reason === 'string' ? reason : undefined;
}
