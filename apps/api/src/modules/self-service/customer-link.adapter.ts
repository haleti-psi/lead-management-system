import { Injectable } from '@nestjs/common';

import { CreationChannel } from '@lms/shared';

import type {
  CustomerLinkPort,
  ResolvedCustomerLink,
} from '../compliance/ports/customer-link.port';
import { CustomerLinkRepository, type CustomerLinkRow } from './customer-link.repository';
import { OtpService } from './otp.service';
import type { LinkPurpose } from './self-service.constants';
import { hashToken } from './token.util';

/**
 * FR-060 — the real {@link CustomerLinkPort}, rebinding the seam FR-070/FR-110
 * left behind the `UnavailableCustomerLinkAdapter`. Resolves a token ONLY when it
 * is an active, unexpired link WITH a valid OTP session AND the required purpose;
 * otherwise returns `null` (callers map that to NOT_FOUND — existence hidden).
 * `channel` is recorded as the customer self-service channel (`api`);
 * `customerProfileId` is left null (the consent service falls back to the lead's).
 */
@Injectable()
export class CustomerLinkAdapter implements CustomerLinkPort {
  constructor(
    private readonly repo: CustomerLinkRepository,
    private readonly otp: OtpService,
  ) {}

  resolveForDocument(token: string): Promise<ResolvedCustomerLink | null> {
    return this.resolve(token, 'upload');
  }

  resolveForConsent(token: string): Promise<ResolvedCustomerLink | null> {
    return this.resolve(token, 'consent');
  }

  /** FR-061 — token resolution for `POST /c/{token}/grievance` (purpose 'grievance').
   * Not on the cross-module {@link CustomerLinkPort}; consumed within M7. */
  resolveForGrievance(token: string): Promise<ResolvedCustomerLink | null> {
    return this.resolve(token, 'grievance');
  }

  /** FR-062 — token resolution for `GET /c/{token}/status` (purpose 'status'). */
  resolveForStatus(token: string): Promise<ResolvedCustomerLink | null> {
    return this.resolve(token, 'status');
  }

  /** FR-062 — token resolution for `POST /c/{token}/callback` (purpose 'callback'). */
  resolveForCallback(token: string): Promise<ResolvedCustomerLink | null> {
    return this.resolve(token, 'callback');
  }

  private async resolve(token: string, requiredPurpose: LinkPurpose): Promise<ResolvedCustomerLink | null> {
    const link = await this.repo.findActiveByTokenHash(hashToken(token));
    if (!link) return null;
    if (new Date(link.expires_at).getTime() < Date.now()) return null;
    if (!purposeAllows(link, requiredPurpose)) return null;
    if (!(await this.otp.hasValidSession(link.customer_link_id))) return null;

    return {
      leadId: link.lead_id,
      orgId: link.org_id,
      customerProfileId: null,
      channel: CreationChannel.API,
    };
  }
}

/** Whether the link's JSONB `purpose` array permits the given action. */
function purposeAllows(link: CustomerLinkRow, purpose: LinkPurpose): boolean {
  return Array.isArray(link.purpose) && (link.purpose as unknown[]).includes(purpose);
}
