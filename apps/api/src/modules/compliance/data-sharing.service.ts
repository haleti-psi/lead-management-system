import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  type ConsentPurpose,
  type DataCategory,
  ERROR_CODES,
  ShareStatus,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';

export interface LogShareInput {
  leadId: string;
  orgId: string;
  recipient: string;
  purpose: ConsentPurpose;
  dataCategory: DataCategory;
  /** If the caller already knows the consent UUID it can pass it; otherwise
   * `DataSharingService` looks up the latest granted consent by purpose + category. */
  consentId: string | null;
  actorId: string;
}

/**
 * FR-111 — internal service that verifies consent and appends a
 * `data_sharing_logs` row within the CALLER's UnitOfWork transaction.
 *
 * This service does NOT open its own UoW; the caller (e.g. HandoffService,
 * EligibilityService, KycService) calls {@link logShare} INSIDE its own
 * `uow.run(async (tx) => { … })` block and passes the `tx` handle. If consent
 * is missing or the insert fails, the thrown exception rolls back the caller's
 * entire transaction — no partial state persists (LLD §Transaction Boundaries).
 *
 * **Append-only invariant:** this service has NO method that issues UPDATE or
 * DELETE on `data_sharing_logs` (INV-5 in FR-111-tests.md).
 *
 * Reuse seam: FR-080, FR-081, FR-071 each inject this service and call
 * `logShare` inside their own UoW transaction.
 */
@Injectable()
export class DataSharingService {
  constructor(private readonly audit: AuditAppender) {}

  /**
   * Verify consent and append a `data_sharing_logs` row in the caller's `tx`.
   *
   * Steps (LLD §Backend Flow "DataSharingService.logShare"):
   * 1. Query `consent_records` for a `granted`, non-expired record matching
   *    `(lead_id, purpose, data_category)`.
   * 2. If not found: throw `FORBIDDEN` with `detail.reason = 'CONSENT_MISSING'`.
   * 3. Insert the `data_sharing_logs` row within `tx`.
   * 4. Emit an audit entry within `tx` (action `lead_update` — see Ambiguity #4
   *    in FR-111.md; `data_share` not yet in the audit_action enum).
   */
  async logShare(input: LogShareInput, tx: DbTransaction): Promise<void> {
    // ── Step 1: verify a granted, non-expired consent exists ──────────────────
    // FR-110 records data_category as an optional field; the customer self-service
    // path stores NULL. Accept a consent row whose data_category equals the
    // requested category OR is NULL — so a genuinely-consented request never
    // rolls back spuriously (MAJOR-2 consent-predicate consistency fix).
    const consent = await tx
      .selectFrom('consent_records')
      .select(['consent_id', 'state', 'expires_at'])
      .where('lead_id', '=', input.leadId)
      .where('org_id', '=', input.orgId)
      .where('purpose', '=', input.purpose)
      .where((eb) =>
        eb.or([
          eb('data_category', '=', input.dataCategory),
          eb('data_category', 'is', null),
        ]),
      )
      .where('state', '=', 'granted')
      .where((eb) =>
        eb.or([
          eb('expires_at', 'is', null),
          eb('expires_at', '>', new Date()),
        ]),
      )
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!consent) {
      // ── Step 2: no valid consent — roll back the caller's UoW ───────────────
      throw new DomainException(ERROR_CODES.FORBIDDEN, undefined, {
        detail: { reason: 'CONSENT_MISSING' },
      });
    }

    // ── Step 3: insert the sharing log row (append-only) ──────────────────────
    await tx
      .insertInto('data_sharing_logs')
      .values({
        lead_id: input.leadId,
        org_id: input.orgId,
        recipient: input.recipient,
        purpose: input.purpose,
        data_category: input.dataCategory,
        consent_id: input.consentId ?? consent.consent_id,
        status: ShareStatus.SHARED,
        shared_at: new Date(),
        created_by: input.actorId,
        updated_by: input.actorId,
      })
      .execute();

    // ── Step 4: audit intent within the same tx ────────────────────────────────
    // Ambiguity #4 (FR-111.md): `data_share_logged` is not in the AuditAction
    // enum; using `lead_update` as the closest available value pending an enum
    // migration that adds `data_share` (or equivalent).
    await this.audit.append(
      {
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'data_sharing_logs',
        entity_id: input.leadId,
        actor_id: input.actorId,
        org_id: input.orgId,
        lead_id: input.leadId,
        detail: {
          recipient: input.recipient,
          purpose: input.purpose,
          dataCategory: input.dataCategory,
        },
      },
      tx,
    );
  }
}
