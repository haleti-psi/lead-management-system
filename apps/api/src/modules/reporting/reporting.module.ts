import { Module } from '@nestjs/common';

import { AuditExplorerController } from './audit-explorer.controller';
import { AuditExplorerRepository } from './audit-explorer.repository';
import { AuditExplorerService } from './audit-explorer.service';

/**
 * M13 Reporting & MIS — FR-123 audit explorer & evidence-unmask. Depends only on
 * the global core modules already registered by the app root:
 * `DbModule` (Kysely), `AuditModule` (AuditAppender + AuditChainConsumer),
 * `MaskingModule` (MaskingService), `AuthCoreModule` (AbacGuard/EntitlementService),
 * and `LoggingModule` (pino `Logger`). No new infra is wired here.
 */
@Module({
  controllers: [AuditExplorerController],
  providers: [AuditExplorerService, AuditExplorerRepository],
  exports: [AuditExplorerService],
})
export class ReportingModule {}
