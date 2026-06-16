import { isApiClientError } from '@/lib/api';
import type { ChipTone } from '@/components/ui/StatusChip';
import type { ConfigChangeStatus } from '@lms/shared';
import type { DiffEntry } from '@/types/config-governance';

/**
 * FR-132 — shared helpers for the Configuration Governance screen: status → chip
 * tone, taxonomy error → user message (maker-checker FORBIDDEN/CONFLICT made
 * legible), and the opaque `configuration_versions.diff` JSONB → a flat, readable
 * change list. Kept separate from the components so the mapping is unit-testable
 * and reused by every dialog.
 */

/** `config_change_status` → a StatusChip tone (colour is not the only signal —
 * the label text is always shown alongside). */
export function statusTone(status: ConfigChangeStatus): ChipTone {
  switch (status) {
    case 'pending':
      return 'progress';
    case 'approved':
      return 'info';
    case 'active':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'rolled_back':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** "rolled_back" → "Rolled back" for display. */
export function humanizeStatus(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Map an unknown thrown value to a user-facing message for a governance action.
 * Surfaces the maker-checker rules explicitly: self-approval / out-of-scope →
 * FORBIDDEN, already-acted → CONFLICT, unknown id → NOT_FOUND. Field-level
 * VALIDATION_ERROR is handled inline by the forms, so it falls through to the
 * server message here. Never leaks an internal cause.
 */
export function actionErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'FORBIDDEN':
        return "You can't approve a change you made, and governance actions require org-wide (scope A) access. Ask a different authorised approver.";
      case 'CONFLICT':
        return 'This change has already been acted on (approved, rejected or rolled back). Refresh and check its current status.';
      case 'NOT_FOUND':
        return 'No pending configuration change was found for that id. Check the id and try again.';
      case 'VALIDATION_ERROR':
        return error.message || 'The request was invalid. Please review the fields and try again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return error.message || 'The action could not be completed. Please try again.';
    }
  }
  return 'The action could not be completed. Please try again.';
}

/** Read a possibly-nested value off an unknown record without throwing. */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

/**
 * Normalise an opaque `configuration_versions.diff` JSONB into a flat list of
 * `{ field, before?, after? }` rows for display. The diff schema is not fixed,
 * so several common shapes are recognised:
 *   - `{ field: { before, after } }` / `{ field: { from, to } }` / `{ field: { old, new } }`
 *   - `{ field: { value } }` or a bare scalar value `{ field: 42 }` (after-only)
 *   - a top-level `{ before, after }` pair
 * Anything else is rendered as a single JSON blob row so nothing is hidden.
 */
export function normaliseDiff(diff: unknown): DiffEntry[] {
  // No diff recorded (null/undefined) → nothing to show.
  if (diff == null) return [];
  // A bare scalar diff (rare) → show it as the new value.
  if (typeof diff !== 'object') return [{ field: 'value', after: diff }];

  const record = diff as Record<string, unknown>;

  // Top-level before/after pair (whole-object diff).
  const topBefore = pick(record, 'before', 'from', 'old');
  const topAfter = pick(record, 'after', 'to', 'new');
  if (topBefore !== undefined || topAfter !== undefined) {
    return [{ field: 'value', before: topBefore, after: topAfter }];
  }

  const entries: DiffEntry[] = [];
  for (const [field, raw] of Object.entries(record)) {
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      const sub = raw as Record<string, unknown>;
      const before = pick(sub, 'before', 'from', 'old');
      const after = pick(sub, 'after', 'to', 'new', 'value');
      if (before !== undefined || after !== undefined) {
        entries.push({ field, before, after });
        continue;
      }
    }
    // Scalar / array / unrecognised object → treat as the new value.
    entries.push({ field, after: raw });
  }
  return entries;
}

/** Render any diff value as a compact, readable string for the cell. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
