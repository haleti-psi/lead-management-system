import { Injectable } from '@nestjs/common';

import type { KycPort } from '../ports/kyc.port';
import type { IntegrationRequest } from '../ports/integration-port';
import { ProviderCallError, type ProviderResponse } from '../ports/provider-response';

/**
 * Deterministic in-process {@link KycPort} for dev/test (integration-map.md §KYC
 * test double: "never call a real KYC provider in unit/integration tests"). No
 * network I/O. Steered by an optional `payload.__mock` directive exactly like
 * {@link LosMockAdapter} (`status` number, `fail` boolean); default success is
 * `200` with an echo body. Returns no raw PII — only an opaque marker body.
 */
@Injectable()
export class KycMockAdapter implements KycPort {
  async call(request: IntegrationRequest): Promise<ProviderResponse> {
    const directive = readDirective(request.payload);

    if (directive?.fail === true) {
      throw new ProviderCallError('KYC_MOCK_TIMEOUT', 'Simulated KYC transport failure');
    }

    const httpStatus = typeof directive?.status === 'number' ? directive.status : 200;
    return {
      httpStatus,
      body: { mock: 'kyc', integration: request.integration },
    };
  }
}

interface MockDirective {
  status?: number;
  fail?: boolean;
}

function readDirective(payload: unknown): MockDirective | undefined {
  if (typeof payload !== 'object' || payload === null || !('__mock' in payload)) {
    return undefined;
  }
  const raw = (payload as { __mock: unknown }).__mock;
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const directive: MockDirective = {};
  if ('status' in raw && typeof (raw as { status: unknown }).status === 'number') {
    directive.status = (raw as { status: number }).status;
  }
  if ('fail' in raw && typeof (raw as { fail: unknown }).fail === 'boolean') {
    directive.fail = (raw as { fail: boolean }).fail;
  }
  return directive;
}
