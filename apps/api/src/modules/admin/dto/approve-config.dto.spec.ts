import { ApproveConfigDto } from './approve-config.dto';
import { RollbackConfigDto } from './rollback-config.dto';
import { ConfigIdParam } from './config-id-param.dto';

/**
 * FR-132 validation tests (T14, T15, T16, T17). The schemas are asserted
 * directly; the ZodValidationPipe maps any failure to VALIDATION_ERROR(400) with
 * field-level issues whose `field` is the issue path.
 */

function issues(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return (result.error?.issues ?? []).map((i) => ({ field: i.path.join('.') || 'id', message: i.message }));
}

describe('ApproveConfigDto', () => {
  it('accepts action=approved with an optional comment', () => {
    expect(ApproveConfigDto.safeParse({ action: 'approved', comment: 'Looks good' }).success).toBe(true);
  });

  it('accepts action=rejected with no comment', () => {
    expect(ApproveConfigDto.safeParse({ action: 'rejected' }).success).toBe(true);
  });

  it('rejects an invalid action value (T14)', () => {
    const found = issues(ApproveConfigDto, { action: 'do_it' });
    expect(found.some((i) => i.field === 'action')).toBe(true);
  });

  it('rejects a missing action', () => {
    const found = issues(ApproveConfigDto, {});
    expect(found.some((i) => i.field === 'action')).toBe(true);
  });

  it('rejects a comment exceeding 500 characters', () => {
    const found = issues(ApproveConfigDto, { action: 'approved', comment: 'x'.repeat(501) });
    expect(found.some((i) => i.field === 'comment')).toBe(true);
  });

  it('strips unknown fields', () => {
    const result = ApproveConfigDto.safeParse({ action: 'approved', injected: true });
    expect(result.success).toBe(true);
    if (result.success) expect('injected' in result.data).toBe(false);
  });
});

describe('RollbackConfigDto', () => {
  it('accepts a non-empty reason', () => {
    expect(RollbackConfigDto.safeParse({ reason: 'Reverting bad config' }).success).toBe(true);
  });

  it('rejects a missing reason (T15)', () => {
    const found = issues(RollbackConfigDto, {});
    expect(found.some((i) => i.field === 'reason')).toBe(true);
  });

  it('rejects an empty reason', () => {
    const found = issues(RollbackConfigDto, { reason: '' });
    expect(found.some((i) => i.field === 'reason')).toBe(true);
  });

  it('rejects a reason exceeding 500 characters (T16)', () => {
    const found = issues(RollbackConfigDto, { reason: 'x'.repeat(501) });
    expect(found.some((i) => i.field === 'reason')).toBe(true);
  });
});

describe('ConfigIdParam', () => {
  it('accepts a valid UUID', () => {
    expect(ConfigIdParam.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true);
  });

  it('rejects a non-UUID path parameter (T17)', () => {
    const result = ConfigIdParam.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('id must be a valid UUID');
  });
});
