import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability, CreationChannel } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import type { AuthUser } from '../../core/auth';
import type { HttpResponseLike } from '../../core/http';
import { CaptureController } from './capture.controller';
import type { CaptureService } from './capture.service';
import type { ImportDispatchPort } from './ports/import-dispatch.port';

/**
 * FR-010 — controller-level guarantees for the authenticated endpoints
 * (A-21..A-26 are guard-tier behaviours enforced by the global JwtAuthGuard +
 * AbacGuard; here we assert the METADATA those guards read, which is what the
 * deferred supertest tier would exercise end-to-end):
 *  - POST /leads requires `create_lead` with an EXPLICIT leads scope resolver;
 *  - POST /leads/import requires `bulk_action` (RM lacks it → 403, A-26);
 *  - neither handler is @Public();
 *  - idempotent replays downgrade 201 → 200 and skip the import dispatch.
 */
describe('CaptureController metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      CaptureController,
    ]);

  it('POST /leads requires CREATE_LEAD with an explicit leads resource resolver', () => {
    const meta = metaFor(CaptureController.prototype.createLead);
    expect(meta?.capability).toBe(Capability.CREATE_LEAD);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('POST /leads/import requires BULK_ACTION with an explicit leads resource resolver', () => {
    const meta = metaFor(CaptureController.prototype.importLeads);
    expect(meta?.capability).toBe(Capability.BULK_ACTION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('A-21 analogue: neither authenticated handler opts out of the global JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CaptureController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CaptureController.prototype.createLead)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CaptureController.prototype.importLeads)).toBeUndefined();
  });
});

describe('CaptureController behaviour', () => {
  const user: AuthUser = {
    userId: 'rm-1',
    orgId: '00000000-0000-0000-0000-000000000001',
    role: 'RM',
    scope: 'O',
    jti: 'jti-1',
  };
  const req = { headers: { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'jest' } } as never;

  function makeRes(): HttpResponseLike & { status: jest.Mock } {
    return {
      status: jest.fn(),
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      json: jest.fn(),
    } as never;
  }

  it('passes the caller context (actor, role, manual channel, idempotency key) to the service', async () => {
    const createLead = jest.fn().mockResolvedValue({ replayed: false, data: { lead_id: 'l1' } });
    const controller = new CaptureController(
      { createLead } as unknown as CaptureService,
      { enqueue: jest.fn() } as unknown as ImportDispatchPort,
    );
    const res = makeRes();

    const dto = {
      product_code: 'CV',
      identity: { name: 'X', mobile: '9876543210' },
      source: { source: 'Branch' },
    } as never;
    await controller.createLead(dto, user, req, res, 'idem-1');

    expect(createLead).toHaveBeenCalledWith(dto, {
      actorId: 'rm-1',
      orgId: user.orgId,
      actorRole: 'RM',
      channel: CreationChannel.MANUAL,
      idempotencyKey: 'idem-1',
      requestMeta: { ip: '10.0.0.9', userAgent: 'jest' },
    });
    // Fresh create → the @HttpCode(201) stands; no status override.
    expect(res.status).not.toHaveBeenCalled();
  });

  it('I-01 analogue: a replayed Idempotency-Key returns HTTP 200 with the original data', async () => {
    const original = { lead_id: 'l1', lead_code: 'LD-2026-000123' };
    const createLead = jest.fn().mockResolvedValue({ replayed: true, data: original });
    const controller = new CaptureController(
      { createLead } as unknown as CaptureService,
      { enqueue: jest.fn() } as unknown as ImportDispatchPort,
    );
    const res = makeRes();

    const result = await controller.createLead({} as never, user, req, res, 'idem-1');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(result).toBe(original);
  });

  it('dispatches the import processor only for a newly accepted job (not on replay)', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const acceptBulkImport = jest
      .fn()
      .mockResolvedValueOnce({
        replayed: false,
        job: { import_job_id: 'job-1', status: 'queued', total_rows: null },
      })
      .mockResolvedValueOnce({
        replayed: true,
        job: { import_job_id: 'job-1', status: 'queued', total_rows: null },
      });
    const controller = new CaptureController(
      { acceptBulkImport } as unknown as CaptureService,
      { enqueue } as unknown as ImportDispatchPort,
    );

    const res1 = makeRes();
    await controller.importLeads(user, res1, { size: 1, buffer: Buffer.from('a') }, 'k1');
    expect(enqueue).toHaveBeenCalledWith('job-1');
    expect(res1.status).not.toHaveBeenCalled();

    const res2 = makeRes();
    await controller.importLeads(user, res2, { size: 1, buffer: Buffer.from('a') }, 'k1');
    expect(enqueue).toHaveBeenCalledTimes(1); // B-04: no re-dispatch on replay
    expect(res2.status).toHaveBeenCalledWith(200);
  });
});
