import { Injectable } from '@nestjs/common';

import type { LosPort } from '../ports/los.port';
import type { IntegrationRequest } from '../ports/integration-port';
import { ProviderCallError, type ProviderResponse } from '../ports/provider-response';

/**
 * Deterministic in-process {@link LosPort} for dev/test (integration-map.md §LOS;
 * ADR-4: build against the mock, swap the real adapter last). It performs NO
 * network I/O, so unit and component tests never reach a real LOS.
 *
 * Behaviour is data-driven by the request payload so tests can steer outcomes
 * without spies:
 *   - `payload.__mock.status` (number) → returned as `httpStatus`.
 *   - `payload.__mock.fail === true` → simulates a transport fault by throwing
 *     (handled by the gateway exactly like a 5xx).
 * Otherwise it returns `201` with an echo body. The real adapter (HTTP) is wired
 * only in production by the module provider.
 */
@Injectable()
export class LosMockAdapter implements LosPort {
  async call(request: IntegrationRequest): Promise<ProviderResponse> {
    const directive = readDirective(request.payload);

    if (directive?.fail === true) {
      // Surface as a transport-style fault; the gateway records http_status=null.
      throw new ProviderCallError('LOS_MOCK_TIMEOUT', 'Simulated LOS transport failure');
    }

    const httpStatus = typeof directive?.status === 'number' ? directive.status : 201;
    return {
      httpStatus,
      body: { mock: 'los', integration: request.integration, echo: request.maskedRequestRef ?? null },
    };
  }
}

interface MockDirective {
  status?: number;
  fail?: boolean;
}

/** Extract the optional `__mock` steering directive without trusting its shape. */
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
