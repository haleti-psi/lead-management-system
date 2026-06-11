import { z } from 'zod';

import { atLeastOneKey, isValidTimezone } from './common';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** `{ start, end }` in HH:MM, or `null` for a non-working day. */
const dayHours = z
  .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
  .nullable();

/** Per-weekday schedule; every weekday key is required (value may be null). */
const workingHours = z.object({
  mon: dayHours,
  tue: dayHours,
  wed: dayHours,
  thu: dayHours,
  fri: dayHours,
  sat: dayHours,
  sun: dayHours,
});

const holiday = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'holidays entries must have date in YYYY-MM-DD format.'),
  name: z.string().min(1),
});

/**
 * FR-131 — `business_calendars` master (schema 3.15b). `code` unique per org;
 * `working_hours` JSONB keyed by weekday; `holidays` JSONB array. Branch-scoped
 * via the optional `branch_id` (a BM may manage their own branch's calendar).
 */
export const CreateBusinessCalendarDto = z.object({
  code: z
    .string({ required_error: 'code is required and must be unique.' })
    .min(1, 'code is required and must be unique.')
    .max(40, 'code must not exceed 40 characters.'),
  name: z
    .string({ required_error: 'name is required.' })
    .min(1, 'name is required.')
    .max(120, 'name must not exceed 120 characters.'),
  timezone: z
    .string()
    .refine(isValidTimezone, 'timezone must be a valid IANA timezone.')
    .optional(),
  branchId: z.string().uuid('branchId must be a valid UUID.').optional(),
  regionId: z.string().uuid('regionId must be a valid UUID.').optional(),
  workingHours: workingHours.refine(
    (wh) => WEEKDAYS.every((d) => d in wh),
    'workingHours must define per-weekday schedules.',
  ),
  holidays: z.array(holiday).optional(),
});
export type CreateBusinessCalendarDto = z.infer<typeof CreateBusinessCalendarDto>;

export const PatchBusinessCalendarDto = atLeastOneKey(
  CreateBusinessCalendarDto.partial().extend({ isActive: z.boolean().optional() }),
);
export type PatchBusinessCalendarDto = z.infer<typeof PatchBusinessCalendarDto>;
