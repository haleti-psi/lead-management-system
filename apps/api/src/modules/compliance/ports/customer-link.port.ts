import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { CreationChannel } from '@lms/shared';

/**
 * The lead-bound context a VALID customer link resolves to. A non-null result
 * means the adapter has fully validated the token per the FR-110/FR-060 auth
 * contract: token exists in `customer_links`, `status = 'active'`,
 * `expires_at > now()`, AND the OTP step-up for the session is complete.
 */
export interface ResolvedCustomerLink {
  leadId: string;
  /** From the link/lead; nullable when the profile is not yet linked. */
  customerProfileId: string | null;
  orgId: string;
  /**
   * Recorded as `consent_records.channel`. NOTE (AMBIGUITY.md §FR-110-2): the
   * LLD derives this from `customer_links.channel`, but schema.sql has no such
   * column — the FR-060 adapter owns the source of this value.
   */
  channel: CreationChannel;
}

/**
 * Token-resolution boundary for `POST /c/{token}/consent` (FR-110 LLD §Auth:
 * "CustomerLinkGuard validates the opaque token … OTP step-up is required").
 * `customer_links` + the OTP-session machinery are OWNED by M7/FR-060 (not yet
 * built — Dev-3 builds FR-110 first, STAGE7-CONTINUATION §9), so M12 consumes
 * them through this port; FR-060 rebinds it to the real link service
 * (one-line change in `compliance.module.ts`).
 *
 * Contract: return the resolved link ONLY for a fully valid token+OTP session;
 * return `null` for anything invalid/expired/revoked/unverified — the caller
 * maps `null` to `NOT_FOUND` (404, existence hidden per BRD §8.6).
 */
export interface CustomerLinkPort {
  resolveForConsent(token: string): Promise<ResolvedCustomerLink | null>;
}

/** DI token for {@link CustomerLinkPort} (bound in `compliance.module.ts`). */
export const CUSTOMER_LINK_PORT = Symbol('CUSTOMER_LINK_PORT');

/**
 * Wave-3 placeholder until FR-060 lands: resolves NO token (every request →
 * 404, indistinguishable from an invalid token, so nothing leaks) and logs
 * loudly — never a silent success path (Wave-1 convention).
 */
@Injectable()
export class UnavailableCustomerLinkAdapter implements CustomerLinkPort {
  constructor(
    @InjectPinoLogger(UnavailableCustomerLinkAdapter.name) private readonly logger: PinoLogger,
  ) {}

  resolveForConsent(_token: string): Promise<ResolvedCustomerLink | null> {
    // The token itself is never logged (opaque credential).
    this.logger.warn(
      'Customer-link resolution is not available yet (lands with FR-060); token consent request rejected as NOT_FOUND',
    );
    return Promise.resolve(null);
  }
}
