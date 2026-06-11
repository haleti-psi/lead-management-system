import { Global, Module } from '@nestjs/common';

import { AuditAppender } from './audit-appender.service';
import { AuditChainConsumer } from './audit-chain.consumer';

/**
 * Audit module (architecture §8). Exposes {@link AuditAppender} for every
 * sensitive action to record an audit intent, and the single-writer
 * {@link AuditChainConsumer} (ADR-5) that seals the tamper-evident hash chain
 * and verifies integrity. Both are provided globally; the consumer is invoked by
 * its single-writer worker (concurrency = 1) and read by the audit explorer
 * (FR-123) for per-page integrity verification.
 */
@Global()
@Module({
  providers: [AuditAppender, AuditChainConsumer],
  exports: [AuditAppender, AuditChainConsumer],
})
export class AuditModule {}
