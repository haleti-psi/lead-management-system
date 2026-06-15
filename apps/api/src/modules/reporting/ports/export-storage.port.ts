/**
 * FR-122 — GCS storage abstraction port. The real adapter uses
 * `@google-cloud/storage`; the test double is an in-memory stub.
 * All implementations are injected via EXPORT_STORAGE_PORT token.
 */
export interface ExportStoragePort {
  /** Upload CSV content to the given GCS object path and return the path. */
  upload(objectPath: string, content: string): Promise<void>;
  /** Generate a V4 signed URL for the given GCS object path with the given TTL (seconds). */
  getSignedUrl(objectPath: string, ttlSeconds: number): Promise<string>;
}
