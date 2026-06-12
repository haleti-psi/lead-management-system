import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import {
  AttributionStatus,
  DupAction,
  DupRecordStatus,
  DupStatus,
  ERROR_CODES,
  UserStatus,
} from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { AppConfigService } from '../../core/config';
import { KYSELY, UnitOfWork, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { LeadService, type MergeMasterFieldUpdates } from '../capture/lead.service';
import { MERGE_ROLES } from './dedupe.constants';
import { DedupeRepository } from './dedupe.repository';
import { leadInScope, type DedupeScopeContext } from './dedupe.service';
import type { MergeLeadDto, MergeLeadResponseDto } from './dto/merge-lead.dto';
import type { UnmergeLeadDto, UnmergeLeadResponseDto } from './dto/unmerge-lead.dto';
import { MergeLeadRepository, type MergeLeadRow } from './merge-lead.repository';

/**
 * Shape of the merge bookkeeping persisted in `audit_logs.detail` at merge
 * time and read back at unmerge (AMBIGUITIES E3). `relinked_ids` carries the
 * exact child ids re-parented (T-026: unmerge must restore ONLY those);
 * `duplicate_match_snapshots` carries the pair rows' pre-merge state so the
 * unmerge restore is lossless (an open row left with `action='merged'` would
 * poison FR-020's `recomputeDuplicateStatus`).
 */
const MergeAuditDetail = z.object({
  unmerge_allowed_until: z.string().datetime({ offset: true }),
  relinked_ids: z.object({
    documents: z.array(z.string().uuid()).default([]),
    consents: z.array(z.string().uuid()).default([]),
    tasks: z.array(z.string().uuid()).default([]),
  }),
  duplicate_match_snapshots: z
    .array(
      z.object({
        duplicate_match_id: z.string().uuid(),
        action: z.nativeEnum(DupAction),
        status: z.nativeEnum(DupRecordStatus),
        action_by: z.string().uuid().nullable(),
        action_reason: z.string().nullable(),
      }),
    )
    .default([]),
});

/**
 * FR-021 — `MergeLeadService` (M3 owns the merge/unmerge flow). Orchestrates
 * the authorised merge of a duplicate lead into a master without losing any
 * history: the duplicate is soft-archived (`duplicate_status='merged'`,
 * `master_lead_id` set — via `LeadService.merge`, the sole `leads` writer),
 * its child records (source attribution status, documents, consents FK-only
 * per A6, tasks) are re-linked to the master, the `duplicate_matches` pair is
 * resolved (`merged`), and the master's derived `duplicate_status` is
 * recomputed (FR-020's mutator) — ALL inside one `UnitOfWork` transaction with
 * audit + outbox (BRD §5.6.4; architecture §11). Unmerge reverses the
 * operation within `MERGE_UNMERGE_WINDOW_HOURS`, restoring exactly the
 * `relinked_ids` recorded in the merge audit entry.
 */
@Injectable()
export class MergeLeadService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly repo: MergeLeadRepository,
    private readonly matches: DedupeRepository,
    private readonly leads: LeadService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(MergeLeadService.name) private readonly logger: PinoLogger,
  ) {}

  // ───────────────────────────────── POST /leads/{id}/merge ────────────────

  /** LLD §Backend Flow (Merge) steps 6–14. `{id}` is the DUPLICATE lead. */
  async merge(
    duplicateId: string,
    dto: MergeLeadDto,
    user: AuthUser,
    scope: DedupeScopeContext,
  ): Promise<MergeLeadResponseDto> {
    if (dto.master_lead_id === duplicateId) {
      // DTO-tier rule that needs the path param (LLD §Validation Logic).
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'master_lead_id', issue: 'master_lead_id must differ from the duplicate lead' }],
      });
    }
    if (!MERGE_ROLES.includes(user.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN); // T-006: RM/KYC/… cannot merge
    }

    const duplicate = await this.repo.findLeadForMerge(duplicateId, user.orgId, this.db);
    if (!duplicate) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    const master = await this.repo.findLeadForMerge(dto.master_lead_id, user.orgId, this.db);
    if (!master) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (duplicate.duplicate_status === DupStatus.MERGED) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'Lead is already merged.');
    }
    if (master.duplicate_status === DupStatus.MERGED) {
      // Chained merge blocked (LLD §State Machine invalid transitions; T-010).
      throw new DomainException(ERROR_CODES.CONFLICT, 'The master lead is itself merged — chained merges are blocked.');
    }
    // The actor needs edit_lead scope over BOTH leads (LLD §Auth Check; a BM
    // cannot merge into another branch's master — T-007).
    if (!leadInScope(duplicate, scope.predicate) || !leadInScope(master, scope.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    if (await this.repo.hasChildMergedLeads(duplicateId, user.orgId, this.db)) {
      // Merging a lead other leads point at as master would break INV-008.
      throw new DomainException(ERROR_CODES.CONFLICT, 'Lead is the master of previously merged leads and cannot be merged.');
    }

    const masterUpdates = await this.resolveFieldPrecedence(dto, duplicate, master, user.orgId);

    const mergedAt = new Date();
    const windowHours = this.config.get('MERGE_UNMERGE_WINDOW_HOURS');
    const unmergeAllowedUntil = new Date(mergedAt.getTime() + windowHours * 3_600_000);

    const outcome = await this.uow.run(async (tx) => {
      // Children first (LLD steps 3–7); the two `leads` writes + audit + outbox
      // land via LeadService.merge with the relinked ids already known (E3) —
      // any failure anywhere rolls the whole unit of work back (T-013).
      const attributionsRelinked = await this.repo.setAttributionStatus(
        duplicate.source_attribution_id,
        AttributionStatus.MERGED_INTO,
        user.orgId,
        user.userId,
        tx,
      );
      const documentIds = await this.repo.reparentDocuments(duplicateId, master.lead_id, user.orgId, user.userId, tx);
      const consentIds = await this.repo.reparentConsents(duplicateId, master.lead_id, user.orgId, tx);
      const taskIds = await this.repo.reparentTasks(duplicateId, master.lead_id, user.orgId, user.userId, tx);

      const snapshots = await this.matches.findPairMatches(duplicateId, master.lead_id, user.orgId, tx);
      const resolvedCount = await this.matches.resolvePairAsMerged(
        duplicateId,
        master.lead_id,
        user.orgId,
        user.userId,
        dto.reason,
        tx,
      );

      const versions = await this.leads.merge(
        master.lead_id,
        duplicateId,
        dto.reason,
        {
          org_id: user.orgId,
          actor_id: user.userId,
          expected_duplicate_version: dto.expected_version,
          expected_master_version: master.version,
          master_updates: masterUpdates,
          audit_detail: {
            field_precedence: dto.field_precedence,
            attribution_records_relinked: attributionsRelinked,
            documents_relinked: documentIds.length,
            consent_records_relinked: consentIds.length,
            tasks_relinked: taskIds.length,
            duplicate_match_resolved: resolvedCount > 0,
            relinked_ids: { documents: documentIds, consents: consentIds, tasks: taskIds },
            duplicate_match_snapshots: snapshots,
            unmerge_allowed_until: unmergeAllowedUntil.toISOString(),
          },
        },
        tx,
      );

      // FR-020's derived-status recompute for the MASTER (its open-match
      // picture just changed). The duplicate's `merged` status was set by
      // LeadService.merge and is never recomputed here — recompute reads open
      // rows only and would clobber it.
      await this.leads.recomputeDuplicateStatus(
        master.lead_id,
        user.orgId,
        user.userId,
        versions.master_version,
        tx,
      );

      return { attributionsRelinked, documentIds, consentIds, taskIds, resolvedCount };
    });

    this.logger.info(
      {
        lead_id: duplicateId,
        master_lead_id: master.lead_id,
        documents_relinked: outcome.documentIds.length,
        consent_records_relinked: outcome.consentIds.length,
        tasks_relinked: outcome.taskIds.length,
        metric: 'dedupe.merge_completed',
      },
      'Duplicate lead merged into master',
    );

    return {
      master_lead_id: master.lead_id,
      duplicate_lead_id: duplicateId,
      merge_completed_at: mergedAt.toISOString(),
      attribution_records_relinked: outcome.attributionsRelinked,
      documents_relinked: outcome.documentIds.length,
      consent_records_relinked: outcome.consentIds.length,
      tasks_relinked: outcome.taskIds.length,
      duplicate_match_resolved: outcome.resolvedCount > 0,
      unmerge_allowed_until: unmergeAllowedUntil.toISOString(),
    };
  }

  // ──────────────────────────────── POST /leads/{id}/unmerge ───────────────

  /** LLD §Backend Flow (Unmerge) steps 6–12. `{id}` is the merged (duplicate) lead. */
  async unmerge(
    duplicateId: string,
    dto: UnmergeLeadDto,
    user: AuthUser,
    scope: DedupeScopeContext,
  ): Promise<UnmergeLeadResponseDto> {
    if (!MERGE_ROLES.includes(user.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    const lead = await this.repo.findLeadForMerge(duplicateId, user.orgId, this.db);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    // LLD §Auth: scope is checked on the unmerging lead.
    if (!leadInScope(lead, scope.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    if (lead.duplicate_status !== DupStatus.MERGED || lead.master_lead_id === null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Lead is not in merged state');
    }
    const masterId = lead.master_lead_id;

    const auditRow = await this.repo.findLatestMergeAudit(masterId, duplicateId, user.orgId, this.db);
    if (!auditRow) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'No merge record found for this lead.');
    }
    const parsed = MergeAuditDetail.safeParse(auditRow.detail);
    if (!parsed.success) {
      // A merge always writes this detail (E3); an unreadable record is a data
      // fault, not a user error — fail loudly, restore nothing.
      this.logger.error(
        { audit_id: auditRow.audit_id, lead_id: duplicateId, err: parsed.error },
        'Merge audit detail is unreadable; unmerge blocked',
      );
      throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
    }
    const detail = parsed.data;

    if (Date.now() > new Date(detail.unmerge_allowed_until).getTime()) {
      throw new DomainException(ERROR_CODES.FORBIDDEN, 'Unmerge window has expired.'); // T-024
    }

    const unmergedAt = new Date();
    const outcome = await this.uow.run(async (tx) => {
      const attributionsRestored = await this.repo.setAttributionStatus(
        lead.source_attribution_id,
        AttributionStatus.ORIGINAL,
        user.orgId,
        user.userId,
        tx,
      );
      // Restore ONLY the ids re-parented at merge time (T-026) — children the
      // master gained after the merge stay with the master.
      const documentsRestored = await this.repo.restoreDocuments(
        detail.relinked_ids.documents,
        masterId,
        duplicateId,
        user.orgId,
        user.userId,
        tx,
      );
      const consentsRestored = await this.repo.restoreConsents(
        detail.relinked_ids.consents,
        masterId,
        duplicateId,
        user.orgId,
        tx,
      );
      const tasksRestored = await this.repo.restoreTasks(
        detail.relinked_ids.tasks,
        masterId,
        duplicateId,
        user.orgId,
        user.userId,
        tx,
      );
      const matchesReopened = await this.matches.reopenMatches(
        detail.duplicate_match_snapshots,
        user.orgId,
        user.userId,
        tx,
      );

      await this.leads.unmerge(
        duplicateId,
        masterId,
        dto.reason,
        {
          org_id: user.orgId,
          actor_id: user.userId,
          expected_master_version: dto.expected_master_version,
          audit_detail: {
            attribution_records_restored: attributionsRestored,
            documents_restored: documentsRestored,
            consent_records_restored: consentsRestored,
            tasks_restored: tasksRestored,
            duplicate_matches_reopened: matchesReopened,
            merge_audit_id: auditRow.audit_id,
          },
        },
        tx,
      );

      return { attributionsRestored, documentsRestored, consentsRestored, tasksRestored };
    });

    this.logger.info(
      {
        lead_id: duplicateId,
        master_lead_id: masterId,
        documents_restored: outcome.documentsRestored,
        consent_records_restored: outcome.consentsRestored,
        tasks_restored: outcome.tasksRestored,
        metric: 'dedupe.unmerge_completed',
      },
      'Merged lead restored (unmerge)',
    );

    return {
      unmerged_lead_id: duplicateId,
      master_lead_id: masterId,
      unmerge_completed_at: unmergedAt.toISOString(),
      attribution_records_restored: outcome.attributionsRestored,
      documents_restored: outcome.documentsRestored,
      consent_records_restored: outcome.consentsRestored,
      tasks_restored: outcome.tasksRestored,
    };
  }

  // ───────────────────────────────────────────────────────────── internals ──

  /**
   * LLD step 10 — resolve which master-row values win. `branch_id` only ever
   * moves via an explicit manual override: on a cross-branch merge the
   * master's branch takes precedence (LLD §Auth Check; T-020).
   *
   *  - `master`    → no field changes (the master wins everywhere; T-018);
   *  - `duplicate` → the master adopts the duplicate's non-null business
   *                  values — the spec-evidenced contested set `owner_id` +
   *                  `priority` (T-019);
   *  - `manual`    → `owner_id` (required; must reference an active user in
   *                  the merged record's branch) and optionally `branch_id`.
   */
  private async resolveFieldPrecedence(
    dto: MergeLeadDto,
    duplicate: MergeLeadRow,
    master: MergeLeadRow,
    orgId: string,
  ): Promise<MergeMasterFieldUpdates> {
    if (dto.field_precedence === 'master') {
      return {};
    }
    if (dto.field_precedence === 'duplicate') {
      const updates: MergeMasterFieldUpdates = { priority: duplicate.priority };
      if (duplicate.owner_id !== null) {
        updates.owner_id = duplicate.owner_id;
      }
      return updates;
    }

    // manual — owner_id presence is DTO-guaranteed (T-005); re-narrow for TS.
    const ownerId = dto.manual_overrides?.owner_id;
    if (ownerId == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'manual_overrides.owner_id', issue: 'owner_id must be a valid UUID when field_precedence is manual' }],
      });
    }
    const branchOverride = dto.manual_overrides?.branch_id ?? undefined;
    const mergedBranchId = branchOverride ?? master.branch_id;
    const owner = await this.repo.findOverrideOwner(ownerId, orgId, this.db);
    if (
      !owner ||
      owner.status !== UserStatus.ACTIVE ||
      (mergedBranchId !== null && owner.branch_id !== mergedBranchId)
    ) {
      // LLD §Service-layer validations: owner must be valid for the master's scope.
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          { field: 'manual_overrides.owner_id', issue: "owner_id must reference an active user in the merged record's branch" },
        ],
      });
    }
    const updates: MergeMasterFieldUpdates = { owner_id: ownerId };
    if (branchOverride !== undefined && branchOverride !== null) {
      updates.branch_id = branchOverride;
    }
    return updates;
  }
}
