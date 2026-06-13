import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { Lead360Controller } from './lead360.controller';

/**
 * FR-051 — controller metadata the guards read (TC-051-04's 401 and the scope
 * grant are guard-tier behaviour, exercised end-to-end by the deferred
 * supertest tier): `GET /leads/:id` carries `@Requires('view_lead')` with an
 * EXPLICIT leads resource resolver (the FR-104 review catch — never the
 * implicit default) and never opts out of the global JwtAuthGuard.
 */
describe('Lead360Controller ABAC metadata', () => {
  const reflector = new Reflector();

  it('GET /leads/:id requires VIEW_LEAD with an explicit leads resource resolver', () => {
    const meta = reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      Lead360Controller.prototype.getLead as Parameters<typeof reflector.getAllAndOverride>[1][number],
      Lead360Controller as Parameters<typeof reflector.getAllAndOverride>[1][number],
    ]);
    expect(meta?.capability).toBe(Capability.VIEW_LEAD);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('TC-051-04 analogue: the handler never opts out of the global JwtAuthGuard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Lead360Controller)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Lead360Controller.prototype.getLead)).toBeUndefined();
  });
});
