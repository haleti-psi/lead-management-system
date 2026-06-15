/**
 * FR-122 — Cloud Tasks enqueue abstraction port. The real adapter uses
 * `@google-cloud/tasks`; the test double is an in-memory stub.
 * All implementations are injected via EXPORT_TASK_PORT token.
 */
export interface ExportTaskPort {
  /** Enqueue an export generation task for the given exportJobId. */
  enqueue(exportJobId: string): Promise<void>;
}
