import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { SlaTarget } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { SlaPolicies } from '../../core/db/types.generated';
import { ORG_ID_DEFAULT } from '../../core/outbox/outbox.constants';
import type { SlaPolicyForCompute, SlaPolicyReaderPort } from '../../core/sla';
import type { EscalationStep } from '../../core/sla';
import type { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { SLA_POLICY_CONFIG_TYPE } from './engagement.constants';

/** Read shape of an `sla_policies` row. */
export type SlaPolicyRow = Selectable<SlaPolicies>;

export interface ListFilters {
  applies_to?: SlaTarget;
  is_active?: boolean;
}

export interface ListPagination {
  page: number;
  limit: number;
}

/**
 * FR-104 — owner repository for `sla_policies` and the `sla_policy` rows of
 * `configuration_versions` (M14 config, maker-checker). All queries are
 * parameterised Kysely, org-scoped, and every list query is `LIMIT`-bounded
 * (NFR-17). It also implements {@link SlaPolicyReaderPort} so the core
 * {@link SlaEngine} can resolve the governing policy without coupling to M11.
 */
@Injectable()
export class SlaPolicyRepository implements SlaPolicyReaderPort {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Paginated list of policies for the org, newest first. LIMIT ≤ 100. */
  async list(filters: ListFilters, pagination: ListPagination): Promise<SlaPolicyRow[]> {
    return this.db
      .selectFrom('sla_policies')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.applies_to != null, (qb) => qb.where('applies_to', '=', filters.applies_to!))
      .$if(filters.is_active != null, (qb) => qb.where('is_active', '=', filters.is_active!))
      .orderBy('created_at', 'desc')
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit)
      .execute();
  }

  /** Total matching rows (for pagination meta). */
  async count(filters: ListFilters): Promise<number> {
    const row = await this.db
      .selectFrom('sla_policies')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('org_id', '=', ORG_ID_DEFAULT)
      .$if(filters.applies_to != null, (qb) => qb.where('applies_to', '=', filters.applies_to!))
      .$if(filters.is_active != null, (qb) => qb.where('is_active', '=', filters.is_active!))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /**
   * True when an ACTIVE policy with the same `name` + `applies_to` already exists
   * for the org (the duplicate-active guard → CONFLICT). Runs inside the create
   * transaction so the check and the insert are consistent.
   */
  async activeDuplicateExists(
    name: string,
    appliesTo: SlaTarget,
    tx: DbTransaction,
  ): Promise<boolean> {
    const existing = await tx
      .selectFrom('sla_policies')
      .select('sla_policy_id')
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('name', '=', name)
      .where('applies_to', '=', appliesTo)
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
    return existing != null;
  }

  /**
   * Insert the policy row as INACTIVE (maker-checker activates it later). Runs in
   * the caller's transaction; `escalation_chain`/`condition` are stored as JSONB.
   */
  async insertPolicy(dto: CreateSlaPolicyDto, actorId: string, tx: DbTransaction): Promise<SlaPolicyRow> {
    return tx
      .insertInto('sla_policies')
      .values({
        org_id: ORG_ID_DEFAULT,
        name: dto.name,
        applies_to: dto.applies_to,
        condition: dto.condition != null ? JSON.stringify(dto.condition) : null,
        threshold_minutes: dto.threshold_minutes,
        escalation_chain: JSON.stringify(dto.escalation_chain),
        is_active: false, // inactive until maker-checker approval (FR-132)
        created_by: actorId,
        updated_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Insert the paired `configuration_versions` row (`config_type='sla_policy'`,
   * `status='pending'`, `maker_id=actor`) in the same transaction. Returns the
   * new configuration_version_id.
   */
  async insertConfigVersion(
    policyId: string,
    diff: CreateSlaPolicyDto,
    actorId: string,
    tx: DbTransaction,
  ): Promise<string> {
    const row = await tx
      .insertInto('configuration_versions')
      .values({
        org_id: ORG_ID_DEFAULT,
        config_type: SLA_POLICY_CONFIG_TYPE,
        config_ref: policyId,
        version: 1,
        maker_id: actorId,
        checker_id: null,
        status: 'pending',
        effective_at: null,
        rollback_ref: null,
        diff: JSON.stringify(diff),
        created_by: actorId,
        updated_by: actorId,
      })
      .returning('configuration_version_id')
      .executeTakeFirstOrThrow();
    return row.configuration_version_id;
  }

  /**
   * {@link SlaPolicyReaderPort} — the most-specific ACTIVE policy for `appliesTo`.
   * Matching: a policy whose `condition.product_code` includes the attribute's
   * `product_code` wins; otherwise a condition-less active policy is the fallback.
   * Returns `undefined` when nothing applies. Bounded scan, org-scoped.
   */
  async findActivePolicy(
    appliesTo: SlaTarget,
    attributes: Record<string, unknown>,
  ): Promise<SlaPolicyForCompute | undefined> {
    const rows = await this.db
      .selectFrom('sla_policies')
      .selectAll()
      .where('org_id', '=', ORG_ID_DEFAULT)
      .where('applies_to', '=', appliesTo)
      .where('is_active', '=', true)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    const productCode = typeof attributes.product_code === 'string' ? attributes.product_code : null;

    let fallback: SlaPolicyForCompute | undefined;
    for (const row of rows) {
      const condition = parseCondition(row.condition);
      if (condition === null || isConditionEmpty(condition)) {
        fallback ??= toCompute(row, condition);
        continue;
      }
      if (productCode != null && conditionMatchesProduct(condition, productCode)) {
        return toCompute(row, condition);
      }
    }
    return fallback;
  }
}

/** Parse the JSONB `condition` cell into a plain object (or null). */
function parseCondition(raw: unknown): Record<string, unknown> | null {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isConditionEmpty(condition: Record<string, unknown>): boolean {
  return Object.keys(condition).length === 0;
}

function conditionMatchesProduct(condition: Record<string, unknown>, productCode: string): boolean {
  const codes = condition.product_code;
  if (Array.isArray(codes)) return codes.includes(productCode);
  return codes === productCode;
}

/** Map a DB row to the engine's compute shape, parsing the escalation chain. */
function toCompute(row: SlaPolicyRow, condition: Record<string, unknown> | null): SlaPolicyForCompute {
  return {
    sla_policy_id: row.sla_policy_id,
    applies_to: row.applies_to,
    threshold_minutes: row.threshold_minutes,
    escalation_chain: parseEscalationChain(row.escalation_chain),
    condition,
  };
}

function parseEscalationChain(raw: unknown): EscalationStep[] {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is EscalationStep => s != null && typeof s === 'object');
}
