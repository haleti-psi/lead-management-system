import { ERROR_CODES } from '@lms/shared';

import { GcsMockAdapter } from './gcs-mock.adapter';
import { VirusScanMockAdapter } from './virus-scan-mock.adapter';

describe('GcsMockAdapter (FR-070 test double)', () => {
  it('generateSignedPutUrl returns a fake URL and a future expiry', async () => {
    const gcs = new GcsMockAdapter();
    const before = Date.now();
    const { url, expiresAt } = await gcs.generateSignedPutUrl('leads/x/obj', 'application/pdf', 600);
    expect(url).toContain('storage.googleapis.com');
    expect(expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('getObjectMetadata echoes staged metadata; defaults to application/pdf', async () => {
    const gcs = new GcsMockAdapter();
    await expect(gcs.getObjectMetadata('unset')).resolves.toMatchObject({ contentType: 'application/pdf' });
    gcs.setObjectMetadata('p', { contentType: 'image/png', sizeBytes: 5 });
    await expect(gcs.getObjectMetadata('p')).resolves.toEqual({ contentType: 'image/png', sizeBytes: 5 });
  });

  it('deleteObject records the path and is idempotent', async () => {
    const gcs = new GcsMockAdapter();
    await gcs.deleteObject('leads/x/obj');
    await gcs.deleteObject('leads/x/obj');
    expect(gcs.deletedPaths()).toEqual(['leads/x/obj', 'leads/x/obj']);
  });

  it('failNext makes the next op throw UPSTREAM_UNAVAILABLE', async () => {
    const gcs = new GcsMockAdapter();
    gcs.failNext('getObjectMetadata');
    await expect(gcs.getObjectMetadata('p')).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    });
    // Only the next call fails.
    await expect(gcs.getObjectMetadata('p')).resolves.toBeDefined();
  });
});

describe('VirusScanMockAdapter (FR-070 test double)', () => {
  it('records enqueued scans', async () => {
    const scan = new VirusScanMockAdapter();
    await scan.scanObject({ objectPath: 'leads/x/obj', documentId: 'doc-1' });
    expect(scan.enqueuedScans()).toEqual([{ objectPath: 'leads/x/obj', documentId: 'doc-1' }]);
  });

  it('failNext makes the next scan throw UPSTREAM_UNAVAILABLE', async () => {
    const scan = new VirusScanMockAdapter();
    scan.failNext();
    await expect(scan.scanObject({ objectPath: 'p', documentId: 'd' })).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    });
    await expect(scan.scanObject({ objectPath: 'p', documentId: 'd' })).resolves.toBeUndefined();
  });
});
