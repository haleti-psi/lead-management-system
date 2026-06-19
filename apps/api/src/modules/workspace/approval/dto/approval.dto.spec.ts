import { ApprovalDecision } from '@lms/shared';

import { ApprovalDto } from './approval.dto';

/**
 * FR-055 — unit tests for {@link ApprovalDto} Zod schema.
 * Covers: approve valid, reject+reason valid, reject-without-reason invalid,
 * reason too short, reason too long, bad decision enum.
 */
describe('ApprovalDto', () => {
  it('accepts approve without reason', () => {
    const result = ApprovalDto.safeParse({ decision: 'approve' });
    expect(result.success).toBe(true);
  });

  it('accepts approve with an optional reason', () => {
    const result = ApprovalDto.safeParse({ decision: 'approve', reason: 'Looks good to proceed.' });
    expect(result.success).toBe(true);
  });

  it('accepts reject with a valid reason (5–500 chars)', () => {
    const result = ApprovalDto.safeParse({
      decision: 'reject',
      reason: 'Credit profile insufficient for the requested amount.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when decision=reject and reason is absent', () => {
    const result = ApprovalDto.safeParse({ decision: 'reject' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
      expect(result.error.issues[0]?.message).toContain('reason is required when rejecting');
    }
  });

  it('rejects when decision=reject and reason is empty string', () => {
    const result = ApprovalDto.safeParse({ decision: 'reject', reason: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
    }
  });

  it('rejects when reason is below minimum length (< 5 chars)', () => {
    const result = ApprovalDto.safeParse({ decision: 'reject', reason: 'No' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
    }
  });

  it('rejects when reason exceeds maximum length (> 500 chars)', () => {
    const result = ApprovalDto.safeParse({
      decision: 'reject',
      reason: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('reason');
    }
  });

  it('rejects an invalid decision value', () => {
    const result = ApprovalDto.safeParse({ decision: 'approve_it' });
    expect(result.success).toBe(false);
  });

  it('rejects when decision is missing', () => {
    const result = ApprovalDto.safeParse({});
    expect(result.success).toBe(false);
  });

  it('infers correct type — decision is ApprovalDecision', () => {
    const good = ApprovalDto.parse({ decision: ApprovalDecision.APPROVE });
    expect(good.decision).toBe(ApprovalDecision.APPROVE);
    expect(good.reason).toBeUndefined();
  });
});
