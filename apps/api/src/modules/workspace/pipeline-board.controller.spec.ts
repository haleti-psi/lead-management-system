import 'reflect-metadata';

import { Reflector } from '@nestjs/core';

import { Capability } from '@lms/shared';

import { IS_PUBLIC_KEY, REQUIRES_KEY, type RequiresMetadata } from '../../core/auth';
import { PipelineBoardController } from './pipeline-board.controller';

/**
 * FR-052 — controller metadata tests (T08 analogue: no @Public; T11 analogue:
 * HEAD has no move_stage capability; capability correctly declared).
 *
 * These mirror the FR-050 workspace.controllers.spec.ts pattern — the deferred
 * supertest tier exercises the full request pipeline.
 */
describe('PipelineBoardController ABAC metadata', () => {
  const reflector = new Reflector();
  const metaFor = (handler: unknown, controller: unknown): RequiresMetadata | undefined =>
    reflector.getAllAndOverride<RequiresMetadata | undefined>(REQUIRES_KEY, [
      handler as Parameters<typeof reflector.getAllAndOverride>[1][number],
      controller as Parameters<typeof reflector.getAllAndOverride>[1][number],
    ]);

  it('PATCH /leads/:id/stage requires MOVE_STAGE capability', () => {
    const meta = metaFor(
      PipelineBoardController.prototype.transitionStage,
      PipelineBoardController,
    );
    expect(meta?.capability).toBe(Capability.MOVE_STAGE);
  });

  it('PATCH /leads/:id/stage has an explicit leads resource resolver', () => {
    const meta = metaFor(
      PipelineBoardController.prototype.transitionStage,
      PipelineBoardController,
    );
    expect(meta?.scopeResolver).toBeDefined();
    expect(meta!.scopeResolver!({} as never)).toEqual({ resourceType: 'leads' });
  });

  it('T08 analogue: no board/PATCH handler opts out of the global JwtAuthGuard', () => {
    for (const target of [
      PipelineBoardController,
      PipelineBoardController.prototype.transitionStage,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, target)).toBeUndefined();
    }
  });
});
