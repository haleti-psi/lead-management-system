import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { AppConfigService } from '../../core/config';
import { DomainException } from '../../core/http';
import { readHeader, type HttpRequestLike } from '../../core/http/http-types';

/** Header Cloud Tasks attaches to every dispatched HTTP target request. */
export const CLOUD_TASKS_QUEUE_HEADER = 'x-cloudtasks-queuename';

/**
 * FR-104 — guard for the internal SLA-sweep endpoint (service-to-service, not
 * user-facing). The endpoint is `@Public()` (the global JwtAuthGuard does NOT
 * apply), so a USER JWT alone can never authorise it — this guard requires the
 * request to originate from the configured Cloud Tasks queue, identified by the
 * `X-CloudTasks-QueueName` header matching `CLOUD_TASKS_QUEUE`.
 *
 * Defence-in-depth boundary (documented): in production the Cloud Run service is
 * additionally deployed with ingress restricted and the queue uses an OIDC
 * service-account token verified at the platform ingress (per the LLD's
 * `InternalTaskGuard` description). That OIDC audience/verification is an
 * infrastructure concern with no environment-contract variable defined for it
 * here, so this application-layer guard enforces the queue-identity header — the
 * portion that is verifiable in-process with the existing env contract. It is
 * deliberately conservative: any request without the exact queue header is
 * rejected with NOT_FOUND so the internal route is not discoverable.
 */
@Injectable()
export class InternalTaskGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<HttpRequestLike>();
    const queue = readHeader(req, CLOUD_TASKS_QUEUE_HEADER);
    if (!queue || queue !== this.config.get('CLOUD_TASKS_QUEUE')) {
      // Hide the route's existence from non-Cloud-Tasks callers (incl. user JWTs).
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    return true;
  }
}
