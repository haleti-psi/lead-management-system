import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';

import { AppConfigService } from '../../../core/config';
import type { ImportFileStorePort } from './import-file-store.port';

/**
 * Production {@link ImportFileStorePort} over GCS (`GCS_BUCKET`,
 * environment-contract.md). References are `gs://bucket/path` so the error-file
 * ref stored on `import_jobs` is environment-portable. The client is created
 * lazily — dev/test bind the in-memory adapter and never construct it.
 */
@Injectable()
export class GcsImportFileStoreAdapter implements ImportFileStorePort {
  private storage: Storage | undefined;

  constructor(private readonly config: AppConfigService) {}

  async put(path: string, content: Buffer, contentType: string): Promise<string> {
    const bucket = this.config.get('GCS_BUCKET');
    await this.client().bucket(bucket).file(path).save(content, { contentType, resumable: false });
    return `gs://${bucket}/${path}`;
  }

  async get(ref: string): Promise<Buffer> {
    const { bucket, path } = parseGsRef(ref, this.config.get('GCS_BUCKET'));
    const [content] = await this.client().bucket(bucket).file(path).download();
    return content;
  }

  private client(): Storage {
    this.storage ??= new Storage({ projectId: this.config.get('GCP_PROJECT') });
    return this.storage;
  }
}

function parseGsRef(ref: string, defaultBucket: string): { bucket: string; path: string } {
  if (ref.startsWith('gs://')) {
    const without = ref.slice('gs://'.length);
    const slash = without.indexOf('/');
    if (slash > 0) {
      return { bucket: without.slice(0, slash), path: without.slice(slash + 1) };
    }
  }
  return { bucket: defaultBucket, path: ref };
}
