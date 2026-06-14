/**
 * FR-114 controller-tier tests.
 *
 * T02 — idempotency (Idempotency-Key header on POST /grievances)
 * Metadata checks — ABAC wiring, @Public absence
 *
 * Full-HTTP+DB integration tier (T01–T24 as supertest+Testcontainers) is
 * DEFERRED to the project-wide integration-test wave (manifest stage7.test_strategy).
 * INV-5 (open→in_progress owner guard) is tested in grievance.service.spec.ts.
 */

import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability, GrievanceCategory, GrievanceSource, GrievanceStatus } from '@lms/shared';

import {
  IS_PUBLIC_KEY,
  REQUIRES_KEY,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
  type RequiresMetadata,
} from '../../core/auth';
import type { HttpResponseLike } from '../../core/http';
import { GrievanceController } from './grievance.controller';
import type { GrievanceIdempotencyService } from './grievance-idempotency.service';
import type { GrievanceData, GrievanceService } from './grievance.service';

// ───────────────────────────────────────────────────── fixtures ──

const ORG = '00000000-0000-0000-0000-000000000001';
const RM_ID = 'a0000000-0000-0000-0000-0000000000a1';
const GRIEVANCE_ID = 'c0000000-0000-0000-0000-000000000001';

const GRIEVANCE_DATA: GrievanceData = {
  grievanceId: GRIEVANCE_ID,
  grievanceNo: 'GRV-2026-000001',
  leadId: null,
  source: GrievanceSource.RM,
  category: GrievanceCategory.SERVICE_DELAY,
  description: 'Customer was not contacted within the promised timeframe.',
  ownerId: null,
  slaDueAt: null,
  status: GrievanceStatus.OPEN,
  response: null,
  closureProofRef: null,
  createdAt: new Date('2026-06-14T09:00:00Z'),
  updatedAt: new Date('2026-06-14T09:00:00Z'),
  createdBy: RM_ID,
};

const USER: AuthUser = {
  userId: RM_ID,
  orgId: ORG,
  role: 'RM',
  scope: 'O',
  jti: 'jti-1',
};

const CREATE_DTO = {
  source: GrievanceSource.RM,
  category: GrievanceCategory.SERVICE_DELAY,
  description: 'Customer was not contacted within the promised timeframe.',
  leadId: null,
  ownerId: null,
};

function makeReq(): AbacRequestContext {
  const req = { headers: {} } as unknown as AbacRequestContext;
  req[SCOPE_PREDICATE_KEY] = { type: 'own', userId: RM_ID };
  return req;
}

function makeRes(): HttpResponseLike {
  return { status: jest.fn().mockReturnThis() } as unknown as HttpResponseLike;
}

function makeController(
  serviceOverrides: Partial<jest.Mocked<GrievanceService>> = {},
  idempotencyOverrides: Partial<jest.Mocked<GrievanceIdempotencyService>> = {},
): {
  controller: GrievanceController;
  service: jest.Mocked<GrievanceService>;
  idempotency: jest.Mocked<GrievanceIdempotencyService>;
} {
  const service = {
    create: jest.fn().mockResolvedValue(GRIEVANCE_DATA),
    update: jest.fn().mockResolvedValue(GRIEVANCE_DATA),
    list: jest.fn().mockResolvedValue({
      data: [GRIEVANCE_DATA],
      pagination: { page: 1, limit: 25, total: 1 },
    }),
    ...serviceOverrides,
  } as unknown as jest.Mocked<GrievanceService>;

  const idempotency = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    ...idempotencyOverrides,
  } as unknown as jest.Mocked<GrievanceIdempotencyService>;

  const controller = new GrievanceController(service, idempotency);
  return { controller, service, idempotency };
}

// ─────────────────────────────────────────────── Metadata / ABAC ──

describe('GrievanceController metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      GrievanceController,
    ]);

  it('POST /grievances requires CONSENT_LEDGER with a grievances resolver', () => {
    const meta = metaFor(GrievanceController.prototype.createGrievance);
    expect(meta?.capability).toBe(Capability.CONSENT_LEDGER);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'grievances' });
  });

  it('GET /grievances requires CONSENT_LEDGER', () => {
    const meta = metaFor(GrievanceController.prototype.listGrievances);
    expect(meta?.capability).toBe(Capability.CONSENT_LEDGER);
  });

  it('PATCH /grievances/:id requires CONSENT_LEDGER', () => {
    const meta = metaFor(GrievanceController.prototype.updateGrievance);
    expect(meta?.capability).toBe(Capability.CONSENT_LEDGER);
  });

  it('no handler opts out of the global JwtAuthGuard (@Public absent)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GrievanceController)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, GrievanceController.prototype.createGrievance),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, GrievanceController.prototype.listGrievances),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, GrievanceController.prototype.updateGrievance),
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────── T02 — Idempotency ──

describe('GrievanceController.createGrievance — idempotency (T02)', () => {
  it('T02a: no Idempotency-Key header — delegates to service normally, does not touch cache', async () => {
    const { controller, service, idempotency } = makeController();

    const result = await controller.createGrievance(
      CREATE_DTO,
      USER,
      makeReq(),
      makeRes(),
      undefined,
    );

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(idempotency.get).not.toHaveBeenCalled();
    expect(idempotency.set).not.toHaveBeenCalled();
    expect(result).toEqual(GRIEVANCE_DATA);
  });

  it('T02b: first request with Idempotency-Key (cache miss) creates grievance and caches result', async () => {
    const { controller, service, idempotency } = makeController();
    const res = makeRes();
    const idemKey = 'client-idempotency-key-abc';

    idempotency.get.mockResolvedValue(undefined); // cache miss

    const result = await controller.createGrievance(CREATE_DTO, USER, makeReq(), res, idemKey);

    expect(idempotency.get).toHaveBeenCalledWith(idemKey);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(idempotency.set).toHaveBeenCalledWith(idemKey, GRIEVANCE_DATA);
    expect(result).toEqual(GRIEVANCE_DATA);
    // No status override on first write (201 from @HttpCode)
    expect(res.status).not.toHaveBeenCalled();
  });

  it('T02c: replay with same Idempotency-Key (cache hit) returns cached result with HTTP 200, service NOT called', async () => {
    const { controller, service, idempotency } = makeController();
    const res = makeRes();
    const idemKey = 'client-idempotency-key-abc';

    // Simulate cached replay
    idempotency.get.mockResolvedValue(GRIEVANCE_DATA);

    const result = await controller.createGrievance(CREATE_DTO, USER, makeReq(), res, idemKey);

    expect(idempotency.get).toHaveBeenCalledWith(idemKey);
    // Service must NOT be called on replay (IDEMPOTENT_REPLAY)
    expect(service.create).not.toHaveBeenCalled();
    // Must NOT re-cache the already-cached value
    expect(idempotency.set).not.toHaveBeenCalled();
    // Status downgraded to 200 for replay
    expect(res.status).toHaveBeenCalledWith(200);
    expect(result).toEqual(GRIEVANCE_DATA);
  });

  it('T02d: two distinct Idempotency-Keys create two separate grievances', async () => {
    const GRIEVANCE_DATA_2: GrievanceData = {
      ...GRIEVANCE_DATA,
      grievanceId: 'c0000000-0000-0000-0000-000000000002',
      grievanceNo: 'GRV-2026-000002',
    };
    const { controller, service, idempotency } = makeController();

    idempotency.get.mockResolvedValue(undefined); // both cache misses
    service.create.mockResolvedValueOnce(GRIEVANCE_DATA).mockResolvedValueOnce(GRIEVANCE_DATA_2);

    await controller.createGrievance(CREATE_DTO, USER, makeReq(), makeRes(), 'key-A');
    await controller.createGrievance(CREATE_DTO, USER, makeReq(), makeRes(), 'key-B');

    expect(service.create).toHaveBeenCalledTimes(2);
    expect(idempotency.set).toHaveBeenCalledWith('key-A', GRIEVANCE_DATA);
    expect(idempotency.set).toHaveBeenCalledWith('key-B', GRIEVANCE_DATA_2);
  });
});
