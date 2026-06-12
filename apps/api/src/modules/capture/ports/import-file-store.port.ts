/**
 * Storage boundary for bulk-import artifacts (FR-010 bulk flow 5c: "Upload file
 * to GCS → import_jobs.file_ref"). Hexagonal per the outbox-publisher /
 * retry-queue convention: GCS (`@google-cloud/storage`) in production, an
 * in-memory double in dev/test — the suite never reaches live GCP.
 */
export interface ImportFileStorePort {
  /** Store `content` under `path`; returns the persistent reference (`gs://…` or the path). */
  put(path: string, content: Buffer, contentType: string): Promise<string>;
  /** Fetch a previously stored object by the reference {@link put} returned. */
  get(ref: string): Promise<Buffer>;
}

/** DI token for {@link ImportFileStorePort} (bound in `capture.module.ts`). */
export const IMPORT_FILE_STORE_PORT = Symbol('IMPORT_FILE_STORE_PORT');
