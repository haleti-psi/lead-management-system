import { Module } from '@nestjs/common';

import { AuditExplorerController } from './audit-explorer.controller';
import { AuditExplorerRepository } from './audit-explorer.repository';
import { AuditExplorerService } from './audit-explorer.service';
import { GcsExportStorageAdapter } from './adapters/gcs-export-storage.adapter';
import { CloudTasksExportAdapter } from './adapters/cloud-tasks-export.adapter';
import { DifferentiatorRepository } from './differentiator.repository';
import { ExportController } from './export.controller';
import { ExportRepository } from './export.repository';
import { ExportService } from './export.service';
import { EXPORT_STORAGE_PORT, EXPORT_TASK_PORT } from './export.tokens';
import { ExportGenerationTask } from './tasks/export-generation.task';
import { ReportController } from './report.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

/**
 * M13 Reporting & MIS — FR-123 audit explorer + FR-120 core report pack
 * + FR-121 differentiator reports + FR-122 export governance.
 * Depends only on the global core modules already registered by the app root:
 * `DbModule` (Kysely), `AuditModule` (AuditAppender + AuditChainConsumer),
 * `MaskingModule` (MaskingService), `AuthCoreModule` (AbacGuard/EntitlementService),
 * `AppConfigModule` (AppConfigService), and `LoggingModule` (pino `Logger`).
 * No new infra is wired here.
 */
@Module({
  controllers: [AuditExplorerController, ReportController, ExportController, ExportGenerationTask],
  providers: [
    AuditExplorerService,
    AuditExplorerRepository,
    ReportService,
    ReportRepository,
    DifferentiatorRepository,
    // FR-122 export governance
    ExportService,
    ExportRepository,
    { provide: EXPORT_STORAGE_PORT, useClass: GcsExportStorageAdapter },
    { provide: EXPORT_TASK_PORT, useClass: CloudTasksExportAdapter },
  ],
  exports: [AuditExplorerService, ReportService, ExportService],
})
export class ReportingModule {}
