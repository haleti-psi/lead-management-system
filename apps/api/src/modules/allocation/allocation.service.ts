import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AllocationMethod,
  AuditAction,
  DataScope,
  ERROR_CODES,
  LeadStage,
  SlaTarget,
  type PaginationMeta,
  type ScopePredicate,
} from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import { KYSELY, UnitOfWork, type DbTransaction, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { SlaEngine } from '../../core/sla';
import { LeadService, type AssignOwnerResult } from '../capture/lead.service';
import type {
  AllocationOutcome,
  AllocationPort,
  AllocationTriggerInput,
} from '../capture/ports/allocation.port';
import { NO_RULE_MATCH_REASON, UNASSIGNED_POOL_REASON } from './allocation.constants';
import {
  AllocationRuleRepository,
  type AllocationRuleRow,
  type CandidateRm,
  type LeadAllocationContext,
  type ReassignTargetUser,
  isUniqueViolation,
} from './allocation-rule.repository';
import type { CreateAllocationRuleDto } from './dto/create-allocation-rule.dto';
import type { ReassignLeadDto } from './dto/reassign-lead.dto';

/** ABAC grant context the controller forwards (set by AbacGuard on the request). */
export interface AllocationScopeContext {
  effectiveScope?: DataScope;
  predicate?: ScopePredicate;
}

/** Wire view of an `allocation_rules` row (LLD §Endpoints 2/3 response fields). */
export interface AllocationRuleView {
  allocation_rule_id: string;
  name: string;
  priority_order: number;
  method: AllocationMethod;
  criteria: unknown;
  target: unknown;
  capacity_limit: number | null;
  is_active: boolean;
}

export interface ListRulesResult {
  data: AllocationRuleView[];
  pagination: PaginationMeta;
}

/**
 * FR-030 — `AllocationService` (M4, shared-utilities.md pinned domain service):
 * rule-ordered, capacity-aware lead allocation plus the manual-reassign
 * orchestration. All `leads` writes go through `LeadService.assignOwner` (sole
 * writer, §11.2); this service owns rule evaluation, pool resolution, method
 * logic, capacity checks and the no-match fallback. It binds capture's
 * {@link AllocationPort} so lead creation triggers allocation inside the
 * creating UnitOfWork transaction (LLD Path A step 1).
 */
@Injectable()
export class AllocationService implements AllocationPort {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly leads: LeadService,
    private readonly rules: AllocationRuleRepository,
    private readonly sla: SlaEngine,
    @InjectPinoLogger(AllocationService.name) private readonly logger: PinoLogger,
  ) {}

  // ──────────────────────────────── Path A — automatic allocation (in-tx) ──

  async allocate(input: AllocationTriggerInput, tx: DbTransaction): Promise<AllocationOutcome> {
    const lead = await this.rules.findLeadAllocationContext(input.leadId, tx);
    if (!lead || lead.org_id !== input.orgId) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const activeRules = await this.rules.findActiveRules(lead.org_id, tx);
    for (const rule of activeRules) {
      if (!criteriaMatches(asRecord(rule.criteria), lead)) {
        continue; // criteria not satisfied — next rule (priority_order ASC)
      }
      const pool = await this.resolvePool(rule, lead, tx);
      if (pool.length === 0) {
        continue; // no eligible RM for this rule — next rule
      }
      const loads = await this.rules.activeLeadCounts(
        lead.org_id,
        pool.map((c) => c.user_id),
        tx,
      );
      const candidates =
        rule.capacity_limit !== null
          ? pool.filter((c) => (loads.get(c.user_id) ?? 0) < (rule.capacity_limit as number))
          : pool;
      if (candidates.length === 0) {
        continue; // all at capacity — fall through to the next rule (LLD step 5, T02)
      }

      const winner = pickCandidate(candidates, loads);
      const teamId = winner.team_id ?? winner.managed_team_id ?? null;
      const reason = `rule:${rule.name}`;
      const slaDueAt = await this.computeFirstContactDue(lead);

      const result = await this.leads.assignOwner(
        input.leadId,
        {
          ownerId: winner.user_id,
          teamId,
          reason,
          method: rule.method,
          actorId: input.actorId,
          expectedVersion: input.expectedVersion,
          ...(slaDueAt !== undefined ? { slaFirstContactDueAt: slaDueAt } : {}),
          auditAction: AuditAction.ALLOCATE,
          detail: { allocation_rule_id: rule.allocation_rule_id },
        },
        tx,
      );

      return {
        ownerId: winner.user_id,
        teamId: result.team_id,
        stage: result.stage,
        version: result.version,
        reason,
        method: rule.method,
        allocationRuleId: rule.allocation_rule_id,
      };
    }

    return this.fallBackToUnassignedPool(lead, input, tx);
  }

  /**
   * No rule matched (or every matching pool was at capacity) — LLD step 7: the
   * lead stays unowned in `captured` (INV-01), parked on the branch's pool
   * team; `LEAD_ASSIGNED` (owner_id=null, reason `unassigned_pool`) fires and
   * the `allocation.no_match` alert is logged (Cloud Monitoring log-based
   * metric).
   */
  private async fallBackToUnassignedPool(
    lead: LeadAllocationContext,
    input: AllocationTriggerInput,
    tx: DbTransaction,
  ): Promise<AllocationOutcome> {
    if (lead.owner_id !== null) {
      // Already owned at capture (RM self-owned leads, FR-010): no rule matched,
      // but the lead is not unowned — parking it in the pool would be untrue.
      // No write, no event, no alert; the RM keeps working it (AMBIGUITY FR-030-2).
      return {
        ownerId: lead.owner_id,
        teamId: lead.team_id,
        stage: lead.stage,
        version: lead.version,
        reason: NO_RULE_MATCH_REASON,
        method: null,
        allocationRuleId: null,
      };
    }

    const fallbackTeamId =
      lead.branch_id !== null
        ? await this.rules.findBranchDefaultTeam(lead.org_id, lead.branch_id, tx)
        : undefined;

    const result = await this.leads.assignOwner(
      input.leadId,
      {
        ownerId: null,
        ...(fallbackTeamId !== undefined ? { teamId: fallbackTeamId } : {}),
        reason: UNASSIGNED_POOL_REASON,
        method: null,
        actorId: input.actorId,
        expectedVersion: input.expectedVersion,
      },
      tx,
    );

    this.logger.warn(
      { lead_id: lead.lead_id, org_id: lead.org_id, branch_id: lead.branch_id, metric: 'allocation.no_match' },
      'allocation.no_match: no allocation rule matched; lead routed to the branch unassigned pool',
    );

    return {
      ownerId: null,
      teamId: result.team_id,
      stage: result.stage,
      version: result.version,
      reason: NO_RULE_MATCH_REASON,
      method: null,
      allocationRuleId: null,
    };
  }

  // ─────────────────────────── Path B — manual reassign (POST /reassign) ──

  /**
   * `POST /leads/{id}/reassign` (LLD §Backend Flow Path B). The AbacGuard has
   * already verified the `allocate` capability; row-level scope (lead AND
   * target owner within the caller's B/T/A scope) is enforced here against the
   * guard's resolved predicate. All writes go through `LeadService.assignOwner`
   * inside one UnitOfWork transaction.
   */
  async reassign(
    leadId: string,
    dto: ReassignLeadDto,
    user: AuthUser,
    scope: AllocationScopeContext,
  ): Promise<AssignOwnerResult> {
    // 3. Load lead (404 on absent/soft-deleted).
    const lead = await this.rules.findLeadAllocationContext(leadId, this.db);
    if (!lead || lead.org_id !== user.orgId) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // 4. Stage guard — handed_off is terminal (T20).
    if (lead.stage === LeadStage.HANDED_OFF) {
      throw new DomainException(ERROR_CODES.CONFLICT, 'Lead is in a terminal stage and cannot be reassigned.');
    }

    // 2b. Row-level scope: the lead must be inside the caller's scope (T17).
    if (!leadInScope(lead, scope.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // override_capacity is honoured only for BM (B) / HEAD (A); SM → 403 (T10/T18).
    if (
      dto.override_capacity &&
      scope.effectiveScope !== DataScope.B &&
      scope.effectiveScope !== DataScope.A
    ) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 5. New owner must be an active user within the caller's scope.
    const newOwner = await this.rules.findActiveUser(user.orgId, dto.new_owner_id, this.db);
    if (!newOwner || !ownerInScope(newOwner, scope.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    // 6. Capacity check against the rule matching this lead (T22/T23).
    if (!dto.override_capacity) {
      await this.assertTargetHasCapacity(lead, newOwner.user_id);
    }

    // 7. UnitOfWork transaction — leads + stage_history + audit + outbox together.
    return this.uow.run(async (tx) => {
      const slaDueAt = await this.computeFirstContactDue(lead);
      return this.leads.assignOwner(
        leadId,
        {
          ownerId: newOwner.user_id,
          teamId: newOwner.team_id ?? null,
          reason: dto.reason,
          method: 'manual',
          actorId: user.userId,
          expectedVersion: lead.version,
          ...(slaDueAt !== undefined ? { slaFirstContactDueAt: slaDueAt } : {}),
          auditAction: AuditAction.REASSIGN,
          detail: { override_capacity: dto.override_capacity },
        },
        tx,
      );
    });
  }

  /**
   * The first active rule (priority_order ASC) whose criteria match the lead
   * defines the applicable `capacity_limit` (LLD §Validation: "for the matching
   * rule"); without a matching rule or limit there is no capacity constraint.
   */
  private async assertTargetHasCapacity(
    lead: LeadAllocationContext,
    targetUserId: string,
  ): Promise<void> {
    const activeRules = await this.rules.findActiveRules(lead.org_id, this.db);
    const matching = activeRules.find((r) => criteriaMatches(asRecord(r.criteria), lead));
    if (!matching || matching.capacity_limit === null) {
      return;
    }
    const loads = await this.rules.activeLeadCounts(lead.org_id, [targetUserId], this.db);
    if ((loads.get(targetUserId) ?? 0) >= matching.capacity_limit) {
      throw new DomainException(
        ERROR_CODES.CONFLICT,
        'Target RM is at capacity; set override_capacity=true if authorised.',
      );
    }
  }

  // ─────────────────────────────────── allocation_rules admin endpoints ──

  /** `GET /admin/allocation-rules` — org-scoped, priority order, LIMIT ≤ 100. */
  async listRules(query: { page: number; limit: number }, user: AuthUser): Promise<ListRulesResult> {
    const [rows, total] = await Promise.all([
      this.rules.listRules(user.orgId, query.page, query.limit),
      this.rules.countRules(user.orgId),
    ]);
    return {
      data: rows.map(toRuleView),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  /** `POST /admin/allocation-rules` — create (priority clash → CONFLICT, T32). */
  async createRule(dto: CreateAllocationRuleDto, user: AuthUser): Promise<AllocationRuleView> {
    try {
      const row = await this.rules.insertRule(
        user.orgId,
        {
          name: dto.name,
          priority_order: dto.priority_order,
          method: dto.method,
          criteria: dto.criteria,
          target: dto.target,
          capacity_limit: dto.capacity_limit ?? null,
          is_active: dto.is_active,
        },
        user.userId,
      );
      return toRuleView(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainException(
          ERROR_CODES.CONFLICT,
          'priority_order is already in use for this organisation.',
          { cause: err },
        );
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────── helpers ──

  /**
   * Resolve the rule's RM pool (LLD step 4/6). Method semantics:
   *  - `round_robin`/`capacity`: active RMs in `target.team_ids`;
   *  - `specialist`: same pool filtered to `users.product_skills ∋ product_code`;
   *  - `branch`: same pool restricted to the lead's branch;
   *  - `partner`: active users dedicated to `target.partner_id`;
   *  - `escalation`: the target teams' managers (`teams.manager_id`).
   */
  private async resolvePool(
    rule: AllocationRuleRow,
    lead: LeadAllocationContext,
    tx: DbTransaction,
  ): Promise<CandidateRm[]> {
    const target = asRecord(rule.target);
    if (rule.method === AllocationMethod.PARTNER) {
      const partnerId = typeof target['partner_id'] === 'string' ? target['partner_id'] : null;
      return partnerId === null ? [] : this.rules.findPartnerCandidates(lead.org_id, partnerId, tx);
    }

    const teamIds = stringArray(target['team_ids']);
    if (rule.method === AllocationMethod.ESCALATION) {
      return this.rules.findEscalationCandidates(lead.org_id, teamIds, tx);
    }

    let pool = await this.rules.findTeamCandidates(lead.org_id, teamIds, tx);
    if (rule.method === AllocationMethod.SPECIALIST) {
      pool = pool.filter((c) => stringArray(c.product_skills).includes(lead.product_code));
    }
    if (rule.method === AllocationMethod.BRANCH) {
      pool = pool.filter((c) => lead.branch_id !== null && c.branch_id === lead.branch_id);
    }
    return pool;
  }

  /**
   * `sla_first_contact_due_at` via the SLA engine (BusinessCalendarService) —
   * computed ONLY for the `captured → assigned` transition (state-machines.md);
   * a reassignment never resets the timer. `undefined` when no policy applies
   * (the engine logs the skip).
   */
  private async computeFirstContactDue(lead: LeadAllocationContext): Promise<Date | undefined> {
    if (lead.stage !== LeadStage.CAPTURED) {
      return undefined;
    }
    const computed = await this.sla.computeDueAt(
      SlaTarget.FIRST_CONTACT,
      { branchId: lead.branch_id },
      { branch_id: lead.branch_id },
    );
    return computed?.dueAt;
  }
}

// ───────────────────────────────────── pure evaluation helpers (unit-tested) ──

/** Narrow a JSONB value to a plain object (criteria/target are object JSONB). */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Narrow a JSONB value to a string array (`team_ids`, `product_skills`). */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * A rule matches when ALL its criteria keys are satisfied by the lead's
 * attributes (LLD step 3). Supported keys: branch_id, product_code, source,
 * partner_id, priority, language, is_hot. An unknown key is unsatisfiable
 * (deny-by-default — a malformed rule must never match everything).
 */
export function criteriaMatches(
  criteria: Record<string, unknown>,
  lead: LeadAllocationContext,
): boolean {
  for (const [key, expected] of Object.entries(criteria)) {
    switch (key) {
      case 'branch_id':
        if (lead.branch_id !== expected) return false;
        break;
      case 'product_code':
        if (lead.product_code !== expected) return false;
        break;
      case 'source':
        if (lead.source !== expected) return false;
        break;
      case 'partner_id':
        if (lead.partner_id !== expected) return false;
        break;
      case 'priority':
        if (lead.priority !== expected) return false;
        break;
      case 'language':
        if (lead.preferred_language !== expected) return false;
        break;
      case 'is_hot':
        if (lead.is_hot !== expected) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * Deterministic selection (LLD step 6): the candidate with the LOWEST active
 * load wins; ties break by `users.created_at` ASC (T01, BRD §5), then
 * `user_id` ASC as the final total order.
 */
export function pickCandidate(
  candidates: readonly CandidateRm[],
  loads: ReadonlyMap<string, number>,
): CandidateRm {
  let best: CandidateRm | undefined;
  for (const candidate of candidates) {
    if (best === undefined || comparesBefore(candidate, best, loads)) {
      best = candidate;
    }
  }
  if (best === undefined) {
    // Callers filter empty pools before selection; reaching here is a bug.
    throw new Error('pickCandidate requires a non-empty candidate pool');
  }
  return best;
}

function comparesBefore(
  a: CandidateRm,
  b: CandidateRm,
  loads: ReadonlyMap<string, number>,
): boolean {
  const loadDiff = (loads.get(a.user_id) ?? 0) - (loads.get(b.user_id) ?? 0);
  if (loadDiff !== 0) return loadDiff < 0;
  const createdDiff = a.created_at.getTime() - b.created_at.getTime();
  if (createdDiff !== 0) return createdDiff < 0;
  return a.user_id < b.user_id;
}

/** Row → wire view (LLD list/create response fields; no governance columns). */
export function toRuleView(row: AllocationRuleRow): AllocationRuleView {
  return {
    allocation_rule_id: row.allocation_rule_id,
    name: row.name,
    priority_order: row.priority_order,
    method: row.method,
    criteria: row.criteria,
    target: row.target,
    capacity_limit: row.capacity_limit,
    is_active: row.is_active,
  };
}

/** Lead-in-scope per the AbacGuard predicate (CORRECTIONS §FR-052 for SM/T). */
function leadInScope(lead: LeadAllocationContext, predicate: ScopePredicate | undefined): boolean {
  if (!predicate) return false;
  switch (predicate.type) {
    case 'branch':
      return lead.branch_id === predicate.branchId;
    case 'team':
      return lead.owner_id !== null && predicate.userIds.includes(lead.owner_id);
    case 'all':
      return true;
    default:
      return false;
  }
}

/** Target-owner-in-scope: BM=same branch, SM=team member, HEAD=any (LLD §Auth). */
function ownerInScope(owner: ReassignTargetUser, predicate: ScopePredicate | undefined): boolean {
  if (!predicate) return false;
  switch (predicate.type) {
    case 'branch':
      return owner.branch_id === predicate.branchId;
    case 'team':
      return predicate.userIds.includes(owner.user_id);
    case 'all':
      return true;
    default:
      return false;
  }
}
