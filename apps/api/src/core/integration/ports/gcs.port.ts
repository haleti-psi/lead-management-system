import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ERROR_CODES } from '@lms/shared';

import { AppConfigService } from '../../config';
import { DomainException } from '../../http/domain-exception';

/**
 * Object metadata returned by {@link GcsPort.getObjectMetadata} — only the
 * fields FR-070 needs for the Phase-B confirm content-inspection step (declared
 * vs. actual MIME) and bookkeeping. Never the object bytes (PII).
 */
export interface GcsObjectMetadata {
  /** Storage-reported content type (magic-byte/declared on upload). */
  contentType: string | null;
  /** Object size in bytes, when reported. */
  sizeBytes: number | null;
}

/**
 * GCS storage boundary for FR-070 document upload (integration-map.md §GcsPort —
 * added with FR-070). Hexagonal per the FR-010 `ImportFileStorePort` precedent
 * (and the outbox-publisher / retry-queue convention): the production
 * {@link GcsHttpAdapter} uses `@google-cloud/storage` (dependency-register.md);
 * dev/test bind {@link GcsMockAdapter} so the suite never reaches live GCS.
 *
 * NOT routed through {@link IntegrationGateway}: `integration_logs.integration`
 * is the `integration_kind` enum (los/kyc/comm/…), which has no GCS member —
 * exactly why FR-010 stores import files through a dedicated port rather than the
 * gateway. Signed-URL generation and object metadata are local/storage-control
 * operations, not a metered external provider call.
 *
 * Failures surface as `UPSTREAM_UNAVAILABLE` (503) — the only external-failure
 * code in the taxonomy (error-taxonomy.md §UPSTREAM_UNAVAILABLE).
 */
export interface GcsPort {
  /**
   * Generate a time-limited signed PUT URL the client uploads the binary to
   * directly (LLD §External Service Calls — GCS signed URL). `objectPath` is the
   * bucket-relative key; returns the absolute URL and its absolute expiry.
   */
  generateSignedPutUrl(
    objectPath: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }>;

  /** Read an object's metadata (content type + size) for the confirm inspection. */
  getObjectMetadata(objectPath: string): Promise<GcsObjectMetadata>;

  /** Delete an object (infected scan / MIME mismatch cleanup). Idempotent. */
  deleteObject(objectPath: string): Promise<void>;
}

/** DI token for {@link GcsPort} (bound in `kyc.module.ts`). */
export const GCS_PORT = Symbol('GCS_PORT');

/**
 * Production {@link GcsPort} over GCS (`GCS_BUCKET`, environment-contract.md).
 * The client is created lazily — dev/test bind {@link GcsMockAdapter} and never
 * construct it (no live GCP in the suite). Every storage fault is mapped to
 * `UPSTREAM_UNAVAILABLE` (503); the underlying cause is attached for the logger
 * only and never serialised to the client (security.md).
 */
@Injectable()
export class GcsHttpAdapter implements GcsPort {
  private storage: Storage | undefined;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(GcsHttpAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async generateSignedPutUrl(
    objectPath: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    try {
      const [url] = await this.file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType,
      });
      return { url, expiresAt };
    } catch (cause) {
      throw this.upstream('signed-url generation failed', cause);
    }
  }

  async getObjectMetadata(objectPath: string): Promise<GcsObjectMetadata> {
    try {
      const [metadata] = await this.file(objectPath).getMetadata();
      const size = metadata.size;
      return {
        contentType: metadata.contentType ?? null,
        sizeBytes: size != null ? Number(size) : null,
      };
    } catch (cause) {
      throw this.upstream('object metadata read failed', cause);
    }
  }

  async deleteObject(objectPath: string): Promise<void> {
    try {
      // `ignoreNotFound` keeps deletion idempotent (best-effort cleanup).
      await this.file(objectPath).delete({ ignoreNotFound: true });
    } catch (cause) {
      throw this.upstream('object delete failed', cause);
    }
  }

  private file(objectPath: string) {
    const bucket = this.config.get('GCS_BUCKET');
    return this.client().bucket(bucket).file(objectPath);
  }

  private client(): Storage {
    this.storage ??= new Storage({ projectId: this.config.get('GCP_PROJECT') });
    return this.storage;
  }

  private upstream(message: string, cause: unknown): DomainException {
    // Never log the object path content beyond the operation label.
    this.logger.error({ err: cause }, `GCS ${message}`);
    return new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE, undefined, { cause });
  }
}
