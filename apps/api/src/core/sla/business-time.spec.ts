import { addBusinessMinutes, type BusinessTimeCalendar } from './business-time';
import { FALLBACK_CALENDAR } from './calendar-data';

/**
 * FR-104 unit tests for the pure business-time arithmetic (TC-014). All instants
 * are constructed with an explicit IST offset (+05:30) so the assertions are
 * timezone-independent regardless of where the test host runs. The calendar is
 * Mon–Sat 09:30–18:30 IST (Sun closed), matching the seed/fallback.
 */

const IST: BusinessTimeCalendar = {
  timezone: FALLBACK_CALENDAR.timezone,
  workingHours: FALLBACK_CALENDAR.workingHours,
  holidays: FALLBACK_CALENDAR.holidays,
};

/** Build an absolute instant from an IST wall-clock literal. */
function ist(literal: string): Date {
  return new Date(`${literal}+05:30`);
}

/** Format an instant back to IST "YYYY-MM-DD HH:MM" for readable assertions. */
function toIst(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

describe('addBusinessMinutes (IST Mon–Sat 09:30–18:30)', () => {
  it('adds minutes within a single open day', () => {
    // Fri 10:00 + 120 min → Fri 12:00 (same day, fully inside the window).
    expect(toIst(addBusinessMinutes(ist('2026-06-12T10:00:00'), 120, IST))).toBe('2026-06-12 12:00');
  });

  it('rolls over the closing edge and the weekend (TC-014)', () => {
    // Fri 17:00 + 240 min: 90 min to 18:30 close, 150 min remain → Sat 09:30+150 = Sat 12:00.
    expect(toIst(addBusinessMinutes(ist('2026-06-12T17:00:00'), 240, IST))).toBe('2026-06-13 12:00');
  });

  it('skips Sunday (closed) entirely', () => {
    // Sat 18:00 + 60 min: 30 min to close, 30 remain → skip Sun → Mon 09:30+30 = Mon 10:00.
    expect(toIst(addBusinessMinutes(ist('2026-06-13T18:00:00'), 60, IST))).toBe('2026-06-15 10:00');
  });

  it('treats a start before opening as opening time', () => {
    // Fri 08:00 (before 09:30) + 60 min → Fri 10:30.
    expect(toIst(addBusinessMinutes(ist('2026-06-12T08:00:00'), 60, IST))).toBe('2026-06-12 10:30');
  });

  it('treats a start after closing as the next open day', () => {
    // Fri 20:00 (after close) + 60 min → Sat 09:30 + 60 = Sat 10:30.
    expect(toIst(addBusinessMinutes(ist('2026-06-12T20:00:00'), 60, IST))).toBe('2026-06-13 10:30');
  });

  it('skips a configured holiday', () => {
    // Calendar with Diwali (Wed 2026-10-21) as a holiday. Tue 2026-10-20 18:00 + 60:
    // 30 min to close, 30 remain → skip Wed holiday → Thu 2026-10-22 09:30+30 = 10:00.
    const withHoliday: BusinessTimeCalendar = {
      ...IST,
      holidays: [{ date: '2026-10-21', name: 'Diwali' }],
    };
    expect(toIst(addBusinessMinutes(ist('2026-10-20T18:00:00'), 60, withHoliday))).toBe(
      '2026-10-22 10:00',
    );
  });

  it('spans multiple full business days for a large budget', () => {
    // Mon 09:30 + 1620 min (3 × 540-min days) → end of Wed window = Wed 18:30.
    // 540 min/day: Mon 09:30→18:30 (540), Tue (540), Wed (540) consumes exactly → Wed 18:30.
    expect(toIst(addBusinessMinutes(ist('2026-06-15T09:30:00'), 1620, IST))).toBe('2026-06-17 18:30');
  });

  it('clamps a zero/negative budget to the next open edge', () => {
    // Sun (closed) with 0 minutes → Mon 09:30 (rolled to the first open edge).
    expect(toIst(addBusinessMinutes(ist('2026-06-14T12:00:00'), 0, IST))).toBe('2026-06-15 09:30');
  });

  it('throws when the calendar has no open days', () => {
    const closed: BusinessTimeCalendar = {
      timezone: 'Asia/Kolkata',
      workingHours: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null },
      holidays: [],
    };
    expect(() => addBusinessMinutes(ist('2026-06-12T10:00:00'), 60, closed)).toThrow();
  });
});
