import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES, type LeadStage, type ScopePredicate } from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { DomainException } from '../../core/http';
import { UnitOfWork } from '../../core/db';
import { LeadService } from '../capture/lead.service';
import { StageGuardService, type StageTransitionContext } from '../capture/stage-guard.service';
import type { StageTransitionDto } from './dto/stage-transition.dto';

/** Response shape for a successful stage transition (FR-052 LLD §Endpoints). */
export interface StageTransitionResult {
  leadId: string;
  leadCode: string;
  stage: LeadStage;
  version: number;
  updatedAt: string;
}

/** Ageing in calendar days from `created_at` to now. */
export function computeAgeingDays(createdAt: Date): number {
  const ms = Date.now() - createdAt.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * FR-052 — Pipeline Board orchestrator.
 *
 * Board load: delegates to {@link LeadListRepository.list} (FR-050 reuse) with
 * `filter[stage]=<value>`. The board is a UI projection over `GET /leads`.
 *
 * Stage transition: wraps the 4-write atomic operation (leads + stage_history +
 * audit + outbox) in a single {@link UnitOfWork} transaction, delegating:
 *   - Guard evaluation → {@link StageGuardService}
 *   - All `leads` writes  → {@link LeadService.transitionStage}
 */
@Injectable()
export class PipelineBoardService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly leadService: LeadService,
    private readonly stageGuard: StageGuardService,
    @InjectPinoLogger(PipelineBoardService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Execute a stage transition for a single lead.
   *
   * Sequence (LLD §Backend Flow steps 6a–6e):
   *  6b. SELECT … FOR UPDATE (lock + load)
   *  6c. StageGuardService.evaluate → STAGE_GUARD_FAILED on any failure
   *  6d. LeadService.transitionStage (4-write atomic op)
   */
  async transitionStage(
    leadId: string,
    dto: StageTransitionDto,
    user: AuthUser,
    scopePredicate: ScopePredicate | undefined,
  ): Promise<StageTransitionResult> {
    return this.uow.run(async (tx) => {
      // 6b. Lock and load the lead (SELECT FOR UPDATE).
      const lead = await tx
        .selectFrom('leads')
        .select([
          'lead_id',
          'lead_code',
          'org_id',
          'stage',
          'version',
          'owner_id',
          'branch_id',
          'team_id',
          'kyc_status',
          'consent_status',
          'duplicate_status',
          'deleted_at',
        ])
        .where('lead_id', '=', leadId)
        .where('org_id', '=', user.orgId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();

      if (!lead) {
        throw new DomainException(ERROR_CODES.NOT_FOUND);
      }

      // Scope check on the loaded lead (LLD §Auth Check scope enforcement).
      if (!this.isInScope(lead, scopePredicate)) {
        this.logger.warn({ lead_id: leadId, predicate_type: scopePredicate?.type }, 'transitionStage: lead out of actor scope');
        throw new DomainException(ERROR_CODES.FORBIDDEN);
      }

      // 6c. Guard evaluation.
      const guardResult = await this.stageGuard.evaluate({
        fromStage: lead.stage,
        toStage: dto.to,
        lead: {
          lead_id: lead.lead_id,
          org_id: lead.org_id,
          stage: lead.stage,
          kyc_status: lead.kyc_status,
          consent_status: lead.consent_status,
          duplicate_status: lead.duplicate_status ?? undefined,
        },
        actor: user,
        reason: dto.reason ?? null,
        tx,
      });

      if (guardResult.failed.length > 0) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Stage transition blocked by one or more guards.', {
          detail: {
            reason: 'STAGE_GUARD_FAILED',
            failed_guards: guardResult.failed,
          },
        });
      }

      // 6d. Delegate all 4 writes to LeadService (sole writer of leads).
      const guardCtx: StageTransitionContext = {
        actor_id: user.userId,
        from_stage: lead.stage,
        reason: dto.reason ?? null,
      };
      const updated = await this.leadService.transitionStage(
        leadId,
        dto.to,
        guardCtx,
        dto.expected_version,
        tx,
      );

      return {
        leadId: updated.lead_id,
        leadCode: updated.lead_code,
        stage: updated.stage,
        version: updated.version,
        updatedAt: updated.updated_at.toISOString(),
      };
    });
  }

  /**
   * Scope check on the pre-loaded lead. The AbacGuard resolved the predicate
   * against the org; we enforce the row-level constraint here inside the tx so
   * we can use the locked lead row (no second DB round-trip).
   *
   * Per CORRECTIONS.md §FR-052: SM scope = `leads.owner_id IN (team member user_ids)`.
   */
  private isInScope(
    lead: { owner_id: string | null; branch_id: string | null },
    predicate: ScopePredicate | undefined,
  ): boolean {
    if (!predicate) return false;
    switch (predicate.type) {
      case 'own':
        return lead.owner_id === predicate.userId;
      case 'team':
        return predicate.userIds.length > 0
          ? predicate.userIds.includes(lead.owner_id ?? '')
          : false;
      case 'branch':
        return lead.branch_id === predicate.branchId;
      case 'region':
        return predicate.branchIds.length > 0
          ? predicate.branchIds.includes(lead.branch_id ?? '')
          : false;
      case 'all':
      case 'masked':
        return true;
      case 'partner':
        // Partner scope doesn't apply to move_stage capability.
        return false;
      case 'customer_token':
        return false;
      default:
        return false;
    }
  }
}
