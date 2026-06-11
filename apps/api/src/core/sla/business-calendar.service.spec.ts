import { BusinessCalendarService } from './business-calendar.service';
import { FALLBACK_CALENDAR } from './calendar-data';
import type { KyselyDb } from '../db';

/**
 * FR-104 unit tests for calendar resolution order + fallback (TC-015).
 *
 * A hand-rolled Kysely fake captures the `.where(column, ...)` columns of each
 * lookup chain and returns whichever seeded row matches that lookup's signature:
 *   - branch lookup  → constrains `branch_id`
 *   - region lookup  → constrains `region_id` (and `branch_id is null`)
 *   - org-default    → constrains `is_default`
 * This lets one fake serve all three lookups and assert precedence without a DB.
 */

interface SeededCalendars {
  branch?: Record<string, unknown>;
  region?: Record<string, unknown>;
  orgDefault?: Record<string, unknown>;
}

function fakeDb(seed: SeededCalendars): KyselyDb {
  const makeChain = () => {
    const columns: string[] = [];
    const chain = {
      selectAll: () => chain,
      where(column: string, ..._rest: unknown[]) {
        columns.push(column);
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      async executeTakeFirst() {
        if (columns.includes('branch_id') && !columns.includes('region_id') && !columns.includes('is_default')) {
          return seed.branch;
        }
        if (columns.includes('region_id')) {
          return seed.region;
        }
        if (columns.includes('is_default')) {
          return seed.orgDefault;
        }
        return undefined;
      },
    };
    return chain;
  };

  return {
    selectFrom: () => makeChain(),
  } as unknown as KyselyDb;
}

function fakeLogger() {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
}

const ROW = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  business_calendar_id: 'cal-x',
  code: 'X',
  timezone: 'Asia/Kolkata',
  working_hours: { mon: { start: '10:00', end: '17:00' }, sun: null },
  holidays: [],
  ...overrides,
});

describe('BusinessCalendarService.resolve', () => {
  it('prefers the branch calendar when one exists', async () => {
    const logger = fakeLogger();
    const svc = new BusinessCalendarService(
      fakeDb({
        branch: ROW({ business_calendar_id: 'branch-cal', code: 'BRANCH' }),
        region: ROW({ business_calendar_id: 'region-cal', code: 'REGION' }),
        orgDefault: ROW({ business_calendar_id: 'default-cal', code: 'DEFAULT' }),
      }),
      logger as never,
    );

    const resolved = await svc.resolve('branch-1', 'region-1');
    expect(resolved.source).toBe('branch');
    expect(resolved.code).toBe('BRANCH');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the region calendar when no branch calendar', async () => {
    const svc = new BusinessCalendarService(
      fakeDb({
        region: ROW({ business_calendar_id: 'region-cal', code: 'REGION' }),
        orgDefault: ROW({ business_calendar_id: 'default-cal', code: 'DEFAULT' }),
      }),
      fakeLogger() as never,
    );

    const resolved = await svc.resolve('branch-1', 'region-1');
    expect(resolved.source).toBe('region');
    expect(resolved.code).toBe('REGION');
  });

  it('falls back to the org default when no branch/region calendar', async () => {
    const svc = new BusinessCalendarService(
      fakeDb({ orgDefault: ROW({ business_calendar_id: 'default-cal', code: 'DEFAULT' }) }),
      fakeLogger() as never,
    );

    const resolved = await svc.resolve('branch-1', 'region-1');
    expect(resolved.source).toBe('org_default');
    expect(resolved.code).toBe('DEFAULT');
  });

  it('uses the hardcoded IST fallback and warns when no calendar row exists', async () => {
    const logger = fakeLogger();
    const svc = new BusinessCalendarService(fakeDb({}), logger as never);

    const resolved = await svc.resolve(null, null);
    expect(resolved.source).toBe('fallback');
    expect(resolved.code).toBe(FALLBACK_CALENDAR.code);
    expect(resolved.timezone).toBe('Asia/Kolkata');
    expect(resolved.workingHours.sun).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('parses working_hours/holidays from the resolved row', async () => {
    const svc = new BusinessCalendarService(
      fakeDb({
        branch: ROW({
          working_hours: { mon: { start: '09:00', end: '18:00' }, sun: null },
          holidays: [{ date: '2026-10-21', name: 'Diwali' }],
        }),
      }),
      fakeLogger() as never,
    );

    const resolved = await svc.resolve('branch-1');
    expect(resolved.workingHours.mon).toEqual({ start: '09:00', end: '18:00' });
    expect(resolved.holidays).toEqual([{ date: '2026-10-21', name: 'Diwali' }]);
  });
});
