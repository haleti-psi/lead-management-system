import { CreateBusinessCalendarDto } from './business-calendar.dto';
import { CreateRejectionReasonDto, PatchRejectionReasonDto } from './rejection-reason.dto';
import { CreateRetentionPolicyDto } from './retention-policy.dto';

/**
 * FR-131 unit tests for the per-resource Zod DTOs (LLD §Validation Logic). These
 * mirror the FR-104 SLA threshold/timezone/date cases (T35–T37) on FR-131's own
 * resources, plus the enum/required-field and JSON-object rules.
 */

const FULL_WEEK = {
  mon: { start: '09:30', end: '18:30' },
  tue: { start: '09:30', end: '18:30' },
  wed: { start: '09:30', end: '18:30' },
  thu: { start: '09:30', end: '18:30' },
  fri: { start: '09:30', end: '18:30' },
  sat: null,
  sun: null,
};

describe('FR-131 master DTOs', () => {
  describe('RejectionReasonDto', () => {
    it('accepts a valid enum primaryReason', () => {
      const r = CreateRejectionReasonDto.safeParse({ primaryReason: 'out_of_area', subReason: 'x', requiresRemarks: true });
      expect(r.success).toBe(true);
    });

    it('T18 — rejects an invalid enum primaryReason on field primaryReason', () => {
      const r = CreateRejectionReasonDto.safeParse({ primaryReason: 'invalid_value' });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['primaryReason']);
    });

    it('rejects subReason longer than 80 chars', () => {
      const r = CreateRejectionReasonDto.safeParse({ primaryReason: 'other', subReason: 'a'.repeat(81) });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['subReason']);
    });

    it('patch rejects an empty body (at-least-one-key)', () => {
      expect(PatchRejectionReasonDto.safeParse({}).success).toBe(false);
    });

    it('patch accepts isActive only', () => {
      expect(PatchRejectionReasonDto.safeParse({ isActive: false }).success).toBe(true);
    });
  });

  describe('BusinessCalendarDto', () => {
    it('T36 — rejects an invalid IANA timezone on field timezone', () => {
      const r = CreateBusinessCalendarDto.safeParse({ code: 'C1', name: 'Cal', timezone: 'Invalid/Zone', workingHours: FULL_WEEK });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path.join('.') === 'timezone')).toBe(true);
    });

    it('accepts a valid IANA timezone and full weekday schedule', () => {
      const r = CreateBusinessCalendarDto.safeParse({ code: 'C1', name: 'Cal', timezone: 'Asia/Kolkata', workingHours: FULL_WEEK });
      expect(r.success).toBe(true);
    });
  });

  describe('RetentionPolicyDto', () => {
    it('rejects a negative retainDays', () => {
      const r = CreateRetentionPolicyDto.safeParse({ dataCategory: 'identity', retainDays: -1, action: 'purge' });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['retainDays']);
    });

    it('accepts retainDays = 0 with legalHold default', () => {
      expect(CreateRetentionPolicyDto.safeParse({ dataCategory: 'identity', retainDays: 0, action: 'anonymise' }).success).toBe(true);
    });
  });
});
