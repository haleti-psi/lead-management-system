import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { ImportProcessorService } from '../import-processor.job';
import type { ImportDispatchPort } from './import-dispatch.port';

/**
 * In-process {@link ImportDispatchPort}: runs the processor on the next tick,
 * fire-and-forget, so the 202 response returns immediately (FR-010 bulk flow).
 * Failures are caught and logged — never swallowed silently, never propagated
 * into the accept path (the job row's `failed` status is the durable signal).
 * The Cloud-Tasks adapter replaces this binding once its worker endpoint is
 * added to api-contract.yaml (see import-dispatch.port.ts).
 */
@Injectable()
export class InlineImportDispatchAdapter implements ImportDispatchPort {
  constructor(
    private readonly processor: ImportProcessorService,
    @InjectPinoLogger(InlineImportDispatchAdapter.name) private readonly logger: PinoLogger,
  ) {}

  enqueue(importJobId: string): Promise<void> {
    setImmediate(() => {
      this.processor.process(importJobId).catch((err: unknown) => {
        this.logger.error({ err, import_job_id: importJobId }, 'Inline import processing failed');
      });
    });
    return Promise.resolve();
  }
}
