/**
 * Dispatch boundary for the async bulk-import processor (FR-010 bulk flow 5e:
 * "Dispatch ImportProcessorJob via Cloud Tasks"). The Cloud-Tasks adapter needs
 * an HTTP worker endpoint, which is NOT in api-contract.yaml — adding one is a
 * Dev-1 contracts change — so until that lands the bound adapter executes the
 * processor in-process, post-commit, fire-and-forget (the job row is already
 * committed; the processor is idempotent on job status). The port keeps the
 * swap a one-line module change.
 */
export interface ImportDispatchPort {
  /** Schedule processing of a committed, `queued` import job. Must not throw into the 202 path. */
  enqueue(importJobId: string): Promise<void>;
}

/** DI token for {@link ImportDispatchPort} (bound in `capture.module.ts`). */
export const IMPORT_DISPATCH_PORT = Symbol('IMPORT_DISPATCH_PORT');
