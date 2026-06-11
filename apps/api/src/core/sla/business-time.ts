import type { Holiday, WeekdayKey, WorkingHours, WorkingWindow } from './sla.types';

/**
 * FR-104 — pure business-time arithmetic (no external dependencies, ADR-6).
 *
 * All functions here are deterministic and side-effect-free; they take an
 * absolute instant (`Date`, i.e. UTC) plus a calendar and reason about the
 * calendar's LOCAL wall-clock using the IANA timezone. Timezone conversion uses
 * the built-in `Intl.DateTimeFormat` (Node ICU) — not a third-party date lib —
 * keeping the engine self-contained as the LLD requires.
 *
 * "Business minutes" advance only inside a day's open window and skip closed
 * days (weekends per `working_hours`, holidays). A start instant outside any
 * open window is first rolled forward to the next window's open edge, then the
 * budget is consumed window-by-window.
 */

const WEEKDAY_KEYS: readonly WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MINUTE_MS = 60_000;
/** Safety bound so a misconfigured (all-closed) calendar can never loop forever. */
const MAX_DAYS_SCANNED = 366;

/** The calendar-local wall-clock components of an absolute instant. */
interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: WeekdayKey;
  minutesIntoDay: number; // 0..1439 (local)
}

/**
 * Decompose an instant into the target timezone's local civil parts. Uses a
 * single `Intl.DateTimeFormat` pass (hour12=false) and reads the formatted
 * fields — robust across DST for any IANA zone (India has no DST, but this keeps
 * the engine correct if a non-IST calendar is ever configured).
 */
function localParts(instant: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayShort = get('weekday').toLowerCase().slice(0, 3) as WeekdayKey;
  // Intl renders midnight as "24" under hour12:false in some ICU builds; normalise.
  const rawHour = Number.parseInt(get('hour'), 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number.parseInt(get('minute'), 10);

  return {
    year: Number.parseInt(get('year'), 10),
    month: Number.parseInt(get('month'), 10),
    day: Number.parseInt(get('day'), 10),
    weekday: weekdayShort,
    minutesIntoDay: hour * 60 + minute,
  };
}

/**
 * The fixed UTC offset (in minutes) the timezone is at for the given instant,
 * derived by comparing the instant's local civil time to its UTC civil time.
 * Used to convert a desired local wall-clock back to an absolute instant.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const h = get('hour');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    h === 24 ? 0 : h,
    get('minute'),
    get('second'),
  );
  // (local civil expressed as UTC) − (actual UTC instant) = offset.
  return Math.round((asUTC - instant.getTime()) / MINUTE_MS);
}

/** Build the absolute instant for a local Y-M-D at `minutesIntoDay` in `timeZone`. */
function instantFromLocal(
  year: number,
  month: number,
  day: number,
  minutesIntoDay: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minutesIntoDay / 60);
  const minute = minutesIntoDay % 60;
  // First approximation assumes UTC, then correct by the zone offset at that instant.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = offsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * MINUTE_MS);
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(':');
  return Number.parseInt(h ?? '0', 10) * 60 + Number.parseInt(m ?? '0', 10);
}

function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** The open window for a weekday, or `null` when the day is closed/absent. */
function windowFor(workingHours: WorkingHours, weekday: WeekdayKey): WorkingWindow | null {
  return workingHours[weekday] ?? null;
}

function isHoliday(holidays: readonly Holiday[], year: number, month: number, day: number): boolean {
  const iso = isoDate(year, month, day);
  return holidays.some((h) => h.date === iso);
}

/**
 * Move (year,month,day) forward by `delta` calendar days using UTC date math
 * (timezone-agnostic for a pure date — no clock component involved).
 */
function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number; weekday: WeekdayKey } {
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + delta);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    weekday: WEEKDAY_KEYS[base.getUTCDay()] as WeekdayKey,
  };
}

interface OpenDay {
  year: number;
  month: number;
  day: number;
  open: number; // minutes into day
  close: number; // minutes into day
}

/**
 * The next open business day at or after the given local date, accounting for
 * weekends (closed weekdays) and holidays. Returns `null` only if no open day
 * exists within {@link MAX_DAYS_SCANNED} (a misconfigured calendar).
 */
function nextOpenDay(
  workingHours: WorkingHours,
  holidays: readonly Holiday[],
  fromYear: number,
  fromMonth: number,
  fromDay: number,
  fromWeekday: WeekdayKey,
): OpenDay | null {
  let cur = { year: fromYear, month: fromMonth, day: fromDay, weekday: fromWeekday };
  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    const window = windowFor(workingHours, cur.weekday);
    if (window && !isHoliday(holidays, cur.year, cur.month, cur.day)) {
      return {
        year: cur.year,
        month: cur.month,
        day: cur.day,
        open: parseHHMM(window.start),
        close: parseHHMM(window.end),
      };
    }
    cur = addDays(cur.year, cur.month, cur.day, 1);
  }
  return null;
}

export interface BusinessTimeCalendar {
  readonly timezone: string;
  readonly workingHours: WorkingHours;
  readonly holidays: readonly Holiday[];
}

/**
 * Add `minutes` BUSINESS minutes to `start` over `calendar`, returning the
 * absolute due instant. Closed days and out-of-window time are skipped; the
 * budget is consumed only within open windows. A zero/negative budget returns
 * the start rolled forward to the first open edge (so a due-at is always inside
 * business time). Throws if the calendar has no open day at all.
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessTimeCalendar): Date {
  const { timezone, workingHours, holidays } = calendar;
  let remaining = Math.max(0, Math.trunc(minutes));

  // Resolve the local civil position of `start`.
  const parts = localParts(start, timezone);
  let day = nextOpenDay(workingHours, holidays, parts.year, parts.month, parts.day, parts.weekday);
  if (!day) {
    throw new Error('Business calendar has no open days; cannot compute due time.');
  }

  // Cursor = current minute-into-day position we are consuming from, on `day`.
  let cursor: number;
  if (day.year === parts.year && day.month === parts.month && day.day === parts.day) {
    // Same calendar day as start: begin at max(now, open). If already past close,
    // fall through to the next open day below.
    cursor = Math.max(parts.minutesIntoDay, day.open);
    if (cursor >= day.close) {
      const next = addDays(day.year, day.month, day.day, 1);
      const nd = nextOpenDay(workingHours, holidays, next.year, next.month, next.day, next.weekday);
      if (!nd) throw new Error('Business calendar has no open days; cannot compute due time.');
      day = nd;
      cursor = day.open;
    }
  } else {
    // `start` fell on a closed day → begin at the next open day's open edge.
    cursor = day.open;
  }

  // Consume the budget window-by-window.
  for (let guard = 0; guard <= MAX_DAYS_SCANNED; guard += 1) {
    const available = day.close - cursor;
    if (remaining <= available) {
      const endMinute = cursor + remaining;
      return instantFromLocal(day.year, day.month, day.day, endMinute, timezone);
    }
    remaining -= available;
    const next = addDays(day.year, day.month, day.day, 1);
    const nd = nextOpenDay(workingHours, holidays, next.year, next.month, next.day, next.weekday);
    if (!nd) throw new Error('Business calendar has no open days; cannot compute due time.');
    day = nd;
    cursor = day.open;
  }

  // Unreachable under MAX_DAYS_SCANNED for any sane threshold; defensive throw.
  throw new Error('Business-minute computation exceeded the day-scan bound.');
}
