import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES } from '@lms/shared';

import { AppConfigService } from '../../config';
import { DomainException } from '../../http/domain-exception';

/** A virus-scan request (LLD §External Service Calls — Virus scan). */
export interface VirusScanRequest {
  /** Bucket-relative object key to scan. */
  objectPath: string;
  /** The document the scan result is reconciled against (callback correlation). */
  documentId: string;
}

/**
 * Virus-scan boundary for FR-070 (integration-map.md §VirusScanPort — added with
 * FR-070; BRD AC-4 "virus scan"). Hexagonal per the FR-010 `ImportFileStorePort`
 * precedent: {@link VirusScanHttpAdapter} (prod, env `VIRUS_SCAN_PROVIDER_URL` /
 * `VIRUS_SCAN_API_KEY`) and {@link VirusScanMockAdapter} (dev/test). The result
 * is delivered asynchronously to `POST /internal/documents/{did}/scan-result`
 * (Cloud Tasks webhook) — {@link scanObject} only ENQUEUES the scan and does not
 * block the upload-confirm response (LLD §Backend Flow step 6e).
 *
 * NOT routed through {@link IntegrationGateway}: `integration_kind` has no
 * virus-scan member (LLD §Ambiguities 2), and the result arrives out-of-band via
 * the callback, so the per-call gateway log/idempotency lifecycle does not model
 * it. Idempotency is enforced by the callback's per-document status guards.
 */
export interface VirusScanPort {
  /** Enqueue an async scan of the object; the result returns via the callback. */
  scanObject(request: VirusScanRequest): Promise<void>;
}

/** DI token for {@link VirusScanPort} (bound in `kyc.module.ts`). */
export const VIRUS_SCAN_PORT = Symbol('VIRUS_SCAN_PORT');

/**
 * Production {@link VirusScanPort}. Submits the object to the configured scan
 * provider; the provider calls back with the verdict. The provider URL/key come
 * from the validated env (Secret Manager-injected) — never a literal. A submit
 * fault maps to `UPSTREAM_UNAVAILABLE` (503).
 */
@Injectable()
export class VirusScanHttpAdapter implements VirusScanPort {
  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(VirusScanHttpAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async scanObject(request: VirusScanRequest): Promise<void> {
    const baseUrl = this.config.get('VIRUS_SCAN_PROVIDER_URL');
    const apiKey = this.config.get('VIRUS_SCAN_API_KEY');
    if (!baseUrl || !apiKey) {
      // The route must not silently skip scanning when the provider is unset.
      this.logger.error('Virus scan submit rejected: provider URL/key not configured');
      throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    }
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ object_path: request.objectPath, document_id: request.documentId }),
      });
      if (!response.ok) {
        throw new Error(`virus scan provider returned HTTP ${response.status}`);
      }
    } catch (cause) {
      this.logger.error({ err: cause }, 'virus scan submit failed');
      throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, undefined, { cause });
    }
  }
}
