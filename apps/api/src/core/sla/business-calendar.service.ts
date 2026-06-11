import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { KYSELY, type KyselyDb } from '../db';
import type { BusinessCalendars } from '../db/types.generated';
import { ORG_ID_DEFAULT } from '../outbox/outbox.constants';

/** The read (selected) shape of a `business_calendars` row. */
type CalendarRow = Selectable<BusinessCalendars>;
import { FALLBACK_CALENDAR, parseHolidays, parseWorkingHours } from './calendar-data';
import type { ResolvedCalendar } from './sla.types';

/**
 * FR-104 / ADR-6 — the single business-time clock source. Resolves the calendar
 * that governs SLA/TAT arithmetic for a given branch/region, in strict
 * precedence: branch-specific → region-specific → org default (`is_default`) →
 * a hardcoded Mon–Sat 09:30–18:30 IST fallback (logged as a warning).
 *
 * Read-only: it issues parameterised Kysely SELECTs against `business_calendars`
 * (active rows, org-scoped) and never writes. Every lookup is `LIMIT 1`.
 */
@Injectable()
export class BusinessCalendarService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    @InjectPinoLogger(BusinessCalendarService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Resolve the governing calendar. `branchId`/`regionId` are optional; when both
   * are absent (or unmatched) the org default is used, and when even that is
   * missing the hardcoded IST fallback is returned with a warning so SLA timers
   * never silently fail.
   */
  async resolve(branchId?: string | null, regionId?: string | null): Promise<ResolvedCalendar> {
    if (branchId) {
      const byBranch = await this.lookupByBranch(branchId);
      if (byBranch) return this.toResolved(byBranch, 'branch');
    }

    if (regionId) {
      const byRegion = await this.lookupByRegion(regionId);
      if (byRegion) return this.toResolved(byRegion, 'region');
    }

    const orgDefault = await this.lookupOrgDefault();
    if (orgDefault) return this.toResolved(orgDefault, 'org_default');

    this.logger.warn(
      { branchId: branchId ?? null, regionId: regionId ?? null },
      'No business calendar found (branch/region/org-default); using hardcoded Mon–Sat 09:30–18:30 IST fallback',
    );
    return FALLBACK_CALENDAR;
  }

  private lookupByBranch(branchId: string): Promise<CalendarRow | undefined> {
    return this.activeBase()
      .where('branch_id', '=', branchId)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  /** Region calendars are those bound to a region but not a specific branch. */
  private lookupByRegion(regionId: string): Promise<CalendarRow | undefined> {
    return this.activeBase()
      .where('region_id', '=', regionId)
      .where('branch_id', 'is', null)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  private lookupOrgDefault(): Promise<CalendarRow | undefined> {
    return this.activeBase()
      .where('is_default', '=', true)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  /** Org-scoped, active-only base select reused by every lookup. */
  private activeBase() {
    return this.db
      .selectFrom('business_calendars')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('is_active', '=', true);
  }

  private toResolved(row: CalendarRow, source: ResolvedCalendar['source']): ResolvedCalendar {
    return {
      businessCalendarId: row.business_calendar_id,
      code: row.code,
      timezone: row.timezone,
      workingHours: parseWorkingHours(row.working_hours),
      holidays: parseHolidays(row.holidays),
      source,
    };
  }
}
