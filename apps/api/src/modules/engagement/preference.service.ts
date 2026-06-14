import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditAction, ConsentPurpose as ConsentPurposeEnum, ERROR_CODES, type CommChannel, type ConsentPurpose, type SubjectType } from '@lms/shared';

import type { AuditEntry } from '../../core/audit';
import { AuditAppender } from '../../core/audit';
import type { AuthUser } from '../../core/auth';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import type { PutPreferencesDto } from './dto/put-preferences.dto';
import type { PreferenceRow } from './preference.repository';
import { PreferenceRepository } from './preference.repository';

/** Purposes that emit a non-blocking warning when opted out. */
const TRANSACTIONAL_WARN_PURPOSES = new Set<ConsentPurpose>([
  'kyc',
  'document_processing',
  'communication',
]);

export interface UpsertResult {
  subject_type: SubjectType;
  subject_ref: string;
  preferences: PreferenceRow[];
}

export interface UpsertWarning {
  field: string;
  message: string;
}

/**
 * FR-103 — NotificationPreferenceService.
 *
 * Canonical writer of `notification_preferences` for M11.
 * Exposes:
 *   • `upsertBatch` — PUT /preferences (internal + customer-link path).
 *   • `getBySubject` — GET /preferences (UI read).
 *   • `isAllowed` — seam for FR-101 NotificationDispatchService:
 *       returns true if the recipient is opted-in for (channel, purpose).
 *       Absent row → defaults: marketing = false, all others = true.
 *
 * Default opt-in values (per BRD AC-2, LLD §Data Operations):
 *   marketing purpose → opted-out by default (false).
 *   all other purposes → opted-in by default (true).
 */
@Injectable()
export class PreferenceService {
  constructor(
    private readonly repo: PreferenceRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
    @InjectPinoLogger(PreferenceService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Batch upsert — one `UnitOfWork` transaction for all items + audit.
   * Duplicate (channel, purpose) pairs within the request are deduplicated
   * before the upsert (last item in the array wins).
   *
   * Returns the persisted rows and any non-blocking transactional opt-out warnings.
   */
  async upsertBatch(
    dto: PutPreferencesDto,
    actor: AuthUser,
  ): Promise<{ result: UpsertResult; warnings: UpsertWarning[] }> {
    if (!actor.orgId) {
      throw new DomainException(ERROR_CODES.INTERNAL_ERROR);
    }
    const orgId = actor.orgId;
    const actorUserId = actor.userId;

    // Deduplicate by (channel, purpose) — last write in the array wins.
    const deduped = deduplicatePreferences(dto.preferences);

    const savedRows: PreferenceRow[] = [];

    await this.uow.run(async (tx) => {
      for (const item of deduped) {
        const row = await this.repo.upsertOne(
          orgId,
          dto.subject_type,
          dto.subject_ref,
          item.channel,
          item.purpose,
          item.opted_in,
          actorUserId,
          tx,
        );
        savedRows.push(row);
      }

      const auditEntry: AuditEntry = {
        action: AuditAction.LEAD_UPDATE,
        entity_type: 'notification_preferences',
        entity_id: null,
        actor_id: actorUserId,
        org_id: orgId,
        lead_id: null,
        detail: {
          op: 'pref_change',
          subject_type: dto.subject_type,
          // subject_ref is a UUID — not a PII value (name/mobile/email not included).
          subject_ref: dto.subject_ref,
          changes: deduped.map((p) => ({
            channel: p.channel,
            purpose: p.purpose,
            opted_in: p.opted_in,
          })),
        },
      };
      await this.audit.append(auditEntry, tx);
    });

    this.logger.info(
      {
        subject_type: dto.subject_type,
        subject_ref: dto.subject_ref,
        count: savedRows.length,
      },
      'FR-103 preference batch upserted',
    );

    const warnings = buildOptOutWarnings(savedRows);

    return {
      result: {
        subject_type: dto.subject_type,
        subject_ref: dto.subject_ref,
        preferences: savedRows,
      },
      warnings,
    };
  }

  /**
   * Read all preferences for a subject (for GET /preferences).
   */
  async getBySubject(
    subjectType: SubjectType,
    subjectRef: string,
    orgId: string,
  ): Promise<{ subject_type: SubjectType; subject_ref: string; preferences: PreferenceRow[] }> {
    const rows = await this.repo.findBySubject(orgId, subjectType, subjectRef);
    return {
      subject_type: subjectType,
      subject_ref: subjectRef,
      preferences: rows,
    };
  }

  /**
   * FR-101 seam — returns true if the recipient is opted-in for (channel, purpose).
   *
   * Absence of a preference row → apply defaults:
   *   marketing purpose → false (opted-out by default).
   *   all other purposes → true (opted-in by default).
   *
   * `subjectRef` is either a `customer_profile_id` (subject_type=customer) or a
   * `lead_id` (legacy FR-101 usage before FR-103 landed). The lookup is
   * `subject_ref`-based — the column stores whichever ID the caller sets.
   *
   * NOTE: FR-101 currently queries `notification_preferences` directly. When
   * adopting this method, replace the inline Kysely query in
   * `NotificationDispatchService` with this call.
   */
  async isAllowed(
    subjectRef: string,
    channel: CommChannel,
    purpose: ConsentPurpose,
    orgId: string,
  ): Promise<boolean> {
    const row = await this.repo.findOne(orgId, subjectRef, channel, purpose);
    if (row !== undefined) {
      return row.opted_in;
    }
    // Default: marketing = opted-out, everything else = opted-in.
    return purpose !== ConsentPurposeEnum.MARKETING;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deduplicates by (channel, purpose); last occurrence wins. */
function deduplicatePreferences<T extends { channel: CommChannel; purpose: ConsentPurpose }>(
  items: T[],
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(`${item.channel}::${item.purpose}`, item);
  }
  return Array.from(map.values());
}

/** Returns non-blocking warnings for transactional opt-outs. */
function buildOptOutWarnings(rows: PreferenceRow[]): UpsertWarning[] {
  const warnings: UpsertWarning[] = [];
  rows.forEach((row, idx) => {
    if (!row.opted_in && TRANSACTIONAL_WARN_PURPOSES.has(row.purpose)) {
      warnings.push({
        field: `preferences[${idx}]`,
        message: 'Opting out of KYC/document reminders may delay your application processing.',
      });
    }
  });
  return warnings;
}
