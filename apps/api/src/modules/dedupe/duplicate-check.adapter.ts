import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { DbTransaction } from '../../core/db';
import type {
  DuplicateCheckPort,
  DuplicateProbeIdentity,
  DuplicateSyncResult,
} from '../capture/ports/duplicate-check.port';
import { DuplicateBlockedException } from './dedupe.errors';
import { DuplicateService, toPortSummary } from './dedupe.service';

/**
 * FR-020 — the real {@link DuplicateCheckPort} adapter, replacing capture's
 * Wave-2 `NoopDuplicateCheckAdapter` (the port's documented rebind). It honours
 * the frozen port contract exactly:
 *
 *  - {@link matchSync} RETURNS `{ blocked, matches }` — the
 *    {@link DuplicateBlockedException} thrown by `DuplicateService.match()`
 *    (T30) is translated here, so `CaptureService`'s existing
 *    `CONFLICT`/`DUPLICATE_BLOCKED` 409 flow keeps working unchanged;
 *  - {@link matchAsync} never throws into the caller's response path.
 */
@Injectable()
export class DuplicateCheckAdapter implements DuplicateCheckPort {
  constructor(
    private readonly duplicates: DuplicateService,
    @InjectPinoLogger(DuplicateCheckAdapter.name) private readonly logger: PinoLogger,
  ) {}

  async matchSync(
    identity: DuplicateProbeIdentity,
    orgId: string,
    tx: DbTransaction,
  ): Promise<DuplicateSyncResult> {
    try {
      return await this.duplicates.match(identity, orgId, tx);
    } catch (err) {
      if (err instanceof DuplicateBlockedException) {
        return { blocked: true, matches: err.matches.map(toPortSummary) };
      }
      throw err;
    }
  }

  async matchAsync(leadId: string): Promise<void> {
    try {
      await this.duplicates.scan(leadId);
    } catch (err) {
      // Post-commit hook: the lead is already committed — log, never rethrow.
      this.logger.error({ err, lead_id: leadId }, 'Post-commit duplicate scan failed');
    }
  }
}
