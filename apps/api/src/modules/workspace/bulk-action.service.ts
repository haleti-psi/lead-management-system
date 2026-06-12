import { Injectable } from '@nestjs/common';

import { AuditAction, ERROR_CODES, type ScopePredicate } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { LEADS_RESOURCE_TYPE, TERMINAL_LEAD_STAGES } from '../capture/capture.constants';
import { LeadService } from '../capture/lead.service';
import { BULK_PREDICATE_TYPES } from './workspace.constants';
import { LeadListRepository, type WorkspaceUserRef } from './lead-list.repository';
import type { WorkspaceScopeContext } from './lead-list.service';
import type { BulkActionDto, BulkActionKind } from './dto/bulk-action.dto';

export type BulkItemStatus = 'succeeded' | 'skipped_out_of_scope' | 'skipped_ineligible';

export interface BulkActionItemResult {
  lead_id: string;
  status: BulkItemStatus;
}

/** Per-item result list + summary (LLD §Backend Flow bulk step 5). */
export interface BulkActionResult {
  action: BulkActionKind;
  requested: number;
  succeeded: number;
  items: BulkActionItemResult[];
}

/**
 * FR-050 — the bulk-action gate (`POST /leads/bulk-action`). FR-050 owns ONLY
 * the authorisation gate, the in-SQL re-scope of the selection, and ONE
 * `audit_logs` intent per bulk action; every `leads` mutation is delegated to
 * the owning `LeadService` mutator (`bulkReassign` — sole-writer §11.2, one
 * `audit_logs(reassign)` per lead, LIMIT-bounded). M6 never writes `leads`.
 */
@Injectable()
export class BulkActionService {
  constructor(
    private readonly repo: LeadListRepository,
    private readonly leads: LeadService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
  ) {}

  async execute(user: AuthUser, dto: BulkActionDto, ctx: WorkspaceScopeContext): Promise<BulkActionResult> {
    // Defence in depth after AbacGuard's bulk_action grant: writes are never
    // dispatched under own/masked/partner/customer scopes (deny-by-default).
    const predicate = ctx.predicate;
    if (!predicate || !BULK_PREDICATE_TYPES.has(predicate.type)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // Target owner must exist, be active, and sit inside the caller's scope
    // (FR-030 reassign parity — a BM cannot bulk-reassign across branches).
    const target = await this.repo.findActiveUser(user.orgId, dto.params.owner_id);
    if (!target || !targetOwnerInScope(target, predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    return this.uow.run(async (tx) => {
      // Re-scope the selection IN SQL: ids outside the caller's view_lead scope
      // are dropped before dispatch (LLD bulk step 2 — a stale client list
      // cannot act cross-scope). Terminal-stage leads are reported as
      // ineligible (bulkReassign skips them with the same predicate).
      const inScope = await this.repo.findLeadsInScope(user.orgId, predicate, dto.lead_ids, tx);
      const inScopeIds = new Set(inScope.map((l) => l.lead_id));
      const eligibleIds = inScope
        .filter((l) => !TERMINAL_LEAD_STAGES.includes(l.stage))
        .map((l) => l.lead_id);
      const eligibleSet = new Set(eligibleIds);

      const succeeded = await this.leads.bulkReassign(
        eligibleIds,
        dto.params.owner_id,
        dto.reason,
        tx,
      );

      // ONE audit intent per bulk action (LLD bulk step 4). `audit_action` has
      // no `bulk_action` value (AMBIGUITY.md) — recorded as `reassign` with
      // `detail.sub_action='bulk_action'` (A4 precedent). No PII in detail.
      await this.audit.append(
        {
          action: AuditAction.REASSIGN,
          entity_type: LEADS_RESOURCE_TYPE,
          entity_id: null,
          actor_id: user.userId,
          org_id: user.orgId,
          detail: {
            sub_action: 'bulk_action',
            bulk_action: dto.action,
            reason: dto.reason,
            new_owner_id: dto.params.owner_id,
            requested: dto.lead_ids.length,
            succeeded,
            skipped_out_of_scope: dto.lead_ids.filter((id) => !inScopeIds.has(id)),
            skipped_ineligible: inScope
              .filter((l) => !eligibleSet.has(l.lead_id))
              .map((l) => l.lead_id),
          },
        },
        tx,
      );

      const items = dto.lead_ids.map((id): BulkActionItemResult => ({
        lead_id: id,
        status: !inScopeIds.has(id)
          ? 'skipped_out_of_scope'
          : eligibleSet.has(id)
            ? 'succeeded'
            : 'skipped_ineligible',
      }));

      return { action: dto.action, requested: dto.lead_ids.length, succeeded, items };
    });
  }
}

/** Target-owner-in-scope: SM=team member, BM/KYC=same branch, HEAD=any (FR-030 parity). */
function targetOwnerInScope(target: WorkspaceUserRef, predicate: ScopePredicate): boolean {
  switch (predicate.type) {
    case 'team':
      return predicate.userIds.includes(target.user_id);
    case 'branch':
      return target.branch_id === predicate.branchId;
    case 'region':
      return target.branch_id !== null && predicate.branchIds.includes(target.branch_id);
    case 'all':
      return true;
    default:
      return false;
  }
}
