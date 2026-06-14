import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../http/domain-exception';
import type { GcsObjectMetadata, GcsPort } from '../ports/gcs.port';

/**
 * Deterministic in-process {@link GcsPort} for dev/test (FR-070-tests.md:
 * "Mock adapters: GcsMockAdapter"). No network I/O — unit/component tests never
 * reach a real GCS bucket (mirrors {@link LosMockAdapter} / the FR-010 in-memory
 * import-file store).
 *
 * It maintains a tiny in-memory object table so a test can stage metadata for an
 * uploaded object (e.g. a deliberate MIME mismatch for the confirm inspection)
 * and assert deletion. Tests steer it via {@link setObjectMetadata} /
 * {@link failNext}; with no steering, `generateSignedPutUrl` returns a fake URL,
 * `getObjectMetadata` returns the staged (or a default `application/pdf`) entry,
 * and `deleteObject` removes the staged entry.
 */
@Injectable()
export class GcsMockAdapter implements GcsPort {
  private readonly objects = new Map<string, GcsObjectMetadata>();
  private readonly deleted: string[] = [];
  private failOp: 'generateSignedPutUrl' | 'getObjectMetadata' | 'deleteObject' | null = null;

  /** Stage metadata a subsequent `getObjectMetadata(objectPath)` returns. */
  setObjectMetadata(objectPath: string, metadata: GcsObjectMetadata): void {
    this.objects.set(objectPath, metadata);
  }

  /** Force the NEXT call to the given op to throw `UPSTREAM_UNAVAILABLE` (503). */
  failNext(op: 'generateSignedPutUrl' | 'getObjectMetadata' | 'deleteObject'): void {
    this.failOp = op;
  }

  /** Object paths `deleteObject` was called with (test assertion helper). */
  deletedPaths(): readonly string[] {
    return this.deleted;
  }

  async generateSignedPutUrl(
    objectPath: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    this.maybeFail('generateSignedPutUrl');
    // Record the declared content type so a later metadata read can echo it
    // unless a test overrode it to simulate a mismatch.
    if (!this.objects.has(objectPath)) {
      this.objects.set(objectPath, { contentType, sizeBytes: null });
    }
    return {
      url: `https://storage.googleapis.com/mock-bucket/${objectPath}?X-Goog-Signature=mock`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async getObjectMetadata(objectPath: string): Promise<GcsObjectMetadata> {
    this.maybeFail('getObjectMetadata');
    return this.objects.get(objectPath) ?? { contentType: 'application/pdf', sizeBytes: 1 };
  }

  async deleteObject(objectPath: string): Promise<void> {
    this.maybeFail('deleteObject');
    this.deleted.push(objectPath);
    this.objects.delete(objectPath);
  }

  private maybeFail(op: 'generateSignedPutUrl' | 'getObjectMetadata' | 'deleteObject'): void {
    if (this.failOp === op) {
      this.failOp = null;
      throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    }
  }
}
