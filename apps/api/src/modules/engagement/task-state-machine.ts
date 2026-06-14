import { TaskStatus } from '@lms/shared';

/**
 * FR-100 — Task status transition guard (state-machines.md §Task).
 *
 * Valid user-initiated transitions:
 *   open        → in_progress | done | cancelled
 *   in_progress → done | cancelled
 *   overdue     → in_progress | done | cancelled
 *
 * Terminal states (no outbound): done | cancelled
 * Sweep-only state (never user-settable): overdue
 *
 * Any other combination returns false → CONFLICT (409).
 */
const ALLOWED: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  [
    TaskStatus.OPEN,
    new Set<TaskStatus>([TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED]),
  ],
  [
    TaskStatus.IN_PROGRESS,
    new Set<TaskStatus>([TaskStatus.DONE, TaskStatus.CANCELLED]),
  ],
  [
    TaskStatus.OVERDUE,
    new Set<TaskStatus>([TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED]),
  ],
  [TaskStatus.DONE, new Set<TaskStatus>()],
  [TaskStatus.CANCELLED, new Set<TaskStatus>()],
]);

/**
 * Returns true when the user-initiated `to` transition is permitted from `from`.
 * The `overdue` target is sweep-only: any user call setting status=overdue
 * returns false regardless of the current status.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (to === TaskStatus.OVERDUE) {
    // Overdue is only set by the sweep job — never user-initiated.
    return false;
  }
  return ALLOWED.get(from)?.has(to) ?? false;
}
