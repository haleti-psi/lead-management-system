import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AuditAction, ERROR_CODES, RoleCode, type PaginationMeta } from '@lms/shared';

import { AuditAppender, AuditChainConsumer, type ChainRow } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { DomainException, readHeader, type HttpRequestLike } from '../../core/http';
import { MaskingService, REDACTED_TOKEN, type MaskableField } from '../../core/masking';
import type { AuditExplorerQueryDto } from './dto/audit-explorer-query.dto';
import type { AuditUnmaskDto } from './dto/audit-unmask.dto';
import {
  ADMIN_ALLOWED_ACTIONS,
  AUDIT_DETAIL_PII_FIELDS,
  AUDIT_DETAIL_REDACT_FIELDS,
  AUDIT_EXPLORER_ROLES,
} from './reporting.constants';
import {
  AuditExplorerRepository,
  type AuditExplorerRow,
  type AuditFilters,
} from './audit-explorer.repository';

/** A single explorer item as serialised in the response (no `ip_device`). */
export interface AuditExplorerItem {
  audit_id: string;
  actor_id: string;
  actor_display: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  lead_id: string | null;
  before_hash: string | null;
  after_hash: string | null;
  prev_audit_hash: string | null;
  detail: Record<string, unknown> | null;
  created_at: Date;
}

export type IntegrityBadge = 'intact' | 'broken' | 'not_checked';

/** The explorer payload + integrity badge + pagination meta the controller wraps. */
export interface AuditExplorerResult {
  items: AuditExplorerItem[];
  integrityBadge: IntegrityBadge;
  integrityBreakAt: string | null;
  integrityCheckedCount: number;
  pagination: PaginationMeta;
}

/** The result of a privileged single-field unmask. */
export interface AuditUnmaskResult {
  audit_id: string;
  field: string;
  /** The revealed raw value (or null when the field was absent/empty). */
  value: string | null;
}

/**
 * FR-123 — the audit explorer service (M13). Read-only: it never writes
 * `audit_logs` (append-only; sealed only by {@link AuditChainConsumer}). The one
 * write it performs is on the unmask path — an `AuditAppender.append`
 * (`break_glass_access`) recording the privileged reveal itself (security.md:
 * unmasking is always audited).
 *
 * Role gate: although `audit_trail` is held at narrower scopes by other roles,
 * the explorer surface is DPO/ADMIN-only — enforced here (a scope-O RM would pass
 * the ABAC capability check). ADMIN is further confined to system/config actions
 * with `lead_id` zeroed; DPO sees all-org rows with PII masked unless an active
 * break-glass grant authorises the raw value.
 */
@Injectable()
export class AuditExplorerService {
  constructor(
    private readonly repo: AuditExplorerRepository,
    private readonly chain: AuditChainConsumer,
    private readonly masking: MaskingService,
    private readonly audit: AuditAppender,
    private readonly logger: Logger,
  ) {}

  async search(query: AuditExplorerQueryDto, user: AuthUser): Promise<AuditExplorerResult> {
    this.assertExplorerRole(user);

    const isAdmin = user.role === RoleCode.ADMIN;

    // ADMIN may not filter by lead_id (lead content is withheld) — 403, not a
    // validation error (the field is structurally valid).
    if (isAdmin && query.lead_id != null) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const filters = this.buildFilters(query, isAdmin);
    const pagination = { page: query.page, limit: query.limit };

    const [rows, total] = await Promise.all([
      this.repo.search(filters, user.orgId, pagination),
      this.repo.count(filters, user.orgId),
    ]);

    const integrity = this.verifyChain(rows, user);

    // The explorer LIST always shows masked PII — even for a DPO holding an active
    // break-glass grant. Raw reveal is exclusively the explicit, per-field,
    // separately-audited `POST /audit/unmask` path (security.md; auth-matrix
    // `DPO.view_lead: masked unless break-glass UNMASK approved + audited`). This
    // also keeps the list consistent with the global MaskingInterceptor, which
    // re-masks scope-M (DPO) responses regardless.
    const items = rows.map((row) => this.toItem(row, { isAdmin }));

    return {
      items,
      integrityBadge: integrity.badge,
      integrityBreakAt: integrity.breakAt,
      integrityCheckedCount: integrity.checkedCount,
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  /**
   * Privileged single-field unmask (FR-003): reveal exactly ONE PII value from
   * ONE audit row's `detail`, gated on DPO/ADMIN + an active break-glass grant,
   * and audited with the supplied reason. Never bulk: one field, one record. The
   * raw value is returned to the caller but never written to logs.
   */
  async unmask(dto: AuditUnmaskDto, user: AuthUser, req?: HttpRequestLike): Promise<AuditUnmaskResult> {
    this.assertExplorerRole(user);

    // Unmasking raw PII always requires an active, four-eyes-approved break-glass
    // grant (security.md / auth-matrix `capability_conditions`).
    if (!(await this.hasActiveBreakGlass(user))) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }

    const row = await this.repo.findDetailById(dto.audit_id, user.orgId);
    if (!row) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const detail = this.parseDetail(row.detail);
    const raw = detail?.[dto.field];
    const value = typeof raw === 'string' ? raw : raw == null ? null : String(raw);

    // Audit the reveal itself BEFORE returning the value. Record who/what/why —
    // but never the revealed value (no PII in audit detail; security.md).
    await this.audit.append({
      action: AuditAction.BREAK_GLASS_ACCESS,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      actor_id: user.userId,
      org_id: user.orgId,
      lead_id: row.lead_id,
      detail: {
        op: 'audit_unmask',
        target_audit_id: dto.audit_id,
        field: dto.field,
        reason: dto.reason,
      },
      ipDevice: req ? this.ipDevice(req) : null,
    });

    return { audit_id: dto.audit_id, field: dto.field, value };
  }

  /** DPO/ADMIN-only; every other role → FORBIDDEN (403). */
  private assertExplorerRole(user: AuthUser): void {
    if (!AUDIT_EXPLORER_ROLES.has(user.role)) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
  }

  /** Compose the repository filter set, applying ADMIN's mandatory action scope. */
  private buildFilters(query: AuditExplorerQueryDto, isAdmin: boolean): AuditFilters {
    const filters: AuditFilters = {
      actor_id: query.actor_id,
      action: query.action,
      entity_type: query.entity_type,
      from: query.from,
      to: query.to,
    };
    if (isAdmin) {
      // ADMIN: forcibly restrict to system/config actions; lead_id is never sent.
      filters.actionIn = ADMIN_ALLOWED_ACTIONS;
    } else {
      filters.lead_id = query.lead_id;
    }
    return filters;
  }

  private async hasActiveBreakGlass(user: AuthUser): Promise<boolean> {
    const grant = await this.repo.findActiveBreakGlass(user.userId, user.orgId, new Date());
    return grant != null;
  }

  /**
   * Verify the hash chain across the current page window via the single source of
   * truth ({@link AuditChainConsumer.verifyWindow}). Rows arrive newest-first;
   * the verifier walks oldest→newest. A break is surfaced as a badge + the
   * offending `audit_id`, plus a `warn` log — the data is still returned (200);
   * evidence is never withheld when the chain is broken.
   */
  private verifyChain(
    rows: readonly AuditExplorerRow[],
    user: AuthUser,
  ): { badge: IntegrityBadge; breakAt: string | null; checkedCount: number } {
    const oldestFirst: ChainRow[] = [...rows].reverse().map((r) => ({
      audit_id: r.audit_id,
      org_id: user.orgId,
      actor_id: r.actor_id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      lead_id: r.lead_id,
      detail: r.detail,
      created_at: r.created_at,
      prev_audit_hash: r.prev_audit_hash,
      after_hash: r.after_hash,
    }));

    const result = this.chain.verifyWindow(oldestFirst);

    if (rows.length <= 1) {
      return { badge: 'not_checked', breakAt: null, checkedCount: rows.length };
    }
    if (!result.intact) {
      this.logger.warn(
        {
          module: 'reporting',
          event: 'audit_chain_break',
          break_at: result.breakAt,
          break_kind: result.breakKind,
          user_id: user.userId,
        },
        'Audit chain integrity break detected in explorer window',
      );
      return { badge: 'broken', breakAt: result.breakAt, checkedCount: result.checkedCount };
    }
    return { badge: 'intact', breakAt: null, checkedCount: result.checkedCount };
  }

  /** Map a DB row to a response item: zero ADMIN lead_id, mask PII in detail. */
  private toItem(row: AuditExplorerRow, opts: { isAdmin: boolean }): AuditExplorerItem {
    return {
      audit_id: row.audit_id,
      actor_id: row.actor_id,
      actor_display: row.actor_display,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      // ADMIN never sees lead linkage — zeroed regardless of the stored value.
      lead_id: opts.isAdmin ? null : row.lead_id,
      before_hash: row.before_hash,
      after_hash: row.after_hash,
      prev_audit_hash: row.prev_audit_hash,
      detail: this.maskDetail(this.parseDetail(row.detail)),
      created_at: row.created_at,
    };
  }

  /**
   * Mask the PII keys in a `detail` object for the explorer list. Format-shaped
   * fields (name/mobile/email/pan_token/aadhaar_ref_token) are masked by their
   * {@link MaskingService.mask} primitive (strict); `ckyc_id` is fully redacted.
   * The list never reveals raw PII — that is the unmask endpoint's sole job — so
   * no break-glass bypass is applied here. Non-PII keys pass through unchanged;
   * the input is never mutated.
   */
  private maskDetail(detail: Record<string, unknown> | null): Record<string, unknown> | null {
    if (detail == null) {
      return null;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(detail)) {
      const fieldKind: MaskableField | undefined = AUDIT_DETAIL_PII_FIELDS[key];
      if (fieldKind != null && (typeof value === 'string' || value === null)) {
        out[key] = this.masking.mask(fieldKind, value as string | null, { strict: true });
      } else if (AUDIT_DETAIL_REDACT_FIELDS.has(key) && value != null) {
        out[key] = REDACTED_TOKEN;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /** Parse the JSONB `detail` cell (string from pg or object) into an object. */
  private parseDetail(raw: unknown): Record<string, unknown> | null {
    const value = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private ipDevice(req: HttpRequestLike): { ip?: string; user_agent?: string } {
    return {
      ip: readHeader(req, 'x-forwarded-for') ?? undefined,
      user_agent: readHeader(req, 'user-agent') ?? undefined,
    };
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
