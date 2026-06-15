import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';

import { AppConfigService } from '../../../core/config';
import type { ExportStoragePort } from '../ports/export-storage.port';

/**
 * FR-122 — GCS export storage adapter. Uses `@google-cloud/storage` ^7.
 * Uploads the CSV to `gs://{GCS_BUCKET}/exports/{org_id}/{export_job_id}.csv`.
 * Generates V4 signed URLs for download.
 */
@Injectable()
export class GcsExportStorageAdapter implements ExportStoragePort {
  private readonly bucket: string;
  private readonly storage: Storage;

  constructor(config: AppConfigService) {
    this.bucket = config.get('GCS_BUCKET');
    this.storage = new Storage();
  }

  async upload(objectPath: string, content: string): Promise<void> {
    const file = this.storage.bucket(this.bucket).file(objectPath);
    await file.save(content, {
      contentType: 'text/csv; charset=utf-8',
      metadata: { contentEncoding: 'utf-8' },
    });
  }

  async getSignedUrl(objectPath: string, ttlSeconds: number): Promise<string> {
    const file = this.storage.bucket(this.bucket).file(objectPath);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }
}
