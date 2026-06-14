import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException, type HttpRequestLike } from '../../core/http';
import { CustomerLinkRepository, type CustomerLinkRow } from './customer-link.repository';
import { hashToken } from './token.util';

/** Request key the guard attaches the resolved link to (read by the controller). */
export const CUSTOMER_LINK_KEY = 'customerLink' as const;

export interface CustomerLinkRequest extends HttpRequestLike {
  params?: { token?: string };
  [CUSTOMER_LINK_KEY]?: CustomerLinkRow;
}

/**
 * FR-060 — `CustomerLinkGuard` for the public landing/OTP endpoints. Validates
 * the opaque token (SHA-256 → active link lookup), lazily expires a past-due
 * link, and attaches the row to the request. Token invalid/expired/revoked all
 * return an identical NOT_FOUND (404) — existence is hidden. It does NOT enforce
 * the OTP gate; that lives in the document/consent port adapter (those endpoints
 * resolve via {@link CustomerLinkPort}, not this guard).
 */
@Injectable()
export class CustomerLinkGuard implements CanActivate {
  constructor(private readonly repo: CustomerLinkRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CustomerLinkRequest>();
    const token = req.params?.token;
    if (!token) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    const link = await this.repo.findActiveByTokenHash(hashToken(token));
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    if (new Date(link.expires_at).getTime() < Date.now()) {
      await this.repo.markExpired(link.customer_link_id);
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }

    req[CUSTOMER_LINK_KEY] = link;
    return true;
  }
}
