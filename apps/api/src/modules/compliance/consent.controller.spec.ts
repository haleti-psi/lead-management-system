import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability, ConsentPurpose, ConsentState, ERROR_CODES } from '@lms/shared';

import {
  IS_PUBLIC_KEY,
  REQUIRES_KEY,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
  type RequiresMetadata,
} from '../../core/auth';
import { ConsentController } from './consent.controller';
import type { ConsentService } from './consent.service';
import { CustomerConsentController } from './customer-consent.controller';
import type { CustomerLinkPort, ResolvedCustomerLink } from './ports/customer-link.port';

/**
 * FR-110 — controller-tier guarantees. T13 (401 without a JWT), T20/T21
 * (expired/revoked token → 404) and T24 (10/min per-IP throttle) are
 * guard-tier behaviours owned by the global JwtAuthGuard / CustomerLinkPort
 * adapter / AppThrottlerGuard; here we assert the METADATA and wiring those
 * tiers consume — the deferred supertest wave exercises them end-to-end.
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const LEAD = 'b0000000-0000-0000-0000-00000000000b';

describe('ConsentController metadata (T13 analogue + auth contract)', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      ConsentController,
    ]);

  it('GET /leads/{id}/consents requires CONSENT_LEDGER with an explicit consent_records resolver', () => {
    const meta = metaFor(ConsentController.prototype.listConsents);
    expect(meta?.capability).toBe(Capability.CONSENT_LEDGER);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'consent_records' });
  });

  it('POST /leads/{id}/consents requires CONSENT_LEDGER with an explicit consent_records resolver', () => {
    const meta = metaFor(ConsentController.prototype.captureConsent);
    expect(meta?.capability).toBe(Capability.CONSENT_LEDGER);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'consent_records' });
  });

  it('T13 analogue: neither staff handler opts out of the global JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ConsentController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ConsentController.prototype.listConsents)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ConsentController.prototype.captureConsent)).toBeUndefined();
  });

  it('customer controller is @Public (token-guarded path) and carries NO ABAC metadata', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CustomerConsentController)).toBe(true);
    expect(
      Reflect.getMetadata(REQUIRES_KEY, CustomerConsentController.prototype.customerConsent),
    ).toBeUndefined();
  });
});

describe('ConsentController behaviour', () => {
  const user: AuthUser = {
    userId: 'rm-1',
    orgId: ORG,
    role: 'RM',
    scope: 'O',
    jti: 'jti-1',
  };

  function makeReq(): AbacRequestContext {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.9', 'user-agent': 'jest' },
    } as unknown as AbacRequestContext;
    req[SCOPE_PREDICATE_KEY] = { type: 'own', userId: 'rm-1' };
    return req;
  }

  it('POST passes the lead id, dto and the AbacGuard-resolved actor context to the service', async () => {
    const capture = jest.fn().mockResolvedValue({
      consent_id: 'c-1',
      lead_id: LEAD,
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      created_at: new Date(),
      derived_consent_status: 'partial',
    });
    const controller = new ConsentController({ capture } as unknown as ConsentService);

    const dto = {
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      notice_version: 'v1.0',
      consent_text_version: 'v1.0',
      channel: 'manual',
      actor: 'rm',
    } as never;
    const result = await controller.captureConsent(LEAD, dto, user, makeReq());

    expect(capture).toHaveBeenCalledWith(LEAD, dto, {
      userId: 'rm-1',
      orgId: ORG,
      role: 'RM',
      predicate: { type: 'own', userId: 'rm-1' },
      requestMeta: { ip: '10.0.0.9', userAgent: 'jest' },
    });
    expect(result).toMatchObject({ consent_id: 'c-1', derived_consent_status: 'partial' });
  });

  it('GET returns a PaginatedResult so the envelope hoists pagination into meta (T14 envelope analogue)', async () => {
    const listForLead = jest.fn().mockResolvedValue({
      data: [{ consent_id: 'c-1' }],
      pagination: { page: 1, limit: 25, total: 30 },
    });
    const controller = new ConsentController({ listForLead } as unknown as ConsentService);

    const result = await controller.listConsents(
      LEAD,
      { page: 1, limit: 25 },
      user,
      makeReq(),
    );

    expect(listForLead).toHaveBeenCalledWith(
      LEAD,
      { page: 1, limit: 25 },
      expect.objectContaining({ predicate: { type: 'own', userId: 'rm-1' } }),
    );
    expect(result).toEqual({
      data: [{ consent_id: 'c-1' }],
      pagination: { page: 1, limit: 25, total: 30 },
    });
  });
});

describe('CustomerConsentController behaviour (T19–T21 analogues)', () => {
  const dto = {
    purpose: ConsentPurpose.LEAD_CONTACT,
    state: ConsentState.GRANTED,
    notice_version: 'v1.0',
    consent_text_version: 'v1.0',
  } as never;
  const req = { headers: { 'x-forwarded-for': '49.32.1.7', 'user-agent': 'iPhone Safari' } } as never;

  it('T20/T21 analogue: an unresolved token (invalid/expired/revoked/OTP-incomplete) → NOT_FOUND, service untouched', async () => {
    const captureFromCustomer = jest.fn();
    const links: CustomerLinkPort = { resolveForConsent: jest.fn().mockResolvedValue(null) };
    const controller = new CustomerConsentController(
      { captureFromCustomer } as unknown as ConsentService,
      links,
    );

    await expect(controller.customerConsent('tok-expired', dto, req)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(links.resolveForConsent).toHaveBeenCalledWith('tok-expired');
    expect(captureFromCustomer).not.toHaveBeenCalled();
  });

  it('T19 analogue: a resolved link is handed to the service with the header-derived client meta', async () => {
    const link: ResolvedCustomerLink = {
      leadId: LEAD,
      customerProfileId: 'cp-9',
      orgId: ORG,
      channel: 'website',
    };
    const captureFromCustomer = jest.fn().mockResolvedValue({
      consent_id: 'c-2',
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      created_at: new Date(),
    });
    const controller = new CustomerConsentController(
      { captureFromCustomer } as unknown as ConsentService,
      { resolveForConsent: jest.fn().mockResolvedValue(link) },
    );

    const result = await controller.customerConsent('tok-1', dto, req);

    expect(captureFromCustomer).toHaveBeenCalledWith(link, dto, {
      ip: '49.32.1.7',
      userAgent: 'iPhone Safari',
    });
    expect(result).toMatchObject({ consent_id: 'c-2' });
  });
});
