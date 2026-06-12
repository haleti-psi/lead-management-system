import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import { UserStatus, type AllocationMethod, type LeadStage } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { AllocationRules } from '../../core/db/types.generated';
import {
  ACTIVE_RULES_LIMIT,
  CANDIDATE_POOL_LIMIT,
  INACTIVE_LOAD_STAGES,
} from './allocation.constants';

/** Read shape of an `allocation_rules` row (all columns). */
export type AllocationRuleRow = Selectable<AllocationRules>;

/** The write-field set for `POST /admin/allocation-rules` (LLD §Data Operations). */
export interface AllocationRuleWriteFields {
  name: string;
  priority_order: number;
  method: AllocationMethod;
  criteria: Record<string, unknown>;
  target: Record<string, unknown>;
  capacity_limit: number | null;
  is_active: boolean;
}

/**
 * Lead attributes the rule evaluator matches `criteria` against (LLD step 3):
 * the lead row joined with its source attribution (`source`, `partner_id`) and
 * customer profile (`preferred_language`).
 */
export interface LeadAllocationContext {
  lead_id: string;
  org_id: string;
  lead_code: string;
  stage: LeadStage;
  branch_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  version: number;
  product_code: string;
  priority: string;
  is_hot: boolean;
  source: string | null;
  partner_id: string | null;
  preferred_language: string | null;
}

/** A candidate RM in a rule's resolved pool (LLD step 4). */
export interface CandidateRm {
  user_id: string;
  team_id: string | null;
  branch_id: string | null;
  partner_id: string | null;
  product_skills: unknown;
  created_at: Date;
  /** Escalation pool only: the team this user manages (team attribution fallback). */
  managed_team_id?: string;
}

/** Minimal active-user row for reassign-target validation (Path B step 5). */
export interface ReassignTargetUser {
  user_id: string;
  branch_id: string | null;
  team_id: string | null;
}

/** Postgres unique-violation SQLSTATE — `uq_allocation_rules_order`. */
const PG_UNIQUE_VIOLATION = '23505';

/** Narrow a thrown error to a Postgres unique-constraint (23505) violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * FR-030 — owner repository for `allocation_rules` (M4). This is the ONLY class
 * that issues writes against `allocation_rules` (owner-writes, architecture
 * §11.2; the FR-131 generic master descriptor surrendered the resource to this
 * FR). It also hosts M4's bounded READ surface over `leads`/`users`/`teams`
 * (reads are permitted — owner-writes governs writes only). All queries are
 * parameterised Kysely and LIMIT-bounded (≤100, NFR-17).
 */
@Injectable()
export class AllocationRuleRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  // ───────────────────────────────────────────── allocation_rules (owned) ──

  /** Active rules in evaluation order (`priority_order` ASC, LIMIT 100 — LLD step 2). */
  async findActiveRules(
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<AllocationRuleRow[]> {
    return executor
      .selectFrom('allocation_rules')
      .selectAll()
      .where('org_id', '=', orgId)
      .where('is_active', '=', true)
      .orderBy('priority_order', 'asc')
      .limit(ACTIVE_RULES_LIMIT)
      .execute();
  }

  /** Paginated org-scoped rule list (`priority_order` ASC). LIMIT ≤ 100. */
  async listRules(orgId: string, page: number, limit: number): Promise<AllocationRuleRow[]> {
    return this.db
      .selectFrom('allocation_rules')
      .selectAll()
      .where('org_id', '=', orgId)
      .orderBy('priority_order', 'asc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();
  }

  /** Total rules for the org (pagination meta). */
  async countRules(orgId: string): Promise<number> {
    const row = await this.db
      .selectFrom('allocation_rules')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', orgId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * Insert a new rule. `uq_allocation_rules_order` (org_id, priority_order) is
   * enforced by the DB; a 23505 surfaces to the caller as CONFLICT (T32, see
   * {@link isUniqueViolation}).
   */
  async insertRule(
    orgId: string,
    fields: AllocationRuleWriteFields,
    actorId: string,
  ): Promise<AllocationRuleRow> {
    return this.db
      .insertInto('allocation_rules')
      .values({
        org_id: orgId,
        name: fields.name,
        priority_order: fields.priority_order,
        method: fields.method,
        criteria: JSON.stringify(fields.criteria),
        target: JSON.stringify(fields.target),
        capacity_limit: fields.capacity_limit,
        is_active: fields.is_active,
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ────────────────────────────── bounded reads over leads/users/teams ──

  /**
   * The lead + its rule-matching attributes (LLD step 3): source attribution
   * (`source`, `partner_id`) and customer profile (`preferred_language`).
   * Soft-deleted leads are invisible (Path B step 3 → 404).
   */
  async findLeadAllocationContext(
    leadId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<LeadAllocationContext | undefined> {
    return executor
      .selectFrom('leads')
      .leftJoin(
        'source_attributions',
        'source_attributions.source_attribution_id',
        'leads.source_attribution_id',
      )
      .leftJoin(
        'customer_profiles',
        'customer_profiles.customer_profile_id',
        'leads.customer_profile_id',
      )
      .select([
        'leads.lead_id as lead_id',
        'leads.org_id as org_id',
        'leads.lead_code as lead_code',
        'leads.stage as stage',
        'leads.branch_id as branch_id',
        'leads.owner_id as owner_id',
        'leads.team_id as team_id',
        'leads.version as version',
        'leads.product_code as product_code',
        'leads.priority as priority',
        'leads.is_hot as is_hot',
        'source_attributions.source as source',
        'source_attributions.partner_id as partner_id',
        'customer_profiles.preferred_language as preferred_language',
      ])
      .where('leads.lead_id', '=', leadId)
      .where('leads.deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
  }

  /** Active RMs in the target teams (round_robin/capacity/specialist/branch pools). */
  async findTeamCandidates(
    orgId: string,
    teamIds: readonly string[],
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<CandidateRm[]> {
    if (teamIds.length === 0) {
      return [];
    }
    return executor
      .selectFrom('users')
      .select(['user_id', 'team_id', 'branch_id', 'partner_id', 'product_skills', 'created_at'])
      .where('org_id', '=', orgId)
      .where('status', '=', UserStatus.ACTIVE)
      .where('team_id', 'in', [...teamIds])
      .orderBy('created_at', 'asc')
      .limit(CANDIDATE_POOL_LIMIT)
      .execute();
  }

  /** Active users dedicated to the target partner (`partner` method pool). */
  async findPartnerCandidates(
    orgId: string,
    partnerId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<CandidateRm[]> {
    return executor
      .selectFrom('users')
      .select(['user_id', 'team_id', 'branch_id', 'partner_id', 'product_skills', 'created_at'])
      .where('org_id', '=', orgId)
      .where('status', '=', UserStatus.ACTIVE)
      .where('partner_id', '=', partnerId)
      .orderBy('created_at', 'asc')
      .limit(CANDIDATE_POOL_LIMIT)
      .execute();
  }

  /**
   * Active managers (`teams.manager_id`) of the target teams (`escalation`
   * method pool — T06). Each candidate carries the team they manage so the
   * lead's team attribution falls back to it when the manager has no own team.
   */
  async findEscalationCandidates(
    orgId: string,
    teamIds: readonly string[],
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<CandidateRm[]> {
    if (teamIds.length === 0) {
      return [];
    }
    const teams = await executor
      .selectFrom('teams')
      .select(['team_id', 'manager_id'])
      .where('org_id', '=', orgId)
      .where('team_id', 'in', [...teamIds])
      .where('is_active', '=', true)
      .where('manager_id', 'is not', null)
      .limit(CANDIDATE_POOL_LIMIT)
      .execute();
    const managedTeamByUser = new Map<string, string>();
    for (const team of teams) {
      if (team.manager_id !== null && !managedTeamByUser.has(team.manager_id)) {
        managedTeamByUser.set(team.manager_id, team.team_id);
      }
    }
    if (managedTeamByUser.size === 0) {
      return [];
    }
    const managers = await executor
      .selectFrom('users')
      .select(['user_id', 'team_id', 'branch_id', 'partner_id', 'product_skills', 'created_at'])
      .where('org_id', '=', orgId)
      .where('status', '=', UserStatus.ACTIVE)
      .where('user_id', 'in', [...managedTeamByUser.keys()])
      .orderBy('created_at', 'asc')
      .limit(CANDIDATE_POOL_LIMIT)
      .execute();
    return managers.map((m) => ({ ...m, managed_team_id: managedTeamByUser.get(m.user_id) }));
  }

  /**
   * Current active-lead count per candidate (LLD step 5: stages not in
   * handed_off/rejected/dormant, not deleted). Bounded by the ≤100 pool.
   */
  async activeLeadCounts(
    orgId: string,
    userIds: readonly string[],
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await executor
      .selectFrom('leads')
      .select(['owner_id'])
      .select((eb) => eb.fn.count<string>('lead_id').as('count'))
      .where('org_id', '=', orgId)
      .where('owner_id', 'in', [...userIds])
      .where('stage', 'not in', [...INACTIVE_LOAD_STAGES])
      .where('deleted_at', 'is', null)
      .groupBy('owner_id')
      .limit(CANDIDATE_POOL_LIMIT)
      .execute();
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.owner_id !== null) {
        counts.set(row.owner_id, Number(row.count));
      }
    }
    return counts;
  }

  /**
   * The branch's pool team for the no-match fallback (LLD step 7 "branch
   * default team"). The schema has no default flag, so the OLDEST active team
   * of the branch is the deterministic default (AMBIGUITY.md §FR-030-1).
   */
  async findBranchDefaultTeam(
    orgId: string,
    branchId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<string | undefined> {
    const row = await executor
      .selectFrom('teams')
      .select(['team_id'])
      .where('org_id', '=', orgId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .orderBy('created_at', 'asc')
      .orderBy('team_id', 'asc')
      .limit(1)
      .executeTakeFirst();
    return row?.team_id;
  }

  /** Resolve `new_owner_id` to an ACTIVE user in the org (Path B step 5). */
  async findActiveUser(
    orgId: string,
    userId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<ReassignTargetUser | undefined> {
    return executor
      .selectFrom('users')
      .select(['user_id', 'branch_id', 'team_id'])
      .where('org_id', '=', orgId)
      .where('user_id', '=', userId)
      .where('status', '=', UserStatus.ACTIVE)
      .limit(1)
      .executeTakeFirst();
  }
}
