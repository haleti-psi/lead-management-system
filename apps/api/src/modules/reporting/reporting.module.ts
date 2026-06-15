import { Module } from '@nestjs/common';

import { AuditExplorerController } from './audit-explorer.controller';
import { AuditExplorerRepository } from './audit-explorer.repository';
import { AuditExplorerService } from './audit-explorer.service';
import { DifferentiatorRepository } from './differentiator.repository';
import { ReportController } from './report.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

/**
 * M13 Reporting & MIS — FR-123 audit explorer + FR-120 core report pack
 * + FR-121 differentiator reports.
 * Depends only on the global core modules already registered by the app root:
 * `DbModule` (Kysely), `AuditModule` (AuditAppender + AuditChainConsumer),
 * `MaskingModule` (MaskingService), `AuthCoreModule` (AbacGuard/EntitlementService),
 * `AppConfigModule` (AppConfigService), and `LoggingModule` (pino `Logger`).
 * No new infra is wired here.
 */
@Module({
  controllers: [AuditExplorerController, ReportController],
  providers: [
    AuditExplorerService,
    AuditExplorerRepository,
    ReportService,
    ReportRepository,
    DifferentiatorRepository,
  ],
  exports: [AuditExplorerService, ReportService],
})
export class ReportingModule {}
