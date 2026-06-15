import { Injectable } from '@nestjs/common';

import {
  CreationChannel,
  ERROR_CODES,
  LeadSource,
  type PaginationMeta,
  RoleCode,
} from '@lms/shared';

import { DomainException } from '../../core/http';
import { CaptureService, type CreateLeadContext, type RequestMeta } from '../capture/capture.service';
import type { CreateLeadDto } from '../capture/dto/create-lead.dto';
import { PartnerRepository } from './partner.repository';
import { PartnerLeadRepository } from './partner-lead.repository';
import type { ListPartnerLeadsQuery, PartnerLeadCreateDto } from './dto/partner-lead-create.dto';

/** Create-response view (masked; PARTNER projection — no internal columns). */
export interface PartnerLeadCreateView {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  consent_status: string;
  kyc_status: string;
  duplicate_status: string;
  name_masked: string | null;
  mobile_masked: string | null;
}

/** List-row view (masked; limited status only — AC2). */
export interface PartnerLeadView {
  lead_id: string;
  lead_code: string;
  stage: string;
  product_code: string;
  duplicate_status: string;
  name_masked: string;
  mobile_masked: string;
  created_at: Date;
}

export interface PartnerLeadActor {
  userId: string;
  orgId: string;
  partnerId: string;
  requestMeta: RequestMeta;
}

/**
 * FR-091 — partner lead submission (M10). A partner-scoped facade over the FR-010
 * capture pipeline: it gates the partner (active/valid), forces the source to the
 * partner channel, and delegates to {@link CaptureService.createLead} — which owns
 * the atomic identity+attribution+lead+dedupe+audit+outbox write, the PARTNER
 * cross-partner check, and Idempotency-Key replay. The partner can only ever
 * submit/list under their OWN `partner_id`.
 */
@Injectable()
export class PartnerLeadService {
  constructor(
    private readonly capture: CaptureService,
    private readonly partners: PartnerRepository,
    private readonly repo: PartnerLeadRepository,
  ) {}

  async submit(
    actor: PartnerLeadActor,
    dto: PartnerLeadCreateDto,
    idempotencyKey: string | undefined,
  ): Promise<PartnerLeadCreateView> {
    // Partner-active gate (FR-090 status + validity) → FORBIDDEN, no internals leaked.
    // valid_until is a DATE: expired iff strictly before today (not before "now").
    const today = new Date();
    const startOfTodayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const partner = await this.partners.findById(actor.partnerId, actor.orgId);
    if (
      !partner ||
      partner.status !== 'active' ||
      (partner.valid_until != null && new Date(`${partner.valid_until}`).getTime() < startOfTodayUtc)
    ) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const forced: CreateLeadDto = {
      product_code: dto.product_code,
      identity: dto.identity,
      // Source + partner_code FORCED from the partner; client-supplied values stripped.
      source: {
        source: partner.type === 'DSA' ? LeadSource.DSA : LeadSource.DEALER,
        partner_code: partner.partner_code,
        ...(dto.sub_source ? { sub_source: dto.sub_source } : {}),
      },
      ...(dto.pin_code ? { pin_code: dto.pin_code } : {}),
      ...(dto.requested_amount != null ? { requested_amount: dto.requested_amount } : {}),
      ...(dto.product_detail ? { product_detail: dto.product_detail } : {}),
    };

    const ctx: CreateLeadContext = {
      actorId: actor.userId,
      orgId: actor.orgId,
      actorRole: RoleCode.PARTNER,
      channel: CreationChannel.PARTNER,
      idempotencyKey,
      requestMeta: actor.requestMeta,
    };

    let result;
    try {
      result = await this.capture.createLead(forced, ctx);
    } catch (err) {
      // Strip other-customer match details from the partner-facing duplicate
      // conflict — the partner only ever sees a generic "already exists" (LLD
      // §masked CONFLICT; no matched lead_id/PII/owner).
      if (err instanceof DomainException && err.code === ERROR_CODES.CONFLICT) {
        throw new DomainException(ERROR_CODES.CONFLICT, 'A lead with these details already exists.', {
          detail: { reason: 'DUPLICATE_BLOCKED' },
        });
      }
      throw err;
    }
    const d = result.data;
    return {
      lead_id: d.lead_id,
      lead_code: d.lead_code,
      stage: d.stage,
      product_code: d.product_code,
      consent_status: d.consent_status,
      kyc_status: d.kyc_status,
      duplicate_status: d.duplicate_status,
      name_masked: d.name_masked,
      mobile_masked: d.mobile_masked,
    };
  }

  async listOwn(
    actor: { orgId: string; partnerId: string },
    query: ListPartnerLeadsQuery,
  ): Promise<{ data: PartnerLeadView[]; pagination: PaginationMeta }> {
    const params = { page: query.page, limit: query.limit, stage: query.stage, q: query.q };
    const [rows, total] = await Promise.all([
      this.repo.listOwn(actor.orgId, actor.partnerId, params),
      this.repo.countOwn(actor.orgId, actor.partnerId, params),
    ]);
    return {
      data: rows.map((r) => ({
        lead_id: r.lead_id,
        lead_code: r.lead_code,
        stage: r.stage,
        product_code: r.product_code,
        duplicate_status: r.duplicate_status,
        name_masked: maskName(r.name),
        mobile_masked: maskMobile(r.mobile),
        created_at: r.created_at,
      })),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }
}

/** `Ramesh Kumar` → `Ramesh xxxxx` (first name only). */
function maskName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return `${first} xxxxx`;
}

/** `9876543210` → `98xxxxxx10`. */
function maskMobile(mobile: string): string {
  if (mobile.length !== 10) return mobile;
  return `${mobile.slice(0, 2)}xxxxxx${mobile.slice(8)}`;
}
