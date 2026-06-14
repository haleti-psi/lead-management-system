import { Injectable } from '@nestjs/common';

import type { ScoreReasonCode } from '@lms/shared';

import type { DbTransaction, KyselyDb } from '../../core/db';

/** Hydrated context the scoring engine needs to evaluate all 13 factors. */
export interface ScoringContext {
  lead_id: string;
  org_id: string;
  product_config_id: string;
  pin_code: string | null;
  requested_amount: number | null;
  /** From leads — used by hot rule H1 */
  priority: string;
  /** Current hot-flag value on the leads row (used to detect false→true transition). */
  is_hot: boolean;
  /** From lead_identities */
  pan_token: string | null;
  mobile: string;
  preferred_language: string | null;
  /** From source_attributions */
  source: string;
  partner_id: string | null;
  /** From product_configs */
  pan_required_at: string;
  /**
   * sla_config JSONB (may contain hot_amount_threshold per D2 arbiter decision).
   * Null when the product_config row has no sla_config set.
   */
  sla_config: Record<string, unknown> | null;
  /** From partners (null when no partner or partner_id is null) */
  partner_quality_score: number | null;
  partner_risk_category: string | null;
  partner_status: string | null;
  /** From lead_product_details (free-form attributes JSONB) */
  product_attributes: Record<string, unknown>;
  /**
   * FR-031 hot-rule H3: from customer_profiles.is_existing_customer.
   * Null when lead has no customer_profile_id (no join row).
   */
  is_existing_customer: boolean | null;
  /**
   * FR-031 hot-rule H5: count of customer-submitted documents with uploaded/
   * under_review/verified status. Null-safe: 0 when the documents table has no
   * rows for this lead (M8 not yet built — query returns empty).
   */
  customer_doc_count: number;
  /**
   * FR-031 hot-rule H6: true when the latest eligibility_snapshot (M9) has
   * status='received' and indicative_amount IS NOT NULL. False when M9 is not
   * yet built or no snapshot exists.
   */
  has_positive_eligibility: boolean;
  /**
   * FR-031 hot-rule H7: true when a tasks row of task_type='callback' exists for
   * this lead with status IN ('open','in_progress','done'). False when M7 is not
   * yet built or no task exists.
   */
  has_callback_task: boolean;
}

/** Active scoring rule configuration loaded from configuration_versions. */
export interface ScoringConfig {
  clamp: [number, number];
  factors: Record<string, number>;
  params: {
    partner_quality_good_min: number;
    partner_quality_poor_max: number;
    penalised_sources: string[];
    source_rejection_rate_threshold: number | null;
  };
}

@Injectable()
export class ScoringRepository {

  /**
   * Load the full scoring context for a lead. All reads are within the caller's
   * transaction (if provided) for read-consistency during the capture UoW.
   * Kysely parameterised; no string interpolation. LIMIT applied on every list read.
   *
   * Extended for FR-031: fetches hot-rule context fields (priority, is_hot,
   * is_existing_customer, customer_doc_count, has_positive_eligibility,
   * has_callback_task). Reads against M8/M9/M7 tables that are not yet built will
   * return empty rows — the hot rules simply don't fire (safe default = false).
   */
  async loadContext(leadId: string, db: KyselyDb | DbTransaction): Promise<ScoringContext> {
    const row = await db
      .selectFrom('leads as l')
      .innerJoin('lead_identities as li', 'li.lead_identity_id', 'l.lead_identity_id')
      .innerJoin('source_attributions as sa', 'sa.source_attribution_id', 'l.source_attribution_id')
      .innerJoin('product_configs as pc', 'pc.product_config_id', 'l.product_config_id')
      .leftJoin('customer_profiles as cp', 'cp.customer_profile_id', 'l.customer_profile_id')
      .select([
        'l.lead_id',
        'l.org_id',
        'l.product_config_id',
        'l.pin_code',
        'l.requested_amount',
        'l.priority',
        'l.is_hot',
        'li.pan_token',
        'li.mobile',
        'li.preferred_language',
        'sa.source',
        'sa.partner_id',
        'pc.pan_required_at',
        'pc.sla_config',
        'cp.is_existing_customer',
      ])
      .where('l.lead_id', '=', leadId)
      .where('l.deleted_at', 'is', null)
      .executeTakeFirstOrThrow();

    const partner =
      row.partner_id != null
        ? await db
            .selectFrom('partners')
            .select(['quality_score', 'risk_category', 'status'])
            .where('partner_id', '=', row.partner_id)
            .executeTakeFirst()
        : null;

    const productDetail = await db
      .selectFrom('lead_product_details')
      .select(['attributes'])
      .where('lead_id', '=', leadId)
      .executeTakeFirst();

    // FR-031 H5: customer-submitted documents (M8 not yet built; empty = 0, rule doesn't fire).
    const docCountRow = await db
      .selectFrom('documents')
      .select((eb) => eb.fn.count<string>('document_id').as('cnt'))
      .where('lead_id', '=', leadId)
      .where('org_id', '=', row.org_id)
      .where('uploaded_via', '=', 'customer_link')
      .where('status', 'in', ['uploaded', 'under_review', 'verified'])
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const customerDocCount = Number(docCountRow?.cnt ?? 0);

    // FR-031 H6: positive LOS indicative (M9 not yet built; absent = false, rule doesn't fire).
    const eligibilitySnap = await db
      .selectFrom('eligibility_snapshots')
      .select(['indicative_amount'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', row.org_id)
      .where('status', '=', 'received')
      .where('indicative_amount', 'is not', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const hasPositiveEligibility = eligibilitySnap != null;

    // FR-031 H7: high-intent callback task (M7 not yet built; absent = false, rule doesn't fire).
    // Note: tasks.type is the column name in the generated schema (not task_type).
    const callbackTask = await db
      .selectFrom('tasks')
      .select(['task_id'])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', row.org_id)
      .where('type', '=', 'callback')
      .where('status', 'in', ['open', 'in_progress', 'done'])
      .limit(1)
      .executeTakeFirst();
    const hasCallbackTask = callbackTask != null;

    const slaConfig =
      row.sla_config != null && typeof row.sla_config === 'object' && !Array.isArray(row.sla_config)
        ? (row.sla_config as Record<string, unknown>)
        : null;

    const productAttributes =
      productDetail?.attributes != null &&
      typeof productDetail.attributes === 'object' &&
      !Array.isArray(productDetail.attributes)
        ? (productDetail.attributes as Record<string, unknown>)
        : {};

    return {
      lead_id: row.lead_id,
      org_id: row.org_id,
      product_config_id: row.product_config_id,
      pin_code: row.pin_code ?? null,
      requested_amount: row.requested_amount != null ? Number(row.requested_amount) : null,
      priority: row.priority,
      is_hot: row.is_hot,
      pan_token: row.pan_token ?? null,
      mobile: row.mobile,
      preferred_language: row.preferred_language ?? null,
      source: row.source,
      partner_id: row.partner_id ?? null,
      pan_required_at: row.pan_required_at,
      sla_config: slaConfig,
      partner_quality_score: partner?.quality_score ?? null,
      partner_risk_category: partner?.risk_category ?? null,
      partner_status: partner?.status ?? null,
      product_attributes: productAttributes,
      is_existing_customer: row.is_existing_customer ?? null,
      customer_doc_count: customerDocCount,
      has_positive_eligibility: hasPositiveEligibility,
      has_callback_task: hasCallbackTask,
    };
  }

  /**
   * Load the active scoring ConfigurationVersion (config_type='scoring_rules').
   * Returns null when no active row exists — the engine falls back to built-in
   * defaults (FR-011 LLD §337). LIMIT 1 per non-negotiable list-query rule.
   */
  async loadActiveScoringConfig(
    orgId: string,
    db: KyselyDb | DbTransaction,
  ): Promise<ScoringConfig | null> {
    const row = await db
      .selectFrom('configuration_versions')
      .select(['diff'])
      .where('org_id', '=', orgId)
      .where('config_type', '=', 'scoring_rules')
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();

    if (row == null || row.diff == null) {
      return null;
    }

    return this.parseScoringConfig(row.diff);
  }

  private parseScoringConfig(diff: unknown): ScoringConfig | null {
    if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) {
      return null;
    }
    const d = diff as Record<string, unknown>;
    const clampRaw = d['clamp'];
    const factorsRaw = d['factors'];
    const paramsRaw = d['params'];

    if (
      !Array.isArray(clampRaw) ||
      clampRaw.length !== 2 ||
      typeof clampRaw[0] !== 'number' ||
      typeof clampRaw[1] !== 'number' ||
      typeof factorsRaw !== 'object' ||
      factorsRaw === null ||
      typeof paramsRaw !== 'object' ||
      paramsRaw === null
    ) {
      return null;
    }

    const params = paramsRaw as Record<string, unknown>;
    return {
      clamp: [clampRaw[0] as number, clampRaw[1] as number],
      factors: factorsRaw as Record<string, number>,
      params: {
        partner_quality_good_min: typeof params['partner_quality_good_min'] === 'number' ? (params['partner_quality_good_min'] as number) : 70,
        partner_quality_poor_max: typeof params['partner_quality_poor_max'] === 'number' ? (params['partner_quality_poor_max'] as number) : 40,
        penalised_sources: Array.isArray(params['penalised_sources'])
          ? (params['penalised_sources'] as string[]).filter((s): s is string => typeof s === 'string')
          : [],
        source_rejection_rate_threshold:
          typeof params['source_rejection_rate_threshold'] === 'number'
            ? (params['source_rejection_rate_threshold'] as number)
            : null,
      },
    };
  }
}

/** The 13-factor scoring result returned by the engine. */
export interface FactorResult {
  score: number;
  reasons: ScoreReasonCode[];
}
