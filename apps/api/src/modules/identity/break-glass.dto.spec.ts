import { ERROR_CODES, GrantStatus } from '@lms/shared';

import { DomainException } from '../../core/http';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, ZodValidationPipe } from '../../core/common';
import { ListBreakGlassQuery, makeBreakGlassRequestSchema } from './break-glass.dto';

/**
 * FR-003 request-schema validation tests (T08–T12, T26). The schema is exercised
 * through {@link ZodValidationPipe} exactly as the controller uses it, so a
 * failure surfaces as `VALIDATION_ERROR` (400) with the expected `fields[0]`.
 */

const MAX_WINDOW_HOURS = 48;
const GRANTEE = '11111111-1111-1111-1111-111111111111';
const APPROVER = '22222222-2222-2222-2222-222222222222';
const LEAD = '33333333-3333-3333-3333-333333333333';
const T0 = '2026-06-09T09:00:00.000Z';

function pipe() {
  return new ZodValidationPipe(makeBreakGlassRequestSchema(MAX_WINDOW_HOURS));
}

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    granteeId: GRANTEE,
    approverId: APPROVER,
    scopeType: 'lead',
    scopeRef: LEAD,
    reason: 'Incident #4471 — data review',
    validFrom: T0,
    validUntil: '2026-06-09T11:00:00.000Z',
    ...overrides,
  };
}

/** Run the pipe and return the DomainException it throws. */
function reject(body: Record<string, unknown>): DomainException {
  try {
    pipe().transform(body);
    throw new Error('expected validation to reject');
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return err as DomainException;
  }
}

describe('makeBreakGlassRequestSchema', () => {
  it('accepts a well-formed request within the window', () => {
    const dto = pipe().transform(base());
    expect(dto.granteeId).toBe(GRANTEE);
    expect(dto.scopeType).toBe('lead');
  });

  it('accepts scopeType=all without a scopeRef', () => {
    const dto = pipe().transform(base({ scopeType: 'all', scopeRef: null }));
    expect(dto.scopeType).toBe('all');
    expect(dto.scopeRef).toBeNull();
  });

  it('rejects when validUntil <= validFrom (T08)', () => {
    const err = reject(base({ validUntil: T0 }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.[0]?.field).toBe('validUntil');
  });

  it('rejects when the window exceeds BREAK_GLASS_MAX_WINDOW_HOURS (T09)', () => {
    // 49h > 48h max.
    const err = reject(base({ validUntil: '2026-06-11T10:00:00.000Z' }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.[0]?.field).toBe('validUntil');
    expect(err.fields?.[0]?.issue).toContain('48');
  });

  it('rejects a blank reason (T10)', () => {
    const err = reject(base({ reason: '' }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.[0]?.field).toBe('reason');
  });

  it('rejects a reason longer than 500 characters (T11)', () => {
    const err = reject(base({ reason: 'x'.repeat(501) }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.[0]?.field).toBe('reason');
  });

  it('rejects scopeType=lead with a null scopeRef (T12)', () => {
    const err = reject(base({ scopeType: 'lead', scopeRef: null }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.some((f) => f.field === 'scopeRef')).toBe(true);
  });

  it('rejects an unknown scopeType (T26)', () => {
    const err = reject(base({ scopeType: 'department' }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.[0]?.field).toBe('scopeType');
  });

  it('rejects when approverId equals granteeId (four-eyes, request side)', () => {
    const err = reject(base({ approverId: GRANTEE }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(err.fields?.some((f) => f.field === 'approverId')).toBe(true);
  });
});

describe('ListBreakGlassQuery', () => {
  it('defaults page=1 and limit=DEFAULT_PAGE_LIMIT when absent', () => {
    expect(ListBreakGlassQuery.parse({})).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT });
  });

  it('coerces string page/limit and keeps a valid status', () => {
    expect(ListBreakGlassQuery.parse({ page: '2', limit: '50', status: GrantStatus.ACTIVE })).toEqual({
      page: 2,
      limit: 50,
      status: GrantStatus.ACTIVE,
    });
  });

  it('accepts limit at the MAX_PAGE_LIMIT boundary', () => {
    expect(ListBreakGlassQuery.parse({ limit: MAX_PAGE_LIMIT }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('rejects a limit above MAX_PAGE_LIMIT', () => {
    expect(ListBreakGlassQuery.safeParse({ limit: MAX_PAGE_LIMIT + 1 }).success).toBe(false);
  });

  it('rejects an unknown status value', () => {
    expect(ListBreakGlassQuery.safeParse({ status: 'archived' }).success).toBe(false);
  });
});
