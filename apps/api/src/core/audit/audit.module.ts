import { Global, Module } from '@nestjs/common';

import { AuditAppender } from './audit-appender.service';

/**
 * Audit module (architecture §8). Exposes {@link AuditAppender} for every
 * sensitive action to record an audit intent. The hash-chain consumer
 * (single-writer) is a separate deployment concern and is not wired here.
 */
@Global()
@Module({
  providers: [AuditAppender],
  exports: [AuditAppender],
})
export class AuditModule {}
