import { Injectable } from '@nestjs/common';

import { AuditAction, ERROR_CODES, GrantStatus } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { BREAK_GLASS_CAPABLE_ROLE_CODES } from './break-glass.constants';
import {
  BreakGlassRepository,
  type BreakGlassGrantRow,
} from './break-glass.repository';
import type {
  BreakGlassGrantResponse,
  BreakGlassRequestDto,
  BreakGlassTransitionResponse,
} from './break-glass.dto';

/** The acting principal, narrowed to what the service needs. */
export interface BreakGlassActor {
  readonly userId: string;
  readonly orgId: string;
}

/** Audit `detail.event` discriminator for the grant-lifecycle audit rows. */
type GrantLifecycleEvent =
  | 'grant_requested'
  | 'grant_approved'
  | 'grant_revoked'
  | 'grant_expired';

/**
 * FR-003 — break-glass grant lifecycle. Owns create (request), four-eyes
 * approve, and early revoke; the per-lead-access audit and the live
 * authorisation check are FR-002's ({@link EntitlementService} reads
 * `status='active'` grants directly, so this service only manages the rows it
 * reads — it does not touch the ABAC cache, which never caches grants).
 *
 * Four-eyes (approver ≠ grantee) is enforced in depth:
 *   1. Zod `superRefine` rejects `approverId === granteeId` at the boundary.
 *   2. This service re-checks it before any DB write (defence against a body
 *      that bypassed the pipe) and confirms the nominated approver actually
 *      holds the `break_glass` capability.
 *   3. The repository UPDATE carries `grantee_id <> approver_id` in its WHERE,
 *      and the DB `ck_break_glass_four_eyes` CHECK constraint is the final
 *      backstop.
 *
 * Every state change runs inside one {@link UnitOfWork} transaction together
 * with its audit append, so no partial state can persist on failure.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly repo: BreakGlassRepository,
    private readonly audit: AuditAppender,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * Create a time-boxed grant in `pending` status (LLD §Backend Flow). Window
   * order, max-window, four-eyes, and conditional scopeRef were already checked
   * by the request schema; here we verify the referenced entities exist and the
   * nominated approver is break-glass-capable, then insert + audit atomically.
   */
  async request(actor: BreakGlassActor, dto: BreakGlassRequestDto): Promise<BreakGlassGrantResponse> {
    const scopeRef = dto.scopeRef ?? null;

    // (5a) grantee exists in this org.
    const grantee = await this.repo.findUserRole(dto.granteeId, actor.orgId);
    if (!grantee) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, 'The nominated grantee does not exist.');
    }

    // (5b) approver exists in this org.
    const approver = await this.repo.findUserRole(dto.approverId, actor.orgId);
    if (!approver) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, 'The nominated approver does not exist.');
    }

    // (5c) four-eyes — approver must differ from grantee (defence-in-depth).
    if (dto.approverId === dto.granteeId) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Approver must be different from grantee.', {
        detail: { reason: 'FOUR_EYES_REQUIRED' },
      });
    }

    // (5d) nominated approver must hold the break_glass capability (ADMIN/DPO).
    if (!BREAK_GLASS_CAPABLE_ROLE_CODES.has(approver.role_code)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'The nominated approver cannot approve break-glass grants.', {
        detail: { reason: 'APPROVER_NOT_CAPABLE' },
      });
    }

    // (5e) scopeRef must reference a real lead/branch for scoped grants.
    await this.assertScopeRefExists(dto, actor.orgId, scopeRef);

    const grant = await this.uow.run(async (tx) => {
      const created = await this.repo.insert(
        {
          orgId: actor.orgId,
          granteeId: dto.granteeId,
          approverId: dto.approverId,
          scopeType: dto.scopeType,
          scopeRef,
          reason: dto.reason,
          validFrom: dto.validFrom,
          validUntil: dto.validUntil,
          actorId: actor.userId,
        },
        tx,
      );
      await this.appendAudit(actor, created, 'grant_requested', tx);
      return created;
    });

    return this.toGrantResponse(grant);
  }

  /**
   * Four-eyes approval (LLD §Backend Flow). Only the nominated approver may
   * approve, and never their own grant; the transition is `pending → active`.
   */
  async approve(actor: BreakGlassActor, grantId: string): Promise<BreakGlassTransitionResponse> {
    const grant = await this.repo.findById(grantId, actor.orgId);
    if (!grant) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // Only the nominated approver may approve.
    if (grant.approver_id !== actor.userId) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Only the nominated approver may approve this grant.', {
        detail: { reason: 'NOT_NOMINATED_APPROVER' },
      });
    }

    // Four-eyes — approver must not be the grantee (also guarded by DB CHECK).
    if (actor.userId === grant.grantee_id) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Approver must be different from grantee.', {
        detail: { reason: 'FOUR_EYES_REQUIRED' },
      });
    }

    // Idempotency: a grant past `pending` (already active, expired, or revoked)
    // cannot be re-approved.
    if (grant.status !== GrantStatus.PENDING) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'This grant is no longer awaiting approval.');
    }

    const updated = await this.uow.run(async (tx) => {
      const row = await this.repo.setActive(grantId, actor.orgId, actor.userId, tx);
      if (!row) {
        // Lost a race with a concurrent approve/revoke between read and write.
        throw new DomainException(ERROR_CODES.CONFLICT, 'This grant is no longer awaiting approval.');
      }
      await this.appendAudit(actor, row, 'grant_approved', tx);
      return row;
    });

    return this.toTransitionResponse(updated);
  }

  /**
   * Early revocation (LLD §Data Operations / CORRECTIONS B3). Any ADMIN/DPO with
   * the capability (already gated by the AbacGuard) may revoke a pending or
   * active grant; the transition is `pending|active → revoked` and takes effect
   * immediately because {@link EntitlementService} reads grant status live.
   */
  async revoke(actor: BreakGlassActor, grantId: string): Promise<BreakGlassTransitionResponse> {
    const grant = await this.repo.findById(grantId, actor.orgId);
    if (!grant) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    if (grant.status !== GrantStatus.PENDING && grant.status !== GrantStatus.ACTIVE) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'This grant can no longer be revoked.');
    }

    const updated = await this.uow.run(async (tx) => {
      const row = await this.repo.revoke(grantId, actor.orgId, actor.userId, tx);
      if (!row) {
        throw new DomainException(ERROR_CODES.CONFLICT, 'This grant can no longer be revoked.');
      }
      await this.appendAudit(actor, row, 'grant_revoked', tx);
      return row;
    });

    return this.toTransitionResponse(updated);
  }

  // ── helpers ──────────────────────────────────────────────────

  private async assertScopeRefExists(
    dto: BreakGlassRequestDto,
    orgId: string,
    scopeRef: string | null,
  ): Promise<void> {
    if (dto.scopeType === 'all') {
      return;
    }
    if (!scopeRef) {
      // The schema already guarantees this; defence-in-depth for direct callers.
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'scopeRef', issue: 'scopeRef is required when scopeType is lead or branch' }],
      });
    }
    const exists =
      dto.scopeType === 'lead'
        ? await this.repo.leadExists(scopeRef, orgId)
        : await this.repo.branchExists(scopeRef, orgId);
    if (!exists) {
      throw new DomainException(ERROR_CODES.NOT_FOUND, 'The scope reference does not exist.');
    }
  }

  /**
   * Append a `break_glass_access` audit row for a grant-lifecycle event. The
   * `detail` carries only the event name, scope type, and (for create) the
   * reason — never raw PII, tokens, or the grantee's identity beyond their id.
   */
  private async appendAudit(
    actor: BreakGlassActor,
    grant: BreakGlassGrantRow,
    event: GrantLifecycleEvent,
    tx?: Parameters<AuditAppender['append']>[1],
  ): Promise<void> {
    const detail: Record<string, unknown> = { event, scope_type: grant.scope_type };
    if (event === 'grant_requested') {
      detail.reason = grant.reason;
    }
    await this.audit.append(
      {
        action: AuditAction.BREAK_GLASS_ACCESS,
        entity_type: 'break_glass_grants',
        entity_id: grant.grant_id,
        actor_id: actor.userId,
        org_id: actor.orgId,
        detail,
      },
      tx,
    );
  }

  private toGrantResponse(grant: BreakGlassGrantRow): BreakGlassGrantResponse {
    return {
      grantId: grant.grant_id,
      granteeId: grant.grantee_id,
      approverId: grant.approver_id,
      scopeType: grant.scope_type,
      scopeRef: grant.scope_ref,
      reason: grant.reason,
      status: grant.status,
      validFrom: grant.valid_from.toISOString(),
      validUntil: grant.valid_until.toISOString(),
      createdAt: grant.created_at.toISOString(),
    };
  }

  private toTransitionResponse(grant: BreakGlassGrantRow): BreakGlassTransitionResponse {
    return {
      grantId: grant.grant_id,
      status: grant.status,
      approverId: grant.approver_id,
      updatedAt: grant.updated_at.toISOString(),
    };
  }
}
