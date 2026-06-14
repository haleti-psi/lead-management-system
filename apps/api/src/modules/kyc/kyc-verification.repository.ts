import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import type { IntegrationKind, KycCheckStatus, KycException, KycType } from '@lms/shared';

import { KYSELY, type DbTransaction, type KyselyDb } from '../../core/db';
import type { KycVerifications } from '../../core/db/types.generated';
import { KYC_VERIFICATIONS_LIMIT } from './kyc.constants';

/** Read shape of a `kyc_verifications` row. */
export type KycVerificationRow = Selectable<KycVerifications>;

/** Lead fields FR-071 needs for the stage/scope/identity checks (LLD §Step 1). */
export interface KycLeadContext {
  lead_id: string;
  org_id: string;
  owner_id: string | null;
  branch_id: string | null;
  stage: string;
  kyc_status: string;
  lead_identity_id: string;
}

/** An existing integration_logs row matched by idempotency key (LLD §Step 3). */
export interface IntegrationLogRef {
  integration_log_id: string;
  status: string;
}

/** Insert shape for a `kyc_verifications` row. */
export interface NewKycVerification {
  kyc_verification_id: string;
  org_id: string;
  lead_id: string;
  kyc_type: KycType;
  provider: string | null;
  status: KycCheckStatus;
  reference: string | null;
  masked_response: Record<string, unknown> | null;
  exception_type: KycException | null;
  integration_log_id: string | null;
  actor_id: string;
}

/** Per-type identity enrichment patch (only set columns provided). */
export interface LeadIdentityPatch {
  pan_token?: string;
  pan_masked?: string;
  ckyc_id?: string;
  aadhaar_ref_token?: string;
}

/**
 * FR-071 — owner repository for `kyc_verifications` + `data_sharing_logs` (M8).
 * All queries parameterised; every list read is LIMIT-bounded (NFR-17). Reads
 * over `leads`/`consent_records`/`integration_logs` are permitted (owner-writes
 * governs writes only); `leads.kyc_status` is written solely via LeadService.
 */
@Injectable()
export class KycVerificationRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Lead context for stage + scope + identity (LLD §Step 1). org-scoped. */
  async getLeadForKyc(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<KycLeadContext | undefined> {
    return executor
      .selectFrom('leads')
      .select([
        'lead_id',
        'org_id',
        'owner_id',
        'branch_id',
        'stage',
        'kyc_status',
        'lead_identity_id',
      ])
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Active granted `kyc` consent for the lead (LLD §Step 2). Returns its id. */
  async getActiveKycConsentId(
    leadId: string,
    orgId: string,
    now: Date,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<string | undefined> {
    const row = await executor
      .selectFrom('consent_records')
      .select('consent_id')
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .where('purpose', '=', 'kyc')
      .where('state', '=', 'granted')
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.consent_id;
  }

  /** Existing integration log for an idempotency key + kind (LLD §Step 3 / INV-8). */
  async findIntegrationLog(
    idempotencyKey: string,
    integration: IntegrationKind,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<IntegrationLogRef | undefined> {
    return executor
      .selectFrom('integration_logs')
      .select(['integration_log_id', 'status'])
      .where('idempotency_key', '=', idempotencyKey)
      .where('integration', '=', integration)
      .limit(1)
      .executeTakeFirst();
  }

  /** Load a verification by its integration log (idempotent-replay return). */
  async getVerificationByLogId(
    integrationLogId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<KycVerificationRow | undefined> {
    return executor
      .selectFrom('kyc_verifications')
      .selectAll()
      .where('integration_log_id', '=', integrationLogId)
      .where('org_id', '=', orgId)
      .limit(1)
      .executeTakeFirst();
  }

  /** All KYC verifications for a lead (LLD §computeLeadKycStatus; LIMIT ≤ 100). */
  async listByLead(
    leadId: string,
    orgId: string,
    executor: KyselyDb | DbTransaction = this.db,
  ): Promise<KycVerificationRow[]> {
    return executor
      .selectFrom('kyc_verifications')
      .selectAll()
      .where('lead_id', '=', leadId)
      .where('org_id', '=', orgId)
      .orderBy('created_at', 'desc')
      .limit(KYC_VERIFICATIONS_LIMIT)
      .execute();
  }

  /** Insert one `kyc_verifications` row (LLD §Step 5a). */
  async insertVerification(input: NewKycVerification, tx: DbTransaction): Promise<KycVerificationRow> {
    return tx
      .insertInto('kyc_verifications')
      .values({
        kyc_verification_id: input.kyc_verification_id,
        org_id: input.org_id,
        lead_id: input.lead_id,
        kyc_type: input.kyc_type,
        provider: input.provider,
        status: input.status,
        reference: input.reference,
        masked_response: input.masked_response != null ? JSON.stringify(input.masked_response) : null,
        exception_type: input.exception_type,
        integration_log_id: input.integration_log_id,
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Apply per-type identity enrichment (LLD §Step 5c). Skips when patch empty. */
  async updateLeadIdentity(
    leadIdentityId: string,
    orgId: string,
    patch: LeadIdentityPatch,
    actorId: string,
    tx: DbTransaction,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await tx
      .updateTable('lead_identities')
      .set({ ...patch, updated_by: actorId, updated_at: new Date() })
      .where('lead_identity_id', '=', leadIdentityId)
      .where('org_id', '=', orgId)
      .execute();
  }

  /** Insert a `data_sharing_logs` row for the external pull (LLD §Step 5d). */
  async insertDataSharingLog(
    input: {
      org_id: string;
      lead_id: string;
      recipient: string;
      consent_id: string;
      actor_id: string;
    },
    tx: DbTransaction,
  ): Promise<void> {
    await tx
      .insertInto('data_sharing_logs')
      .values({
        org_id: input.org_id,
        lead_id: input.lead_id,
        recipient: input.recipient,
        purpose: 'kyc',
        data_category: 'identity',
        consent_id: input.consent_id,
        status: 'shared',
        created_by: input.actor_id,
        updated_by: input.actor_id,
      })
      .execute();
  }
}
