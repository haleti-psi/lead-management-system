import { ZodValidationPipe } from '../../../core/common';
import { isDomainException } from '../../../core/http';
import { AuditExplorerQueryDto } from './audit-explorer-query.dto';
import { AuditUnmaskDto } from './audit-unmask.dto';

/**
 * FR-123 — DTO validation (the controller-boundary Zod gate). Mirrors the
 * VALIDATION_ERROR test cases (T-10 bad action, T-11 bad entity_type, T-12
 * from > to) at the unit level, plus pagination defaults/bounds and the unmask
 * body. The API-integration (Testcontainers) tier is DEFERRED.
 */

function parseQuery(input: Record<string, unknown>): AuditExplorerQueryDto {
  return new ZodValidationPipe(AuditExplorerQueryDto).transform(input);
}

function fieldErrorFor(input: Record<string, unknown>): { code: string; field?: string } {
  try {
    parseQuery(input);
    throw new Error('expected VALIDATION_ERROR');
  } catch (err) {
    if (!isDomainException(err)) throw err;
    return { code: err.code, field: err.fields?.[0]?.field };
  }
}

describe('AuditExplorerQueryDto', () => {
  it('defaults page=1 and limit=25 when omitted', () => {
    const parsed = parseQuery({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(25);
  });

  it('coerces string page/limit and accepts a valid action + entity_type', () => {
    const parsed = parseQuery({ page: '2', limit: '50', action: 'stage_transition', entity_type: 'leads' });
    expect(parsed).toMatchObject({ page: 2, limit: 50, action: 'stage_transition', entity_type: 'leads' });
  });

  it('rejects an unknown action value (T-10) with field=action', () => {
    expect(fieldErrorFor({ action: 'DOES_NOT_EXIST' })).toEqual({ code: 'VALIDATION_ERROR', field: 'action' });
  });

  it('rejects an entity_type outside the allow-list (T-11) with field=entity_type', () => {
    expect(fieldErrorFor({ entity_type: 'secret_table' })).toEqual({
      code: 'VALIDATION_ERROR',
      field: 'entity_type',
    });
  });

  it('rejects from > to (T-12)', () => {
    const result = fieldErrorFor({ from: '2026-06-10T00:00:00Z', to: '2026-06-01T00:00:00Z' });
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(['from', 'to']).toContain(result.field);
  });

  it('rejects limit > 100', () => {
    expect(fieldErrorFor({ limit: '500' })).toMatchObject({ code: 'VALIDATION_ERROR', field: 'limit' });
  });

  it('rejects a non-UUID lead_id', () => {
    expect(fieldErrorFor({ lead_id: 'not-a-uuid' })).toMatchObject({ code: 'VALIDATION_ERROR', field: 'lead_id' });
  });
});

describe('AuditUnmaskDto', () => {
  function parseUnmask(input: Record<string, unknown>): { code: string; field?: string } | true {
    try {
      new ZodValidationPipe(AuditUnmaskDto).transform(input);
      return true;
    } catch (err) {
      if (!isDomainException(err)) throw err;
      return { code: err.code, field: err.fields?.[0]?.field };
    }
  }

  it('accepts a valid single-field unmask body', () => {
    expect(
      parseUnmask({ audit_id: '11111111-1111-1111-1111-111111111111', field: 'mobile', reason: 'evidence request #1' }),
    ).toBe(true);
  });

  it('rejects an un-unmaskable field', () => {
    expect(
      parseUnmask({ audit_id: '11111111-1111-1111-1111-111111111111', field: 'note', reason: 'a valid reason here' }),
    ).toMatchObject({ code: 'VALIDATION_ERROR', field: 'field' });
  });

  it('rejects a too-short reason', () => {
    expect(
      parseUnmask({ audit_id: '11111111-1111-1111-1111-111111111111', field: 'mobile', reason: 'short' }),
    ).toMatchObject({ code: 'VALIDATION_ERROR', field: 'reason' });
  });
});
