import { Module } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import {
  GCS_PORT,
  GcsHttpAdapter,
  GcsMockAdapter,
  VIRUS_SCAN_PORT,
  VirusScanHttpAdapter,
  VirusScanMockAdapter,
} from '../../core/integration';
import { ComplianceModule } from '../compliance/compliance.module';
import { CustomerDocumentController } from './customer-document.controller';
import { DocumentController } from './document.controller';
import { DocumentRepository } from './document.repository';
import { DocumentService } from './document.service';
import { ScanCallbackController } from './scan-callback.controller';
import { ScanCallbackGuard } from './scan-callback.guard';

/**
 * M8 KYC & Documents — FR-070 (document checklist & upload; `documents` owner).
 * Depends on the global core modules (DB/UnitOfWork, audit, outbox, auth-core,
 * integration) plus the @Global CaptureModule's `LeadService` (sole writer of
 * `leads` — `setKycStatus` lands with this FR) and the M12 ComplianceModule's
 * `CUSTOMER_LINK_PORT` (the FR-060 token+OTP seam, reused for `/c/{token}/documents`).
 *
 * Port binding (GCS / virus scan) follows the FR-010 ImportFileStorePort
 * precedent and the IntegrationCoreModule LOS_MOCK convention: the real HTTP
 * adapters are bound only in production; dev/test bind the in-process mocks so
 * the suite never reaches live GCS / a scan provider. These ports are NOT routed
 * through IntegrationGateway (`integration_kind` has no GCS/virus-scan member —
 * FR-070 LLD §Ambiguities 2).
 */
@Module({
  imports: [ComplianceModule],
  controllers: [DocumentController, CustomerDocumentController, ScanCallbackController],
  providers: [
    DocumentService,
    DocumentRepository,
    ScanCallbackGuard,
    GcsHttpAdapter,
    GcsMockAdapter,
    VirusScanHttpAdapter,
    VirusScanMockAdapter,
    {
      provide: GCS_PORT,
      useFactory: (config: AppConfigService, http: GcsHttpAdapter, mock: GcsMockAdapter) =>
        config.isProduction ? http : mock,
      inject: [AppConfigService, GcsHttpAdapter, GcsMockAdapter],
    },
    {
      provide: VIRUS_SCAN_PORT,
      useFactory: (
        config: AppConfigService,
        http: VirusScanHttpAdapter,
        mock: VirusScanMockAdapter,
      ) => (config.isProduction ? http : mock),
      inject: [AppConfigService, VirusScanHttpAdapter, VirusScanMockAdapter],
    },
  ],
  exports: [DocumentService],
})
export class KycModule {}
