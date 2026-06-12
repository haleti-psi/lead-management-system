import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CreationChannel, ERROR_CODES } from '@lms/shared';

import { IS_PUBLIC_KEY } from '../../core/auth';
import { DomainException } from '../../core/http';
import type { HttpResponseLike } from '../../core/http';
import { CaptchaMockAdapter, CaptchaService } from '../../core/integration';
import { ORG_ID_DEFAULT, SYSTEM_ACTOR_ID } from './capture.constants';
import { PublicCaptureController } from './public-capture.controller';
import type { CaptureService } from './capture.service';

/**
 * FR-010 — `POST /public/leads` controller behaviour (A-04/A-25 analogues of
 * the deferred supertest tier): the route is @Public() AND allow-listed in
 * auth-matrix.json; the captcha gate runs before any capture work; the channel
 * is forced from the query param; the actor is the reserved system user.
 */

function captchaService(verdict: boolean | 'mock'): CaptchaService {
  if (verdict === 'mock') {
    return new CaptchaService(new CaptchaMockAdapter(), {
      warn: jest.fn(),
      error: jest.fn(),
    } as never);
  }
  return new CaptchaService({ verifyToken: jest.fn().mockResolvedValue(verdict) }, {
    warn: jest.fn(),
    error: jest.fn(),
  } as never);
}

const req = { headers: { 'user-agent': 'jest' } } as never;

function makeRes(): HttpResponseLike & { status: jest.Mock } {
  return { status: jest.fn(), setHeader: jest.fn(), getHeader: jest.fn(), json: jest.fn() } as never;
}

const dto = {
  product_code: 'CV',
  identity: { name: 'Priya Sharma', mobile: '9123456789' },
  source: { source: 'Website' },
  pin_code: '560001',
} as never;

describe('PublicCaptureController metadata', () => {
  it('is @Public() (JWT bypass) — and the route is in the auth-matrix allow-list', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicCaptureController)).toBe(true);

    const matrix = JSON.parse(
      readFileSync(join(__dirname, '../../../../../docs/contracts/auth-matrix.json'), 'utf8'),
    ) as { public_endpoints: string[] };
    expect(matrix.public_endpoints).toContain('POST /api/v1/public/leads');
  });
});

describe('PublicCaptureController.publicCreateLead', () => {
  it('A-04 analogue: creates the lead as the system actor with channel forced from ?channel', async () => {
    const createLead = jest.fn().mockResolvedValue({
      replayed: false,
      data: { lead_id: 'l1', stage: 'captured', channel_created_by: 'qr' },
    });
    const controller = new PublicCaptureController(
      { createLead } as unknown as CaptureService,
      captchaService(true),
    );

    await controller.publicCreateLead(dto, 'qr', req, makeRes(), 'a-token', 'idem-1');

    expect(createLead).toHaveBeenCalledWith(dto, {
      actorId: SYSTEM_ACTOR_ID,
      orgId: ORG_ID_DEFAULT,
      actorRole: null,
      channel: CreationChannel.QR,
      idempotencyKey: 'idem-1',
      requestMeta: { userAgent: 'jest' },
      routeBranchByPin: true,
    });
  });

  it('defaults the channel to website', async () => {
    const createLead = jest.fn().mockResolvedValue({ replayed: false, data: {} });
    const controller = new PublicCaptureController(
      { createLead } as unknown as CaptureService,
      captchaService(true),
    );
    await controller.publicCreateLead(dto, 'website', req, makeRes(), 'a-token', undefined);
    expect(createLead).toHaveBeenCalledWith(
      dto,
      expect.objectContaining({ channel: CreationChannel.WEBSITE }),
    );
  });

  it('A-25: invalid captcha → FORBIDDEN before any capture work', async () => {
    const createLead = jest.fn();
    const controller = new PublicCaptureController(
      { createLead } as unknown as CaptureService,
      captchaService(false),
    );

    await expect(
      controller.publicCreateLead(dto, 'website', req, makeRes(), 'bad-token', undefined),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
    expect(createLead).not.toHaveBeenCalled();
  });

  it('missing captcha token → FORBIDDEN (mock adapter path)', async () => {
    const createLead = jest.fn();
    const controller = new PublicCaptureController(
      { createLead } as unknown as CaptureService,
      captchaService('mock'),
    );
    await expect(
      controller.publicCreateLead(dto, 'website', req, makeRes(), undefined, undefined),
    ).rejects.toBeInstanceOf(DomainException);
    expect(createLead).not.toHaveBeenCalled();
  });

  it('replays with HTTP 200 on a repeated Idempotency-Key', async () => {
    const createLead = jest.fn().mockResolvedValue({ replayed: true, data: { lead_id: 'l1' } });
    const controller = new PublicCaptureController(
      { createLead } as unknown as CaptureService,
      captchaService(true),
    );
    const res = makeRes();
    await controller.publicCreateLead(dto, 'website', req, res, 'a-token', 'idem-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
