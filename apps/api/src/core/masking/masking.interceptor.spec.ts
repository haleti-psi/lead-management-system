import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { MASKING_LEVEL_KEY, type MaskingLevel } from '../auth/abac-context';
import { MaskingInterceptor } from './masking.interceptor';
import { MaskingService } from './masking.service';

function ctxWithLevel(level: MaskingLevel | undefined): ExecutionContext {
  const req: Record<string, unknown> = { headers: {} };
  if (level) req[MASKING_LEVEL_KEY] = level;
  return {
    switchToHttp: () => ({ getRequest: <T>(): T => req as T }),
  } as unknown as ExecutionContext;
}

function handlerReturning(body: unknown): CallHandler {
  return { handle: () => of(body) } as CallHandler;
}

describe('MaskingInterceptor', () => {
  const interceptor = new MaskingInterceptor(new MaskingService());

  it('does not mutate the response when no masking level is set (e.g. FR-001 public routes)', async () => {
    const body = { access_token: 'tkn', email: 'abc@example.com', mobile: '9876543210' };
    const out = await firstValueFrom(interceptor.intercept(ctxWithLevel(undefined), handlerReturning(body)));
    expect(out).toEqual(body);
  });

  it('masks nested PII fields (mobile/pan_masked) for an RM partial-scope response (E-07/E-08)', async () => {
    const body = {
      lead_id: 'L1',
      lead_identities: { mobile: '9876543210', pan_masked: 'ABCDE1234F', aadhaar_ref_token: 'TOKEN_ABCD_1234' },
    };
    const out = (await firstValueFrom(
      interceptor.intercept(ctxWithLevel('partial'), handlerReturning(body)),
    )) as typeof body;
    expect(out.lead_identities.mobile).toBe('98xxxxxx10');
    expect(out.lead_identities.pan_masked).toBe('ABCxxxx4F');
    expect(out.lead_identities.aadhaar_ref_token).toBe('1234');
    expect(out.lead_id).toBe('L1');
  });

  it('masks across arrays of leads and reduces full_name under strict (DPO) scope', async () => {
    const body = [
      { full_name: 'Asha Verma', mobile: '9876543210' },
      { full_name: 'Ravi Kumar', mobile: '9000000001' },
    ];
    const out = (await firstValueFrom(
      interceptor.intercept(ctxWithLevel('strict'), handlerReturning(body)),
    )) as typeof body;
    expect(out[0]).toEqual({ full_name: 'Asha', mobile: '98xxxxxx10' });
    expect(out[1]).toEqual({ full_name: 'Ravi', mobile: '90xxxxxx01' });
  });

  it('leaves non-PII keys and Date values untouched', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const body = { lead_code: 'LD-2026-000001', created_at: when, score: 42 };
    const out = (await firstValueFrom(
      interceptor.intercept(ctxWithLevel('partial'), handlerReturning(body)),
    )) as typeof body;
    expect(out).toEqual(body);
    expect(out.created_at).toBe(when);
  });
});
