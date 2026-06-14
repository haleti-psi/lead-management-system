import { Injectable } from '@nestjs/common';

import type { TelephonyPort } from '../ports/telephony.port';
import type { IntegrationRequest } from '../ports/integration-port';
import { ProviderCallError, type ProviderResponse } from '../ports/provider-response';

/**
 * Deterministic in-process TelephonyPort for dev/test (Phase 1.5 — CTI;
 * OD-08; ADR-4: build against the mock, swap real adapter last).
 * Performs NO network I/O; unit tests steer behaviour via `payload.__mock`:
 *   - `payload.__mock.fail === true` → throws ProviderCallError (simulates
 *     transport fault; gateway records status=failed/retrying).
 *   - Otherwise → returns 200 OK (disposition sync acknowledged).
 *
 * CTI idempotency key: `cti-{task_id}-{disposition}` — the gateway dedupes
 * repeated calls with the same key.
 */
@Injectable()
export class TelephonyMockAdapter implements TelephonyPort {
  async call(request: IntegrationRequest): Promise<ProviderResponse> {
    const directive = readDirective(request.payload);

    if (directive?.fail === true) {
      throw new ProviderCallError('CTI_MOCK_TIMEOUT', 'Simulated CTI transport failure');
    }

    const httpStatus = typeof directive?.status === 'number' ? directive.status : 200;
    return {
      httpStatus,
      body: { mock: 'cti', integration: request.integration, action: readAction(request.payload) },
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

function readAction(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('action' in payload)) {
    return null;
  }
  const action = (payload as { action: unknown }).action;
  return typeof action === 'string' ? action : null;
}
