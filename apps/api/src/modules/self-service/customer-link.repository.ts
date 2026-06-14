import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { CustomerLinks } from '../../core/db/types.generated';
import { SYSTEM_USER_ID } from '../identity/identity.constants';

/** Read shape of a `customer_links` row. */
export type CustomerLinkRow = Selectable<CustomerLinks>;

/** Lead context for link creation — scope fields + OTP recipient + display. */
export interface LinkLeadContext {
  lead_id: string;
  org_id: string;
  owner_id: string | null;
  branch_id: string | null;
  /** `source_attributions.partner_id` — PARTNER (P) scope check. */
  partner_id: string | null;
  stage: string;
  product_code: string;
  mobile: string;
}

/** Insert shape for a `customer_links` row. */
export interface NewCustomerLink {
  customer_link_id: string;
  org_id: string;
  lead_id: string;
  token_hash: string;
  purpose: string[];
  expires_at: Date;
  actor_id: string;
}

/**
 * FR-060 — owner repository for `customer_links` (M7; auth-matrix
 * `customer_links.writer = M7`). All queries parameterised. Token lookups are by
 * the SHA-256 hash only (the raw token is never stored or logged).
 */
@Injectable()
export class CustomerLinkRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Lead + identity + product context for link creation (scope + OTP + display). */
  async getLeadForLink(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<LinkLeadContext | undefined> {
    return executor
      .selectFrom('leads')
      .innerJoin('lead_identities', 'lead_identities.lead_identity_id', 'leads.lead_identity_id')
      .innerJoin('product_configs', 'product_configs.product_config_id', 'leads.product_config_id')
      .leftJoin('source_attributions', 'source_attributions.source_attribution_id', 'leads.source_attribution_id')
      .select([
        'leads.lead_id as lead_id',
        'leads.org_id as org_id',
        'leads.owner_id as owner_id',
        'leads.branch_id as branch_id',
        'source_attributions.partner_id as partner_id',
        'leads.stage as stage',
        'product_configs.product_code as product_code',
        'lead_identities.mobile as mobile',
      ])
      .where('leads.lead_id', '=', leadId)
      .where('leads.org_id', '=', orgId)
      .where('leads.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Minimal customer-safe display context for the landing page (no PII). */
  async getLeadDisplay(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<{ stage: string; product_code: string } | undefined> {
    return executor
      .selectFrom('leads')
      .innerJoin('product_configs', 'product_configs.product_config_id', 'leads.product_config_id')
      .select(['leads.stage as stage', 'product_configs.product_code as product_code'])
      .where('leads.lead_id', '=', leadId)
      .where('leads.org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /** Revoke every active link for a lead (resend supersedes the prior token). */
  async revokeActiveForLead(
    leadId: string,
    orgId: string,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .updateTable('customer_links')
      .set({ status: 'revoked', revoked_by: actorId, updated_by: actorId, updated_at: new Date() })
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('status', '=', 'active')
      .execute();
  }

  /** Insert a new active link (LLD §Create). `purpose` is a JSONB string[]. */
  async insert(input: NewCustomerLink, tx: DbTransaction): Promise<CustomerLinkRow> {
    return tx
      .insertInto('customer_links')
      .values({
        customer_link_id: input.customer_link_id,
        org_id: input.org_id,
        lead_id: input.lead_id,
        token_hash: input.token_hash,
        purpose: JSON.stringify(input.purpose),
        status: 'active',
        expires_at: input.expires_at,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Resolve an ACTIVE link by token hash (guard + port adapter). Not org-scoped
   * — the token IS the credential; org is read from the row. */
  async findActiveByTokenHash(
    tokenHash: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<CustomerLinkRow | undefined> {
    return executor
      .selectFrom('customer_links')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('status', '=', 'active')
      .limit(1)
      .executeTakeFirst();
  }

  /** Mark a link expired (guard, when expires_at has passed). */
  async markExpired(customerLinkId: string, executor: KyselyDb | DbTransaction = this.db): Promise<void> {
    await executor
      .updateTable('customer_links')
      .set({ status: 'expired', updated_by: SYSTEM_USER_ID, updated_at: new Date() })
      .where('customer_link_id', '=', customerLinkId)
      .where('status', '=', 'active')
      .execute();
  }

  /** Record first open (idempotent — no-op once opened_at is set). */
  async markOpened(customerLinkId: string, executor: KyselyDb | DbTransaction = this.db): Promise<void> {
    await executor
      .updateTable('customer_links')
      .set({ opened_at: new Date(), updated_by: SYSTEM_USER_ID, updated_at: new Date() })
      .where('customer_link_id', '=', customerLinkId)
      .where('opened_at', 'is', null)
      .execute();
  }

  /** Stamp `otp_verified_at` after a successful OTP step-up. */
  async markOtpVerified(customerLinkId: string, executor: KyselyDb | DbTransaction = this.db): Promise<void> {
    await executor
      .updateTable('customer_links')
      .set({ otp_verified_at: new Date(), updated_by: SYSTEM_USER_ID, updated_at: new Date() })
      .where('customer_link_id', '=', customerLinkId)
      .execute();
  }
}
