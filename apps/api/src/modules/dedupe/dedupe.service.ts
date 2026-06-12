import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import {
  AuditAction,
  DupAction,
  DupRecordStatus,
  DupStatus,
  ERROR_CODES,
  EventCode,
  MatchConfidence,
  type LeadStage,
  type ScopePredicate,
} from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { KYSELY, UnitOfWork, type DbTransaction, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { OutboxService } from '../../core/outbox';
import {
  LEADS_RESOURCE_TYPE,
  SYSTEM_ACTOR_ID,
  TERMINAL_LEAD_STAGES,
} from '../capture/capture.constants';
import { LeadService } from '../capture/lead.service';
import type {
  DuplicateProbeIdentity,
  DuplicateSyncResult,
} from '../capture/ports/duplicate-check.port';
import { OVERRIDE_ROLES, QUEUE_ROLES } from './dedupe.constants';
import { DuplicateBlockedException } from './dedupe.errors';
import {
  DedupeRepository,
  type CandidateLeadRow,
  type DedupeLeadContext,
} from './dedupe.repository';
import type { DuplicateCheckDto, RequestedDuplicateAction } from './dto/duplicate-check.dto';
import type {
  DuplicateCheckResponseDto,
  DuplicateMatchResponseDto,
} from './dto/duplicate-match.dto';

// ─────────────────────────── BRD default-match table (constants — D4) ───────

/** Which key-match query found a candidate (LLD §Step 2's five groups). */
export type MatchKeyHit = 'pan' | 'mobile' | 'ckyc' | 'gstin' | 'fuzzy';

/** A candidate lead with the set of key queries that matched it. */
export interface CandidateWithHits {
  row: CandidateLeadRow;
  hits: ReadonlySet<MatchKeyHit>;
}

/** One scored match after rule evaluation + merged-master resolution. */
export interface ScoredMatch {
  matched_lead_id: string;
  matched_lead_code: string;
  confidence: MatchConfidence;
  /** The table's DEFAULT action for this match (blocked | warned). */
  action: DupAction;
  matched_on: string[];
  stage: LeadStage;
  name: string | null;
  mobile: string | null;
  pan_masked: string | null;
}

interface MatchRule {
  applies: (hits: ReadonlySet<MatchKeyHit>) => boolean;
  confidence: MatchConfidence;
  action: DupAction;
  matchedOn: readonly string[];
}

/**
 * FR-020 LLD §Confidence Scoring Rules, hardcoded per AMBIGUITIES.md D4.
 * Vehicle/asset identifiers are Phase 1.5 (A5) — `gstin`+`product_code` is the
 * MVP business-asset proxy (medium/warn, T05/T28). A same-mobile candidate not
 * confirmed by a same-PAN hit scores medium/warn — this covers the table's
 * "same mobile, no PAN on either" row (T03) and, conservatively, the
 * unlisted PAN-differs/PAN-on-one-side variants (see AMBIGUITY.md §FR-020-1).
 */
const MATCH_RULES: readonly MatchRule[] = [
  {
    applies: (h) => h.has('ckyc'),
    confidence: MatchConfidence.STRONG,
    action: DupAction.BLOCKED,
    matchedOn: ['ckyc_id'],
  },
  {
    applies: (h) => h.has('pan') && h.has('mobile'),
    confidence: MatchConfidence.STRONG,
    action: DupAction.BLOCKED,
    matchedOn: ['pan_token', 'mobile'],
  },
  {
    applies: (h) => h.has('pan') && !h.has('mobile'),
    confidence: MatchConfidence.STRONG,
    action: DupAction.WARNED,
    matchedOn: ['pan_token'],
  },
  {
    applies: (h) => h.has('mobile') && !h.has('pan'),
    confidence: MatchConfidence.MEDIUM,
    action: DupAction.WARNED,
    matchedOn: ['mobile'],
  },
  {
    applies: (h) => h.has('gstin'),
    confidence: MatchConfidence.MEDIUM,
    action: DupAction.WARNED,
    matchedOn: ['gstin', 'product_code'],
  },
  {
    applies: (h) => h.has('fuzzy'),
    confidence: MatchConfidence.WEAK,
    action: DupAction.WARNED,
    matchedOn: ['name', 'pin_code', 'source'],
  },
];

const CONFIDENCE_RANK: Readonly<Record<MatchConfidence, number>> = {
  [MatchConfidence.STRONG]: 3,
  [MatchConfidence.MEDIUM]: 2,
  [MatchConfidence.WEAK]: 1,
};

/** Severity of the table's default actions (block outranks warn on a tie). */
const DEFAULT_ACTION_RANK: Readonly<Partial<Record<DupAction, number>>> = {
  [DupAction.BLOCKED]: 2,
  [DupAction.WARNED]: 1,
};

/** Canonical `matched_on` ordering (stable across rule unions). */
const MATCHED_ON_ORDER: readonly string[] = [
  'pan_token',
  'mobile',
  'ckyc_id',
  'gstin',
  'product_code',
  'name',
  'pin_code',
  'source',
];

// ───────────────────────────── pure scoring engine (unit-tested T01–T10) ────

/** Merge per-key query results into one candidate set with accumulated hits. */
export function collectCandidates(
  groups: ReadonlyArray<readonly [MatchKeyHit, readonly CandidateLeadRow[]]>,
): CandidateWithHits[] {
  const byLead = new Map<string, { row: CandidateLeadRow; hits: Set<MatchKeyHit> }>();
  for (const [key, rows] of groups) {
    for (const row of rows) {
      const existing = byLead.get(row.lead_id);
      if (existing) {
        existing.hits.add(key);
      } else {
        byLead.set(row.lead_id, { row, hits: new Set([key]) });
      }
    }
  }
  return [...byLead.values()];
}

function tierOutranks(a: { confidence: MatchConfidence; action: DupAction }, b: { confidence: MatchConfidence; action: DupAction }): boolean {
  const confidenceDiff = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
  if (confidenceDiff !== 0) return confidenceDiff > 0;
  return (DEFAULT_ACTION_RANK[a.action] ?? 0) > (DEFAULT_ACTION_RANK[b.action] ?? 0);
}

/**
 * LLD §Backend Flow step 7 — score every candidate against the match table,
 * resolve merged masters (a matched lead with `master_lead_id` points to its
 * master, inheriting the computed confidence — T08), drop self-references
 * (`ck_dup_distinct`) and de-duplicate by matched lead keeping the highest
 * confidence. Result is sorted strongest-first; the head drives the action.
 */
export function scoreAndRank(
  candidates: readonly CandidateWithHits[],
  subjectLeadId: string | null,
): ScoredMatch[] {
  const byMatchedLead = new Map<string, ScoredMatch>();

  for (const candidate of candidates) {
    const applied = MATCH_RULES.filter((rule) => rule.applies(candidate.hits));
    if (applied.length === 0) {
      continue;
    }
    let top = applied[0];
    for (const rule of applied) {
      if (tierOutranks(rule, top)) {
        top = rule;
      }
    }
    const tierKeys = new Set(
      applied
        .filter((rule) => rule.confidence === top.confidence && rule.action === top.action)
        .flatMap((rule) => [...rule.matchedOn]),
    );
    const matchedOn = MATCHED_ON_ORDER.filter((key) => tierKeys.has(key));

    // Merged-master resolution: point at the master when it is still live.
    const { master_lead_id: masterId, master_lead_code: masterCode } = candidate.row;
    const target =
      masterId !== null && masterCode !== null
        ? { id: masterId, code: masterCode }
        : { id: candidate.row.lead_id, code: candidate.row.lead_code };
    if (target.id === subjectLeadId) {
      continue; // never record a self-pair (ck_dup_distinct)
    }

    const scored: ScoredMatch = {
      matched_lead_id: target.id,
      matched_lead_code: target.code,
      confidence: top.confidence,
      action: top.action,
      matched_on: matchedOn,
      stage: candidate.row.stage,
      name: candidate.row.name,
      mobile: candidate.row.mobile,
      pan_masked: candidate.row.pan_masked,
    };
    const existing = byMatchedLead.get(target.id);
    if (!existing || tierOutranks(scored, existing)) {
      byMatchedLead.set(target.id, scored);
    }
  }

  return [...byMatchedLead.values()].sort((a, b) => {
    if (tierOutranks(a, b)) return -1;
    if (tierOutranks(b, a)) return 1;
    return a.matched_lead_code.localeCompare(b.matched_lead_code);
  });
}

/**
 * LLD §Backend Flow step 8 — the action applied to all open match rows. The
 * highest-confidence match's default action wins (T07); a strong block yields
 * only to an authorised `override` (role-checked before this is called); other
 * requested actions map directly. Caller guarantees `matches` is non-empty.
 */
export function resolveAction(
  matches: readonly ScoredMatch[],
  requested: RequestedDuplicateAction | undefined,
): DupAction {
  const defaultAction = matches[0].action;
  if (requested === undefined) {
    return defaultAction;
  }
  if (requested === 'override') {
    return DupAction.OVERRIDDEN;
  }
  if (defaultAction === DupAction.BLOCKED) {
    return DupAction.BLOCKED; // only override clears a strong block
  }
  switch (requested) {
    case 'block':
      return DupAction.BLOCKED;
    case 'queue':
      return DupAction.QUEUED;
    case 'link':
      return DupAction.LINKED;
    case 'warn':
      return DupAction.WARNED;
  }
}

// ───────────────────────────────────────────────────────── service proper ──

/** ABAC grant context forwarded by the controller (set by AbacGuard). */
export interface DedupeScopeContext {
  predicate?: ScopePredicate;
}

interface PersistOutcome {
  matchIds: Map<string, string>;
  duplicateStatus: DupStatus;
  changed: boolean;
}

/**
 * FR-020 — `DuplicateService` (M3, shared-utilities.md pinned domain service):
 * real-time duplicate & near-duplicate detection. Owns all `duplicate_matches`
 * writes (via {@link DedupeRepository}); `leads.duplicate_status` is recomputed
 * exclusively through `LeadService.recomputeDuplicateStatus` (sole writer,
 * §11.2). Three entry points:
 *
 *  - {@link match}  — FR-010 intake gate (sync, inside the capture tx; throws
 *    {@link DuplicateBlockedException} on a strong block — T30);
 *  - {@link scan}   — post-commit full scan (capture's async hook; persists
 *    table-default actions as the system actor);
 *  - {@link check}  — `POST /leads/{id}/duplicate-check` (on-demand re-check
 *    with optional requested action / BM-SM override).
 */
@Injectable()
export class DuplicateService {
  constructor(
    @Inject(KYSELY) private readonly db: KyselyDb,
    private readonly uow: UnitOfWork,
    private readonly repo: DedupeRepository,
    private readonly leads: LeadService,
    private readonly audit: AuditAppender,
    private readonly outbox: OutboxService,
    @InjectPinoLogger(DuplicateService.name) private readonly logger: PinoLogger,
  ) {}

  // ───────────────────────────── intake gate (FR-010 step 5f, via the port) ──

  /**
   * Synchronous strong-block pre-check run INSIDE the capture transaction,
   * BEFORE the lead row exists. Only the identity keys available at capture
   * (mobile / PAN) are probed — CKYC/GSTIN arrive later in the lifecycle and
   * the weak fuzzy signal never blocks; {@link scan} covers them post-commit.
   * Throws {@link DuplicateBlockedException} when the table resolves `blocked`.
   */
  async match(
    identity: DuplicateProbeIdentity,
    orgId: string,
    tx: DbTransaction,
  ): Promise<DuplicateSyncResult> {
    const panToken = identity.pan_token ?? null;
    const [byMobile, byPan] = await Promise.all([
      this.repo.findByMobile(identity.mobile, orgId, null, tx),
      panToken !== null ? this.repo.findByPan(panToken, orgId, null, tx) : Promise.resolve([]),
    ]);
    const scored = scoreAndRank(
      collectCandidates([
        ['mobile', byMobile],
        ['pan', byPan],
      ]),
      null,
    );
    if (scored.length > 0 && scored[0].action === DupAction.BLOCKED) {
      throw new DuplicateBlockedException(scored);
    }
    return { blocked: false, matches: scored.map(toPortSummary) };
  }

  // ──────────────────────────── post-commit scan (FR-010 step 5j, async) ──

  /**
   * Full five-key scan of an existing lead, persisting the table-default
   * outcome as the system actor (medium/weak matches flag the lead that the
   * sync gate deliberately let through). Never throws into the caller's
   * response path — the adapter wraps it; a missing/terminal lead is a no-op.
   */
  async scan(leadId: string): Promise<void> {
    const lead = await this.repo.findLeadContext(leadId, null, this.db);
    if (!lead) {
      this.logger.warn({ lead_id: leadId }, 'Duplicate scan skipped: lead not found');
      return;
    }
    if (TERMINAL_LEAD_STAGES.includes(lead.stage)) {
      return; // nothing to act on for a closed lead
    }
    const scored = await this.findMatchesFor(lead);
    if (scored.length === 0) {
      return; // no candidates — duplicate_status untouched (T11 analogue)
    }
    const action = resolveAction(scored, undefined);
    await this.uow.run(async (tx) => {
      await this.persist(lead, scored, action, { actorId: SYSTEM_ACTOR_ID, overrideReason: null }, tx);
    });
    this.logger.info(
      { lead_id: leadId, match_count: scored.length, action, metric: 'dedupe.scan_flagged' },
      'Duplicate scan recorded open matches',
    );
  }

  // ────────────────────── on-demand re-check (POST /leads/{id}/duplicate-check) ──

  /**
   * LLD §Backend Flow steps 3–11. The AbacGuard has already verified
   * `edit_lead`; row-level scope is enforced here against the guard's resolved
   * predicate (T17/T25/T26). A resolved `blocked` action without an authorised
   * override raises the contract 409 BEFORE any write (T13 — status unchanged);
   * everything else persists atomically in one UnitOfWork transaction.
   */
  async check(
    leadId: string,
    dto: DuplicateCheckDto,
    user: AuthUser,
    scope: DedupeScopeContext,
  ): Promise<DuplicateCheckResponseDto> {
    const lead = await this.repo.findLeadContext(leadId, user.orgId, this.db);
    if (!lead) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (!leadInScope(lead, scope.predicate)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    if (TERMINAL_LEAD_STAGES.includes(lead.stage)) {
      throw new DomainException(
        ERROR_CODES.VALIDATION_ERROR,
        'Duplicate check cannot be run on a terminal lead.',
      );
    }
    if (dto.requested_action === 'override' && !OVERRIDE_ROLES.includes(user.role)) {
      await this.auditOverrideDenied(user, lead.lead_id);
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    if (dto.requested_action === 'queue' && !QUEUE_ROLES.includes(user.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const scored = await this.findMatchesFor(lead);
    if (scored.length === 0) {
      // LLD: no match → duplicate_status=none, action=none, nothing written (T11).
      return { lead_id: lead.lead_id, duplicate_status: DupStatus.NONE, action_taken: null, matches: [] };
    }

    const action = resolveAction(scored, dto.requested_action);
    if (action === DupAction.BLOCKED) {
      throw new DuplicateBlockedException(scored); // 409 pre-transaction; no writes (T13)
    }

    const overrideReason =
      action === DupAction.OVERRIDDEN ? (dto.override_reason ?? '').trim() : null;

    return this.uow.run(async (tx) => {
      const outcome = await this.persist(
        lead,
        scored,
        action,
        { actorId: user.userId, overrideReason },
        tx,
      );
      return {
        lead_id: lead.lead_id,
        duplicate_status: outcome.duplicateStatus,
        action_taken: action,
        matches: scored.map(
          (m): DuplicateMatchResponseDto => ({
            duplicate_match_id: outcome.matchIds.get(m.matched_lead_id) ?? null,
            matched_lead_id: m.matched_lead_id,
            matched_lead_code: m.matched_lead_code,
            confidence: m.confidence,
            matched_on: m.matched_on,
            action,
            status: DupRecordStatus.OPEN,
            stage: m.stage,
            name: m.name,
            mobile: m.mobile,
            pan_masked: m.pan_masked,
          }),
        ),
      };
    });
  }

  // ───────────────────────────────────────────────────────────── internals ──

  /** LLD §Step 2 — the five key-match queries in parallel, each LIMIT-capped. */
  private async findMatchesFor(lead: DedupeLeadContext): Promise<ScoredMatch[]> {
    const [byPan, byMobile, byCkyc, byGstin, byFuzzy] = await Promise.all([
      lead.pan_token !== null
        ? this.repo.findByPan(lead.pan_token, lead.org_id, lead.lead_id, this.db)
        : Promise.resolve([]),
      this.repo.findByMobile(lead.mobile, lead.org_id, lead.lead_id, this.db),
      lead.ckyc_id !== null
        ? this.repo.findByCkyc(lead.ckyc_id, lead.org_id, lead.lead_id, this.db)
        : Promise.resolve([]),
      lead.gstin !== null
        ? this.repo.findByGstin(lead.gstin, lead.product_code, lead.org_id, lead.lead_id, this.db)
        : Promise.resolve([]),
      lead.pin_code !== null && lead.source !== null
        ? this.repo.findByFuzzyName(
            lead.name,
            lead.pin_code,
            lead.source,
            lead.org_id,
            lead.lead_id,
            this.db,
          )
        : Promise.resolve([]),
    ]);
    return scoreAndRank(
      collectCandidates([
        ['pan', byPan],
        ['mobile', byMobile],
        ['ckyc', byCkyc],
        ['gstin', byGstin],
        ['fuzzy', byFuzzy],
      ]),
      lead.lead_id,
    );
  }

  /**
   * LLD §Backend Flow step 9 — the atomic write set: `duplicate_matches`
   * upsert, `leads.duplicate_status` recompute (LeadService, optimistic lock),
   * and — only when the open-match picture actually changed (idempotent
   * re-check, T23/INV-07) — `audit_logs` + the `DUPLICATE_FLAGGED` outbox
   * event, all in the SAME transaction.
   */
  private async persist(
    lead: DedupeLeadContext,
    scored: readonly ScoredMatch[],
    action: DupAction,
    actor: { actorId: string; overrideReason: string | null },
    tx: DbTransaction,
  ): Promise<PersistOutcome> {
    const isOverride = action === DupAction.OVERRIDDEN;
    const existing = await this.repo.findExistingMatches(
      lead.lead_id,
      scored.map((m) => m.matched_lead_id),
      lead.org_id,
      tx,
    );
    const changed = scored.some((m) => {
      const prev = existing.get(m.matched_lead_id);
      return (
        !prev ||
        prev.action !== action ||
        prev.confidence !== m.confidence ||
        prev.status !== DupRecordStatus.OPEN
      );
    });

    const matchIds = await this.repo.upsertMatches(
      scored.map((m) => ({
        org_id: lead.org_id,
        lead_id: lead.lead_id,
        matched_lead_id: m.matched_lead_id,
        confidence: m.confidence,
        matched_on: m.matched_on,
        action,
        action_by: isOverride ? actor.actorId : null,
        action_reason: isOverride ? actor.overrideReason : null,
        actor_id: actor.actorId,
      })),
      tx,
    );

    const duplicateStatus = await this.leads.recomputeDuplicateStatus(
      lead.lead_id,
      lead.org_id,
      actor.actorId,
      lead.version,
      tx,
    );

    if (changed) {
      const top = scored[0];
      await this.audit.append(
        {
          action: isOverride ? AuditAction.LEAD_OVERRIDE : AuditAction.LEAD_UPDATE,
          entity_type: LEADS_RESOURCE_TYPE,
          entity_id: lead.lead_id,
          actor_id: actor.actorId,
          org_id: lead.org_id,
          lead_id: lead.lead_id,
          detail: {
            fr: 'FR-020',
            action_taken: action,
            confidence: top.confidence,
            match_count: scored.length,
            override_reason: actor.overrideReason,
            // key NAMES only — never raw PII values in audit detail
            matched_on: top.matched_on,
          },
        },
        tx,
      );
      await this.outbox.emit(
        {
          event_code: EventCode.DUPLICATE_FLAGGED,
          aggregate_type: LEADS_RESOURCE_TYPE,
          aggregate_id: lead.lead_id,
          payload: {
            lead_id: lead.lead_id,
            duplicate_status: duplicateStatus,
            action,
            confidence: top.confidence,
            match_count: scored.length,
          },
        },
        tx,
      );
    }

    return { matchIds, duplicateStatus, changed };
  }

  /** LLD §Auth — a denied override attempt is itself audited (never PII). */
  private async auditOverrideDenied(user: AuthUser, leadId: string): Promise<void> {
    try {
      await this.audit.append({
        action: AuditAction.ABAC_DENY,
        entity_type: LEADS_RESOURCE_TYPE,
        entity_id: leadId,
        actor_id: user.userId,
        org_id: user.orgId,
        lead_id: leadId,
        detail: {
          denied: true,
          fr: 'FR-020',
          capability: 'edit_lead',
          requested_action: 'override',
          reason: 'override_requires_bm_sm',
        },
      });
    } catch (cause) {
      // The 403 is the authoritative outcome; an audit-store failure must not
      // convert it into a 500 — log loudly and continue throwing FORBIDDEN.
      this.logger.error({ err: cause, lead_id: leadId }, 'Failed to audit denied duplicate override');
    }
  }
}

/**
 * Row-level scope per the AbacGuard predicate (LLD §Auth: RM=O own, SM=T team,
 * BM/KYC=B branch, HEAD=A all; CORRECTIONS §FR-052 pins T to team-member
 * owner_ids). Any other predicate (masked/partner/customer) is outside this
 * endpoint's contract → deny.
 */
export function leadInScope(
  lead: { owner_id: string | null; branch_id: string | null },
  predicate: ScopePredicate | undefined,
): boolean {
  if (!predicate) return false;
  switch (predicate.type) {
    case 'own':
      return lead.owner_id !== null && lead.owner_id === predicate.userId;
    case 'team':
      return lead.owner_id !== null && predicate.userIds.includes(lead.owner_id);
    case 'branch':
      return lead.branch_id !== null && lead.branch_id === predicate.branchId;
    case 'all':
      return true;
    default:
      return false;
  }
}

/** Map a scored match to the frozen `DuplicateCheckPort` summary shape. */
export function toPortSummary(m: ScoredMatch): {
  lead_id: string;
  lead_code: string;
  confidence: MatchConfidence;
  matched_on: string[];
} {
  return {
    lead_id: m.matched_lead_id,
    lead_code: m.matched_lead_code,
    confidence: m.confidence,
    matched_on: m.matched_on,
  };
}
