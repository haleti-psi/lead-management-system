import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { DbTransaction } from '../../../core/db';
import type {
  DuplicateCheckPort,
  DuplicateProbeIdentity,
  DuplicateSyncResult,
} from './duplicate-check.port';

/**
 * Placeholder {@link DuplicateCheckPort} until FR-020 lands (the FR-010 LLD
 * sanctions stubbing the dedupe service). It reports "no duplicates" — leads are
 * always creatable — and logs each skipped async scan so the gap is visible in
 * ops. Unlike a write seam, a read-only no-op here is SAFE: the FR-020 engine
 * re-scans every lead once it ships (its backfill path), so no data is lost.
 */
@Injectable()
export class NoopDuplicateCheckAdapter implements DuplicateCheckPort {
  constructor(
    @InjectPinoLogger(NoopDuplicateCheckAdapter.name) private readonly logger: PinoLogger,
  ) {}

  matchSync(
    _identity: DuplicateProbeIdentity,
    _orgId: string,
    _tx: DbTransaction,
  ): Promise<DuplicateSyncResult> {
    return Promise.resolve({ blocked: false, matches: [] });
  }

  matchAsync(leadId: string): Promise<void> {
    this.logger.debug({ lead_id: leadId }, 'Duplicate scan skipped (FR-020 not yet built)');
    return Promise.resolve();
  }
}
