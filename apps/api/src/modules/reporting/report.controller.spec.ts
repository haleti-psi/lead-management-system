import { DataScope, ERROR_CODES, RoleCode, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { SCOPE_PREDICATE_KEY, type AbacRequestContext } from '../../core/auth';
import { isDomainException } from '../../core/http';
import { ReportController } from './report.controller';
import type { ReportData } from './dto/report-response.dto';
import type { ReportService } from './report.service';

// ── Custom matcher ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toSatisfyDomainException(code: string): R;
    }
  }
}

expect.extend({
  toSatisfyDomainException(received: unknown, code: string) {
    const pass = isDomainException(received) && received.code === code;
    return {
      pass,
      message: () =>
        pass
          ? `Expected error not to be DomainException(${code})`
          : `Expected DomainException(${code}) but received: ${JSON.stringify(received)}`,
    };
  },
});

/**
 * FR-120 component tests for {@link ReportController}: path-param code
 * validation (T-07, T-20), ABAC predicate absent (FORBIDDEN), pagination meta
 * assembled correctly (T-24), and happy-path dispatch shape.
 */

const ORG = '00000000-0000-0000-0000-000000000001';

function user(role: RoleCode, scope: DataScope): AuthUser {
  return { userId: 'u1', orgId: ORG, role, scope, jti: 'j' };
}

const HEAD = user(RoleCode.HEAD, DataScope.A);
const predicate: ScopePredicate = { type: 'all', orgId: ORG };

function makeReq(pred: ScopePredicate | 'NONE' = predicate): AbacRequestContext {
  const req = {} as AbacRequestContext;
  if (pred !== 'NONE') {
    req[SCOPE_PREDICATE_KEY] = pred;
  }
  return req;
}

const mockData: ReportData = {
  report_code: 'funnel_conversion',
  generated_at: '2026-06-09T12:34:56.789+05:30',
  scope: { branch_id: null, team_id: null, owner_id: null },
  period: { from: null, to: null },
  rows: [],
};

function serviceMock(totalOverride = 7): ReportService {
  return {
    getReport: jest.fn().mockResolvedValue({ data: mockData, total: totalOverride }),
  } as unknown as ReportService;
}

// ── T-20: invalid code → VALIDATION_ERROR ───────────────────────────────────

describe('ReportController — invalid code', () => {
  it('T-07 / T-20: unknown code → VALIDATION_ERROR with fields[code]', async () => {
    const ctrl = new ReportController(serviceMock());
    await expect(
      ctrl.getReport('made_up_code', { page: 1, limit: 25 }, HEAD, makeReq()),
    ).rejects.toSatisfyDomainException(ERROR_CODES.VALIDATION_ERROR);
  });

  it('VALIDATION_ERROR contains fields[code]', async () => {
    const ctrl = new ReportController(serviceMock());
    let caught: unknown;
    try {
      await ctrl.getReport('bad_code', { page: 1, limit: 25 }, HEAD, makeReq());
    } catch (err) {
      caught = err;
    }
    expect(isDomainException(caught)).toBe(true);
    if (isDomainException(caught)) {
      expect(caught.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(caught.fields?.some((f) => f.field === 'code')).toBe(true);
    }
  });
});

// ── FORBIDDEN when predicate absent ──────────────────────────────────────────

describe('ReportController — predicate absent', () => {
  it('throws FORBIDDEN when AbacGuard predicate not on request', async () => {
    const ctrl = new ReportController(serviceMock());
    await expect(
      ctrl.getReport('funnel_conversion', { page: 1, limit: 25 }, HEAD, makeReq('NONE')),
    ).rejects.toSatisfyDomainException(ERROR_CODES.FORBIDDEN);
  });
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe('ReportController — happy path', () => {
  it('T-11: funnel_conversion → 200 with envelope + pagination', async () => {
    const svc = serviceMock(7);
    const ctrl = new ReportController(svc);
    const result = await ctrl.getReport('funnel_conversion', { page: 1, limit: 25 }, HEAD, makeReq());

    expect(result.error).toBeNull();
    expect(result.data.report_code).toBe('funnel_conversion');
    expect(result.data.generated_at).toMatch(/\+05:30$/);
    expect(result.meta.pagination).toEqual({ page: 1, limit: 25, total: 7 });
  });

  // T-24: pagination metadata correct
  it('T-24: pagination page/limit/total propagated correctly', async () => {
    const svc = serviceMock(42);
    const ctrl = new ReportController(svc);
    const result = await ctrl.getReport(
      'rejection_summary',
      { page: 3, limit: 10 },
      HEAD,
      makeReq(),
    );
    expect(result.meta.pagination).toEqual({ page: 3, limit: 10, total: 42 });
  });

  it('T-14: rejection_summary dispatched via service', async () => {
    const svc = serviceMock();
    const ctrl = new ReportController(svc);
    await ctrl.getReport('rejection_summary', { page: 1, limit: 25 }, HEAD, makeReq());
    expect(svc.getReport).toHaveBeenCalledWith('rejection_summary', expect.anything(), HEAD, predicate);
  });
});

// ── T-15, T-16, T-17 are enforced by JwtAuthGuard + AbacGuard (tested by
//    the NestJS testing module; skipped here per contract: we test the
//    controller's own logic only). The capability check (FORBIDDEN for ADMIN
//    / CUSTOMER) is asserted in integration via real/mock ABAC in the API spec.

