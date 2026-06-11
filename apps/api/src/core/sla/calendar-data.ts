import type { Holiday, ResolvedCalendar, WorkingHours } from './sla.types';

export type { ResolvedCalendar } from './sla.types';

/**
 * FR-104 — parsing of the JSONB `business_calendars.working_hours` / `.holidays`
 * columns into the typed value objects the engine consumes, plus the hardcoded
 * fallback calendar (LLD §External Service Calls: Mon–Sat 09:30–18:30 IST).
 *
 * The Kysely-generated column type is `Json` (could be a string or already an
 * object depending on the driver path); these helpers accept `unknown` and
 * defensively normalise, never throwing on a malformed cell — a bad calendar
 * row degrades to "closed"/"no holidays" rather than crashing an SLA timer.
 */

export const FALLBACK_CALENDAR: ResolvedCalendar = {
  businessCalendarId: null,
  code: 'FALLBACK_IST',
  timezone: 'Asia/Kolkata',
  workingHours: {
    mon: { start: '09:30', end: '18:30' },
    tue: { start: '09:30', end: '18:30' },
    wed: { start: '09:30', end: '18:30' },
    thu: { start: '09:30', end: '18:30' },
    fri: { start: '09:30', end: '18:30' },
    sat: { start: '09:30', end: '18:30' },
    sun: null,
  },
  holidays: [],
  source: 'fallback',
};

/** Coerce a possibly-stringified JSONB value into a plain object/array, or null. */
function asJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

const HHMM = /^\d{2}:\d{2}$/;

/** Parse `working_hours` JSONB into a typed {@link WorkingHours} map. */
export function parseWorkingHours(raw: unknown): WorkingHours {
  const obj = asJson(raw);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return {};
  }
  const out: WorkingHours = {};
  for (const [day, win] of Object.entries(obj as Record<string, unknown>)) {
    const key = day.toLowerCase();
    if (!isWeekdayKey(key)) continue;
    if (win === null || typeof win !== 'object') {
      out[key] = null;
      continue;
    }
    const { start, end } = win as Record<string, unknown>;
    if (typeof start === 'string' && typeof end === 'string' && HHMM.test(start) && HHMM.test(end)) {
      out[key] = { start, end };
    } else {
      out[key] = null;
    }
  }
  return out;
}

/** Parse `holidays` JSONB (array of {date,name}) into typed {@link Holiday}s. */
export function parseHolidays(raw: unknown): Holiday[] {
  const arr = asJson(raw);
  if (!Array.isArray(arr)) return [];
  const out: Holiday[] = [];
  for (const entry of arr) {
    if (entry === null || typeof entry !== 'object') continue;
    const { date, name } = entry as Record<string, unknown>;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      out.push(typeof name === 'string' ? { date, name } : { date });
    }
  }
  return out;
}

function isWeekdayKey(value: string): value is keyof WorkingHours {
  return (
    value === 'sun' ||
    value === 'mon' ||
    value === 'tue' ||
    value === 'wed' ||
    value === 'thu' ||
    value === 'fri' ||
    value === 'sat'
  );
}
