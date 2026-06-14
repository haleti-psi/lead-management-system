import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { Public } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { DomainException, type HttpRequestLike } from '../../core/http';
import {
  CUSTOMER_LINK_PORT,
  type CustomerLinkPort,
} from '../compliance/ports/customer-link.port';
import { clientMeta } from './document.controller';
import {
  DocumentService,
  type ConfirmUploadData,
  type CustomerUploadContext,
  type InitiateUploadData,
} from './document.service';
import { TokenParam } from '../compliance/dto/customer-consent.dto';
import { UploadConfirmDto, isConfirmBody } from './dto/upload-confirm.dto';
import { UploadInitiateDto } from './dto/upload-initiate.dto';
import { parseUploadBody } from './upload-body.util';

/**
 * FR-070 (co-owned with M7/FR-060) — `POST /api/v1/c/{token}/documents`
 * (api-contract `customerUpload`; auth-matrix `public_endpoints`).
 *
 * `@Public()` bypasses the JWT guard; authorisation is the opaque link token +
 * OTP step-up, validated through {@link CustomerLinkPort} (the SAME FR-110/FR-060
 * seam the consent micro-site uses — `resolveForDocument`). An
 * unresolvable/expired/revoked token → `NOT_FOUND` (404, existence hidden). The
 * upload is the same two-phase protocol as the staff endpoint, scoped to the
 * single lead the token resolves to (`uploaded_via = customer_link`). The global
 * per-IP auth throttle tier applies (no JWT to scope a per-user tier).
 */
@Controller('c')
@Public()
export class CustomerDocumentController {
  constructor(
    private readonly documents: DocumentService,
    @Inject(CUSTOMER_LINK_PORT) private readonly links: CustomerLinkPort,
  ) {}

  /** POST /api/v1/c/{token}/documents — Phase A initiate (201) or Phase B confirm (200). */
  @Post(':token/documents')
  @HttpCode(201)
  async customerUpload(
    @Param('token', new ZodValidationPipe(TokenParam)) token: string,
    @Body() body: unknown,
    @Req() req: HttpRequestLike,
  ): Promise<InitiateUploadData | ConfirmUploadData> {
    const link = await this.links.resolveForDocument(token);
    if (!link) {
      throw new DomainException(ERROR_CODES.NOT_FOUND);
    }
    const ctx: CustomerUploadContext = {
      leadId: link.leadId,
      orgId: link.orgId,
      requestMeta: clientMeta(req),
    };

    if (isConfirmBody(body)) {
      return this.documents.confirmCustomerUpload(parseUploadBody(UploadConfirmDto, body), ctx);
    }
    return this.documents.initiateCustomerUpload(parseUploadBody(UploadInitiateDto, body), ctx);
  }
}
