import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../../core/http';
import type { ImportFileStorePort } from './import-file-store.port';

/**
 * Dev/test {@link ImportFileStorePort} — process-local map, mirroring the
 * NoopRetryQueue / NoopEventPublisher convention so the suite and local dev
 * never call live GCS. A missing ref is a loud INTERNAL_ERROR, not a no-op.
 */
@Injectable()
export class InMemoryImportFileStoreAdapter implements ImportFileStorePort {
  private readonly objects = new Map<string, Buffer>();

  put(path: string, content: Buffer, _contentType: string): Promise<string> {
    this.objects.set(path, Buffer.from(content));
    return Promise.resolve(path);
  }

  get(ref: string): Promise<Buffer> {
    const found = this.objects.get(ref);
    if (!found) {
      return Promise.reject(
        new DomainException(ERROR_CODES.INTERNAL_ERROR, 'Import file not found in store.'),
      );
    }
    return Promise.resolve(Buffer.from(found));
  }
}
