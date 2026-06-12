import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { LeadListController } from './lead-list.controller';
import { SavedViewController } from './saved-view.controller';

/**
 * FR-050 — controller metadata the guards read (the deferred supertest tier
 * would exercise these end-to-end): every endpoint carries `@Requires` with
 * the LLD capability and an EXPLICIT resource resolver (the FR-104 review
 * catch — never the implicit default), and none opts out of the global
 * JwtAuthGuard (TC-06 is guard-tier behaviour).
 */
describe('Workspace controllers ABAC metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown, controller: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      controller as Parameters<typeof reflector.getAllAndOverride>[1][number],
    ]);

  it('GET /leads requires VIEW_LEAD with an explicit leads resource resolver', () => {
    const meta = metaFor(LeadListController.prototype.listLeads, LeadListController);
    expect(meta?.capability).toBe(Capability.VIEW_LEAD);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('POST /leads/bulk-action requires BULK_ACTION (RM lacks it → 403, TC-21)', () => {
    const meta = metaFor(LeadListController.prototype.bulkAction, LeadListController);
    expect(meta?.capability).toBe(Capability.BULK_ACTION);
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('GET /saved-views requires VIEW_LEAD on the saved_views resource', () => {
    const meta = metaFor(SavedViewController.prototype.listSavedViews, SavedViewController);
    expect(meta?.capability).toBe(Capability.VIEW_LEAD);
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'saved_views' });
  });

  it('POST /saved-views requires VIEW_LEAD on the saved_views resource', () => {
    const meta = metaFor(SavedViewController.prototype.createSavedView, SavedViewController);
    expect(meta?.capability).toBe(Capability.VIEW_LEAD);
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'saved_views' });
  });

  it('TC-06 analogue: no workspace handler opts out of the global JwtAuthGuard', () => {
    for (const target of [
      LeadListController,
      LeadListController.prototype.listLeads,
      LeadListController.prototype.bulkAction,
      SavedViewController,
      SavedViewController.prototype.listSavedViews,
      SavedViewController.prototype.createSavedView,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, target)).toBeUndefined();
    }
  });
});
