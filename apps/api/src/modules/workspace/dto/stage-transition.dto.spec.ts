import { LeadStage } from '@lms/shared';

import { StageTransitionDtoSchema } from './stage-transition.dto';

/**
 * FR-052 — DTO validation tests (T12, T13, T14 from FR-052-tests.md).
 * Validates the Zod schema for PATCH /leads/{id}/stage.
 */
describe('StageTransitionDtoSchema', () => {
  // ── T01 happy path ─────────────────────────────────────────────────────

  it('T01 — valid body parses successfully', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'contacted',
      expected_version: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toBe(LeadStage.CONTACTED);
      expect(result.data.expected_version).toBe(2);
    }
  });

  it('T03 — rejected with reason parses successfully', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'rejected',
      expected_version: 4,
      reason: 'Not interested',
    });
    expect(result.success).toBe(true);
  });

  // ── T12: Missing to field ───────────────────────────────────────────────

  it('T12 — missing `to` fails validation', () => {
    const result = StageTransitionDtoSchema.safeParse({
      expected_version: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('to');
    }
  });

  // ── T13: Invalid enum value ─────────────────────────────────────────────

  it('T13 — invalid enum value for `to` fails validation', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'flying',
      expected_version: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('to');
    }
  });

  // ── T14: reason required for rejected/dormant ───────────────────────────

  it('T14 — reason is required when to=rejected', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'rejected',
      expected_version: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
    }
  });

  it('T14 analogue — reason is required when to=dormant', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'dormant',
      expected_version: 3,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
    }
  });

  it('dormant with reason passes validation', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'dormant',
      expected_version: 3,
      reason: 'Nurture for 3 months',
    });
    expect(result.success).toBe(true);
  });

  it('expected_version must be a positive integer', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'contacted',
      expected_version: 0,
    });
    expect(result.success).toBe(false);
  });

  it('reason max 500 chars', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'contacted',
      expected_version: 1,
      reason: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('reason exactly 500 chars passes', () => {
    const result = StageTransitionDtoSchema.safeParse({
      to: 'contacted',
      expected_version: 1,
      reason: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });
});
