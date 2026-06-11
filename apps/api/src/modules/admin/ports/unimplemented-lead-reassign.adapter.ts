import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import type { DbTransaction } from '../../../core/db';
import { DomainException } from '../../../core/http';
import type { LeadReassignPort } from './lead-reassign.port';

/**
 * Placeholder {@link LeadReassignPort} used until Wave 2 (FR-010/030, M2) binds
 * the token to `LeadService.bulkReassign`. It throws a typed `INTERNAL_ERROR`
 * rather than silently succeeding — a deactivation that actually needs lead
 * reassignment must fail loudly (and roll its transaction back) instead of
 * leaving open leads orphaned on an inactive user. The deactivate-without-leads
 * path never reaches the port, so all other FR-130 flows work today.
 */
@Injectable()
export class UnimplementedLeadReassignAdapter implements LeadReassignPort {
  bulkReassign(
    _fromUserId: string,
    _toUserId: string,
    _reason: string,
    _tx: DbTransaction,
  ): Promise<number> {
    throw new DomainException(
      ERROR_CODES.INTERNAL_ERROR,
      'Lead reassignment is not available yet (LeadService.bulkReassign is wired in Wave 2).',
    );
  }
}
