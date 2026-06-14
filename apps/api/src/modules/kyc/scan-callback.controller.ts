import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import { DocumentService } from './document.service';
import { ScanResultDto } from './dto/scan-result.dto';
import { ScanCallbackGuard } from './scan-callback.guard';

/**
 * FR-070 — internal virus-scan result webhook (LLD §Virus scan async callback).
 * `POST /api/v1/internal/documents/{did}/scan-result` is a service-to-service
 * route: `@Public()` opts out of the JWT guard, and {@link ScanCallbackGuard}
 * HMAC-verifies the Cloud Tasks payload instead. The verdict reconciliation
 * (clean → under_review; infected → reject + GCS delete; re-derive kyc_status;
 * audit + outbox) runs atomically in {@link DocumentService.handleScanResult}.
 */
@Controller('internal/documents')
@Public()
@UseGuards(ScanCallbackGuard)
export class ScanCallbackController {
  constructor(private readonly documents: DocumentService) {}

  /** POST /api/v1/internal/documents/{did}/scan-result — Cloud Tasks callback (200). */
  @Post(':did/scan-result')
  @HttpCode(200)
  async scanResult(
    @Param('did', new ZodValidationPipe(UuidParam)) did: string,
    @Body(new ZodValidationPipe(ScanResultDto)) dto: ScanResultDto,
  ): Promise<{ document_id: string; scan_status: string }> {
    await this.documents.handleScanResult(did, dto.status);
    return { document_id: did, scan_status: dto.status };
  }
}
