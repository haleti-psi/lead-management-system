import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES, type ScopePredicate } from '@lms/shared';

import { DomainException } from '../../core/http';
import { PartnerRepository, type PartnerRow } from './partner.repository';
import { PartnerQualityRepository } from './partner-quality.repository';
import { PARTNER_QUALITY_MIN_VOLUME, QUALITY_FACTOR_WEIGHTS } from './partner.constants';
import type { PartnerQualityQuery } from './dto/partner-quality-query.dto';

export interface PartnerQualityActor {
  userId: string;
  orgId: string;
  predicate: ScopePredicate | undefined;
}

interface QualityFactors {
  contactability_index: number | null;
  duplicate_penalty: number | null;
  rejection_penalty: number | null;
  handoff_index: number | null;
  document_quality_index: number | null;
  speed_index: number | null;
}

export interface PartnerQualityData {
  partner_id: string;
  partner_code: string;
  legal_name: string;
  type: string;
  status: string;
  quality_score: number | null;
  insufficient_data: boolean;
  window: { from: string; to: string };
  metrics: {
    total_leads: number;
    contactable_leads: number;
    duplicate_leads: number;
    rejected_leads: number;
    handed_off_leads: number;
    uploaded_docs: number;
    verified_docs_first_time: number;
    kyc_mismatch_leads: number;
  };
  factors: QualityFactors;
  factor_weights: typeof QUALITY_FACTOR_WEIGHTS;
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

/**
 * FR-092 — partner quality score (§12.4). Scope-gated aggregate read over the
 * partner's leads/docs/kyc within a window, six weighted factors (null on a zero
 * denominator — BRD §12.5), clamped to [0,100], cached to `partners.quality_score`
 * (best-effort). PARTNER sees own; BM/SM/HEAD (+ KYC/DPO per the matrix) by scope.
 */
@Injectable()
export class PartnerQualityService {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly repo: PartnerQualityRepository,
    @InjectPinoLogger(PartnerQualityService.name) private readonly logger: PinoLogger,
  ) {}

  async compute(
    actor: PartnerQualityActor,
    partnerId: string,
    query: PartnerQualityQuery,
  ): Promise<PartnerQualityData> {
    const partner = await this.partners.findById(partnerId, actor.orgId);
    if (!partner) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!partnerInScope(partner, actor.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const { fromStr, toStr, fromTs, toTs } = resolveWindow(query);

    const [leadCounts, docCounts, kycMismatch, thisTat, allMinTat] = await Promise.all([
      this.repo.getLeadCounts(actor.orgId, partnerId, fromTs, toTs),
      this.repo.getDocCounts(actor.orgId, partnerId, fromTs, toTs),
      this.repo.getKycMismatchLeads(actor.orgId, partnerId, fromTs, toTs),
      this.repo.getThisPartnerAvgTatHours(actor.orgId, partnerId, fromTs, toTs),
      this.repo.getAllPartnersMinAvgTatHours(actor.orgId, fromTs, toTs),
    ]);

    const insufficient = leadCounts.total_leads < PARTNER_QUALITY_MIN_VOLUME;

    const factors: QualityFactors = insufficient
      ? {
          contactability_index: null,
          duplicate_penalty: null,
          rejection_penalty: null,
          handoff_index: null,
          document_quality_index: null,
          speed_index: null,
        }
      : {
          contactability_index: pct(leadCounts.contactable_leads, leadCounts.total_leads),
          duplicate_penalty: pct(leadCounts.duplicate_leads, leadCounts.total_leads),
          rejection_penalty: pct(leadCounts.rejected_leads, leadCounts.total_leads),
          handoff_index: pct(leadCounts.handed_off_leads, leadCounts.total_leads),
          document_quality_index: pct(docCounts.verified_docs_first_time, docCounts.uploaded_docs),
          speed_index: speedIndex(allMinTat, thisTat),
        };

    const score = insufficient ? null : computeScore(factors);

    if (score != null) {
      try {
        await this.repo.updateQualityScore(partnerId, actor.orgId, score, actor.userId);
      } catch {
        this.logger.warn({ partner_id: partnerId }, 'quality_score cache write failed (response unaffected)');
      }
    }

    return {
      partner_id: partner.partner_id,
      partner_code: partner.partner_code,
      legal_name: partner.legal_name,
      type: partner.type,
      status: partner.status,
      quality_score: score,
      insufficient_data: insufficient,
      window: { from: fromStr, to: toStr },
      metrics: {
        total_leads: leadCounts.total_leads,
        contactable_leads: leadCounts.contactable_leads,
        duplicate_leads: leadCounts.duplicate_leads,
        rejected_leads: leadCounts.rejected_leads,
        handed_off_leads: leadCounts.handed_off_leads,
        uploaded_docs: docCounts.uploaded_docs,
        verified_docs_first_time: docCounts.verified_docs_first_time,
        kyc_mismatch_leads: kycMismatch,
      },
      factors,
      factor_weights: QUALITY_FACTOR_WEIGHTS,
    };
  }
}

/** Partner-scope check from the AbacGuard `reports` predicate (RM `own` → denied). */
function partnerInScope(partner: PartnerRow, predicate: ScopePredicate | undefined): boolean {
  if (!predicate) return false;
  switch (predicate.type) {
    case 'partner':
      return partner.partner_id === predicate.partnerId;
    case 'branch':
      return partner.branch_id !== null && partner.branch_id === predicate.branchId;
    case 'region':
      return partner.branch_id !== null && predicate.branchIds.includes(partner.branch_id);
    case 'team':
      return partner.mapped_rm_id !== null && predicate.userIds.includes(partner.mapped_rm_id);
    case 'all':
    case 'masked':
      return partner.org_id === predicate.orgId; // org-wide (quality payload has no PII)
    default:
      return false; // 'own' (RM), 'customer_token' → no partner access
  }
}

/** `n/d * 100` rounded to 2 dp; null when the denominator is 0 (BRD §12.5). */
function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.round((n / d) * 10000) / 100;
}

/** speed_index = min(all-partner avg TAT) / this-partner avg TAT * 100, capped 100. */
function speedIndex(minTat: number | null, thisTat: number | null): number | null {
  if (minTat == null || thisTat == null || thisTat <= 0) return null;
  return Math.round(Math.min(100, (minTat / thisTat) * 100) * 100) / 100;
}

/** §12.4 weighted sum (null factor → 0 contribution), clamped to [0,100], rounded. */
function computeScore(f: QualityFactors): number {
  const w = QUALITY_FACTOR_WEIGHTS;
  const raw =
    w.contactability_index * (f.contactability_index ?? 0) +
    w.handoff_index * (f.handoff_index ?? 0) +
    w.document_quality_index * (f.document_quality_index ?? 0) +
    w.speed_index * (f.speed_index ?? 0) +
    w.duplicate_penalty * (f.duplicate_penalty ?? 0) +
    w.rejection_penalty * (f.rejection_penalty ?? 0);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/** Resolve the scoring window — explicit from/to or a rolling 30-day window (UTC). */
function resolveWindow(query: PartnerQualityQuery): {
  fromStr: string;
  toStr: string;
  fromTs: Date;
  toTs: Date;
} {
  const toStr = query.to ?? new Date().toISOString().slice(0, 10);
  const fromStr = query.from ?? new Date(Date.now() - (WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  return {
    fromStr,
    toStr,
    fromTs: new Date(`${fromStr}T00:00:00.000Z`),
    toTs: new Date(`${toStr}T23:59:59.999Z`),
  };
}
