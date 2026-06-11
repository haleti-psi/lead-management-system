import type { RoleCode, SlaTarget } from '@lms/shared';

/**
 * FR-104 — shared SLA value types for `core/sla`.
 *
 * These mirror the JSONB shapes stored in `business_calendars.working_hours` /
 * `.holidays` and `sla_policies.escalation_chain` (docs/data-model/schema.sql
 * §3.15/§3.15b). They are deliberately plain interfaces (no class, no decorator)
 * so the engine stays a pure, dependency-free core service.
 */

/** A day's open window in calendar-local wall-clock time, e.g. 09:30–18:30. */
export interface WorkingWindow {
  /** "HH:MM" 24h local open time (inclusive). */
  readonly start: string;
  /** "HH:MM" 24h local close time (exclusive). */
  readonly end: string;
}

/** Lowercase three-letter weekday keys, matching the seed JSONB. */
export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/**
 * Per-weekday open windows. A `null` value means the day is closed (the seed
 * sets `"sun": null`). Days absent from the map are also treated as closed.
 */
export type WorkingHours = Partial<Record<WeekdayKey, WorkingWindow | null>>;

/** A single non-working calendar date (holiday). */
export interface Holiday {
  /** ISO calendar date "YYYY-MM-DD" in the calendar's local timezone. */
  readonly date: string;
  readonly name?: string;
}

/**
 * The resolved business calendar the engine computes against. `source` records
 * which resolution tier produced it (branch → region → org default → hardcoded
 * fallback) for observability; `working_hours`/`holidays` drive the arithmetic.
 */
export interface ResolvedCalendar {
  readonly businessCalendarId: string | null;
  readonly code: string;
  readonly timezone: string;
  readonly workingHours: WorkingHours;
  readonly holidays: readonly Holiday[];
  readonly source: 'branch' | 'region' | 'org_default' | 'fallback';
}

/** One step of an SLA escalation chain (`sla_policies.escalation_chain` element). */
export interface EscalationStep {
  readonly at_minutes: number;
  readonly notify_roles: readonly RoleCode[];
  readonly action: 'notify' | 'reassign';
}

/**
 * The minimal SLA policy shape the engine needs to compute a due timestamp.
 * Loaded from `sla_policies` by {@link SlaPolicyReaderPort}.
 */
export interface SlaPolicyForCompute {
  readonly sla_policy_id: string;
  readonly applies_to: SlaTarget;
  readonly threshold_minutes: number;
  readonly escalation_chain: readonly EscalationStep[];
  readonly condition: Record<string, unknown> | null;
}

/** Context the engine uses to resolve the right calendar for an entity. */
export interface CalendarContext {
  readonly branchId?: string | null;
  readonly regionId?: string | null;
}
