import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  ConsentActor,
  ConsentState,
  ConsentStatus,
  ERROR_CODES,
  EventCode,
  RoleCode,
  type ConsentPurpose,
  type CreationChannel,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { UnitOfWork, type DbTransaction } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import { SYSTEM_ACTOR_ID } from '../capture/capture.constants';
import { LeadService } from '../capture/lead.service';
import { CONSENT_RECORDS_RESOURCE_TYPE } from './compliance.constants';
import {
  deriveConsentStatus,
  type ConsentStateEntry,
} from './consent-derivation';
import {
  ConsentRepository,
  type ConsentRecordRow,
  type LeadConsentContext,
  type NewConsentRecord,
} from './consent.repository';
import type { CaptureConsentDto } from './dto/capture-consent.dto';
import type { CustomerConsentDto } from './dto/customer-consent.dto';
import type { ListConsentsQuery } from './dto/list-consents.dto';
import type { ResolvedCustomerLink } from './ports/customer-link.port';

/** Request-derived client metadata (recorded on audit rows; never logged raw). */
export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

/** Caller context the controllers pass alongside the DTO (staff paths). */
export interface ConsentActorContext {
  userId: string;
  orgId: string;
  role: RoleCode;
  /** AbacGuard-resolved scope predicate — row-level lead check (FR-002). */
  predicate: ScopePredicate | undefined;
  requestMeta: ClientMeta;
}

/** `POST /leads/{id}/consents` response data (api-contract / LLD §Endpoint 2). */
export interface ConsentCaptureData {
  consent_id: string;
  lead_id: string;
  purpose: ConsentPurpose;
  state: ConsentState;
  created_at: Date;
  derived_consent_status: ConsentStatus;
}

/** `POST /c/{token}/consent` response data (LLD §Endpoint 3). */
export interface CustomerConsentData {
  consent_id: string;
  purpose: ConsentPurpose;
  state: ConsentState;
  created_at: Date;
}

/** One consent-history list item (LLD §Endpoint 1 response fields). */
export interface ConsentListItem {
  consent_id: string;
  lead_id: string;
  customer_profile_id: string | null;
  purpose: ConsentPurpose;
  data_category: string | null;
  state: ConsentState;
  channel: CreationChannel;
  language: string | null;
  notice_version: string;
  consent_text_version: string;
  actor: ConsentActor;
  /** Masked (null) for every role except DPO/ADMIN — treated as PII. */
  ip_device: unknown;
  expires_at: Date | null;
  superseded_by: string | null;
  created_at: Date;
}

export interface ListConsentsResult {
  data: ConsentListItem[];
  pagination: { page: number; limit: number; total: number };
}

/** Internals of one append (shared by the staff and customer paths). */
interface AppendConsentInput {
  lead: LeadConsentContext;
  purpose: ConsentPurpose;
  state: ConsentState;
  dataCategory: CaptureConsentDto['data_category'] | null;
  channel: CreationChannel;
  language: CaptureConsentDto['language'] | null;
  noticeVersion: string;
  consentTextVersion: string;
  actor: ConsentActor;
  ipDevice: { ip: string; device: string } | null;
  expiresAt: Date | null;
  /** `audit_logs.actor_id` (users FK) — the session user, or the reserved system actor on the customer path. */
  auditActorId: string;
  auditIpDevice: { ip?: string; user_agent?: string } | null;
}

/**
 * FR-110 — the purpose-wise consent ledger (M12 Compliance). Owns every write
 * to `consent_records` (append-only: a state change is a NEW row, never an
 * UPDATE — the only sanctioned mutation is the `superseded_by` pointer on the
 * prior grant). Each capture re-derives `leads.consent_status` through
 * `LeadService.setConsentStatus` (sole writer of `leads`) and emits audit +
 * (on withdrawal) the `CONSENT_WITHDRAWN` outbox event INSIDE the same
 * `UnitOfWork` transaction — all-or-nothing (LLD §Transaction boundary).
 *
 * Stage gating (`los_handoff` withdrawal blocks hand-off) is enforced by
 * StageGuardService in other FRs; they read this ledger via
 * {@link deriveConsentStatusForLead} / {@link ConsentRepository}.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: ConsentRepository,
    private readonly leads: LeadService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
  ) {}

  // ───────────────────────────────────────────── staff capture (Endpoint 2) ──

  async capture(
    leadId: string,
    dto: CaptureConsentDto,
    ctx: ConsentActorContext,
  ): Promise<ConsentCaptureData> {
    // 4a. Lead must exist in the caller's org (404), then scope check (403).
    const lead = await this.loadLeadInScope(leadId, ctx.orgId, ctx.predicate);

    // 4b. `expired`/`superseded` are system-managed states — never accepted.
    this.assertWritableState(dto.state);

    // 4c. Withdrawal pre-check: a prior grant must exist for (lead, purpose).
    if (dto.state === ConsentState.WITHDRAWN) {
      const granted = await this.repo.hasPriorGrant(leadId, ctx.orgId, dto.purpose);
      if (!granted) {
        throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
          fields: [{ field: 'state', issue: 'Cannot withdraw consent that was never granted.' }],
        });
      }
    }

    const { row, derived } = await this.appendConsent({
      lead,
      purpose: dto.purpose,
      state: dto.state,
      dataCategory: dto.data_category ?? null,
      channel: dto.channel,
      language: dto.language ?? null,
      noticeVersion: dto.notice_version,
      consentTextVersion: dto.consent_text_version,
      actor: dto.actor,
      ipDevice: dto.ip_device ?? null,
      expiresAt: dto.expires_at ?? null,
      auditActorId: ctx.userId,
      auditIpDevice: toAuditIpDevice(ctx.requestMeta),
    });

    return {
      consent_id: row.consent_id,
      lead_id: row.lead_id,
      purpose: row.purpose,
      state: row.state,
      created_at: row.created_at,
      derived_consent_status: derived,
    };
  }

  // ─────────────────────────────────── customer self-service (Endpoint 3) ──

  /**
   * Append a customer-granted/denied consent for the lead a validated link
   * token resolves to. The token + OTP step-up were already verified by the
   * {@link ResolvedCustomerLink} producer (CustomerLinkPort): a valid token IS
   * the authorisation for exactly this lead — no ABAC predicate applies.
   * `actor` is always `customer`; `channel` comes from the link; `ip_device`
   * from the request headers (never logged raw — stored masked-at-read).
   */
  async captureFromCustomer(
    link: ResolvedCustomerLink,
    dto: CustomerConsentDto,
    meta: ClientMeta,
  ): Promise<CustomerConsentData> {
    const lead = await this.repo.findLeadConsentContext(link.leadId, link.orgId);
    if (!lead) {
      // Link bound to a vanished/deleted lead — existence hidden.
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    // DTO restricts state to granted|denied; defence-in-depth re-check.
    this.assertWritableState(dto.state);

    const ipDevice =
      meta.ip || meta.userAgent
        ? { ip: meta.ip ?? '', device: meta.userAgent ?? '' }
        : null;

    const { row } = await this.appendConsent({
      lead,
      purpose: dto.purpose,
      state: dto.state,
      dataCategory: null,
      channel: link.channel,
      language: dto.language ?? null,
      noticeVersion: dto.notice_version,
      consentTextVersion: dto.consent_text_version,
      actor: ConsentActor.CUSTOMER,
      ipDevice,
      expiresAt: null,
      // No user session on the public path — reserved system actor (users FK).
      auditActorId: SYSTEM_ACTOR_ID,
      auditIpDevice: toAuditIpDevice(meta),
      customerProfileId: link.customerProfileId ?? lead.customer_profile_id,
    });

    return {
      consent_id: row.consent_id,
      purpose: row.purpose,
      state: row.state,
      created_at: row.created_at,
    };
  }

  // ──────────────────────────────────────────────────── read (Endpoint 1) ──

  async listForLead(
    leadId: string,
    query: ListConsentsQuery,
    ctx: ConsentActorContext,
  ): Promise<ListConsentsResult> {
    await this.loadLeadInScope(leadId, ctx.orgId, ctx.predicate);

    const filters = { purpose: query.purpose, state: query.state };
    const [rows, total] = await Promise.all([
      this.repo.listForLead(leadId, ctx.orgId, filters, query.page, query.limit),
      this.repo.countForLead(leadId, ctx.orgId, filters),
    ]);

    // `ip_device` is PII: visible to DPO (full ledger view) and ADMIN
    // (DPO-equivalent compliance read) only — null for everyone else
    // (LLD §Backend Flow read step 4 / §Ambiguities 3).
    const ipDeviceVisible = ctx.role === RoleCode.DPO || ctx.role === RoleCode.ADMIN;

    return {
      data: rows.map((row) => toListItem(row, ipDeviceVisible)),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  // ─────────────────────────────────────────────── derivation (T25–T28) ──

  /** Canonical FR-110 derivation — delegates to the pure M12 algorithm. */
  deriveConsentStatus(latestPerPurpose: readonly ConsentStateEntry[]): ConsentStatus {
    return deriveConsentStatus(latestPerPurpose);
  }

  /**
   * Re-derive a lead's consent status from the ledger (exposed for the stage
   * guard / hand-off FRs that gate on consent — LLD §Summary "Consent gates").
   */
  async deriveConsentStatusForLead(
    leadId: string,
    orgId: string,
    tx?: DbTransaction,
  ): Promise<ConsentStatus> {
    const latest = await this.repo.findLatestPerPurpose(leadId, orgId, tx);
    return deriveConsentStatus(latest);
  }

  // ─────────────────────────────────────── append-only enforcement (T29) ──

  /**
   * `consent_records` is append-only — there is NO update path. Kept as an
   * explicit, typed-throw member so any future code path attempting an update
   * fails loudly at the service layer, before any query builder is touched
   * (LLD §Error Cases; FR-110-tests T29).
   */
  updateConsent(): never {
    throw new DomainException(
      ERROR_CODES.FORBIDDEN,
      'consent_records is append-only — state changes are recorded as new rows, never updates.',
    );
  }

  /** As {@link updateConsent}: the ledger is never deleted from (T29/INV-02). */
  deleteConsent(): never {
    throw new DomainException(
      ERROR_CODES.FORBIDDEN,
      'consent_records is append-only — rows are never deleted.',
    );
  }

  // ──────────────────────────────────────────────────────────── internals ──

  /**
   * One atomic ledger append (LLD §Transaction boundary): INSERT the new row,
   * point the prior grant's `superseded_by` at it (grants only), re-derive
   * `leads.consent_status` via the sole writer, append the audit intent and —
   * for withdrawals — the `CONSENT_WITHDRAWN` outbox event. One UnitOfWork tx;
   * any failure rolls the whole capture back.
   */
  private async appendConsent(
    input: AppendConsentInput & { customerProfileId?: string | null },
  ): Promise<{ row: ConsentRecordRow; derived: ConsentStatus }> {
    return this.uow.run(async (tx) => {
      const { lead } = input;

      // 4d. Find the grant this one supersedes BEFORE inserting the new row.
      const priorGrant =
        input.state === ConsentState.GRANTED
          ? await this.repo.findLatestOpenGrant(lead.lead_id, lead.org_id, input.purpose, tx)
          : undefined;

      // 4e. Append the new ledger row (INSERT only).
      const newConsentId = randomUUID();
      const record: NewConsentRecord = {
        consent_id: newConsentId,
        org_id: lead.org_id,
        lead_id: lead.lead_id,
        customer_profile_id: input.customerProfileId ?? lead.customer_profile_id,
        purpose: input.purpose,
        data_category: input.dataCategory ?? null,
        state: input.state,
        channel: input.channel,
        language: input.language ?? null,
        notice_version: input.noticeVersion,
        consent_text_version: input.consentTextVersion,
        actor: input.actor,
        ip_device: input.ipDevice,
        expires_at: input.expiresAt,
      };
      const row = await this.repo.insert(record, tx);

      // 4d (write half). Mark the prior grant superseded — pointer only, after
      // the new row exists (`superseded_by` FK references it).
      if (priorGrant) {
        await this.repo.markSuperseded(priorGrant.consent_id, newConsentId, lead.org_id, tx);
      }

      // 4f. Re-derive leads.consent_status inside the same tx (sole writer).
      const latest = await this.repo.findLatestPerPurpose(lead.lead_id, lead.org_id, tx);
      const derived = deriveConsentStatus(latest);
      await this.leads.setConsentStatus(lead.lead_id, derived, lead.org_id, tx);

      // 4g. Audit intent — same tx. `consent_grant` covers granted/denied
      // captures; `consent_withdraw` covers withdrawals (audit_action enum —
      // the LLD's literal 'CONSENT_CAPTURED' is not an enum value; see
      // AMBIGUITY.md §FR-110-1). detail carries no PII.
      await this.audit.append(
        {
          action:
            input.state === ConsentState.WITHDRAWN
              ? AuditAction.CONSENT_WITHDRAW
              : AuditAction.CONSENT_GRANT,
          entity_type: CONSENT_RECORDS_RESOURCE_TYPE,
          entity_id: newConsentId,
          actor_id: input.auditActorId,
          org_id: lead.org_id,
          lead_id: lead.lead_id,
          detail: { purpose: input.purpose, state: input.state },
          ipDevice: input.auditIpDevice,
        },
        tx,
      );

      // 4h. Withdrawal event — same tx (LLD: payload { lead_id, purpose }).
      if (input.state === ConsentState.WITHDRAWN) {
        await this.outbox.emit(
          {
            event_code: EventCode.CONSENT_WITHDRAWN,
            aggregate_type: 'leads',
            aggregate_id: lead.lead_id,
            payload: { lead_id: lead.lead_id, purpose: input.purpose },
          },
          tx,
        );
      }

      return { row, derived };
    });
  }

  /** Load the lead (404 when absent) and enforce the ABAC scope (403). */
  private async loadLeadInScope(
    leadId: string,
    orgId: string,
    predicate: ScopePredicate | undefined,
  ): Promise<LeadConsentContext> {
    const lead = await this.repo.findLeadConsentContext(leadId, orgId);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!leadInScope(lead, predicate)) {
      // Out-of-scope lead → FORBIDDEN for every role, PARTNER included
      // (FR-110 LLD §Error Cases; FR-110-tests T10/T11/T17).
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    return lead;
  }

  /** Reject the system-managed states on any API capture path (LLD step 4b). */
  private assertWritableState(state: ConsentState): void {
    if (state === ConsentState.EXPIRED || state === ConsentState.SUPERSEDED) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [
          {
            field: 'state',
            issue:
              "state must be 'granted', 'denied' or 'withdrawn' — 'expired' and 'superseded' are system-managed.",
          },
        ],
      });
    }
  }
}

/** Lead-in-scope per the AbacGuard-resolved predicate (FR-002 contract). */
export function leadInScope(
  lead: LeadConsentContext,
  predicate: ScopePredicate | undefined,
): boolean {
  if (!predicate) {
    return false;
  }
  switch (predicate.type) {
    case 'own':
      return lead.owner_id !== null && lead.owner_id === predicate.userId;
    case 'team':
      return lead.owner_id !== null && predicate.userIds.includes(lead.owner_id);
    case 'branch':
      return lead.branch_id !== null && lead.branch_id === predicate.branchId;
    case 'region':
      return lead.branch_id !== null && predicate.branchIds.includes(lead.branch_id);
    case 'all':
    case 'masked':
      return lead.org_id === predicate.orgId;
    case 'partner':
      return lead.partner_id !== null && lead.partner_id === predicate.partnerId;
    case 'customer_token':
      return lead.lead_id === predicate.leadId;
    default:
      return false;
  }
}

/** Audit `ip_device` column shape (FR-001/FR-010 convention). */
function toAuditIpDevice(meta: ClientMeta): { ip?: string; user_agent?: string } | null {
  if (!meta.ip && !meta.userAgent) {
    return null;
  }
  return {
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { user_agent: meta.userAgent } : {}),
  };
}

/** Map a row to the wire item, masking `ip_device` for non-DPO/ADMIN callers. */
function toListItem(row: ConsentRecordRow, ipDeviceVisible: boolean): ConsentListItem {
  return {
    consent_id: row.consent_id,
    lead_id: row.lead_id,
    customer_profile_id: row.customer_profile_id,
    purpose: row.purpose,
    data_category: row.data_category,
    state: row.state,
    channel: row.channel,
    language: row.language,
    notice_version: row.notice_version,
    consent_text_version: row.consent_text_version,
    actor: row.actor,
    ip_device: ipDeviceVisible ? row.ip_device : null,
    expires_at: row.expires_at,
    superseded_by: row.superseded_by,
    created_at: row.created_at,
  };
}
