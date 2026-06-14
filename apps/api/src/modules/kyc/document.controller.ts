import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Capability } from '@lms/shared';

import {
  CurrentUser,
  Requires,
  SCOPE_PREDICATE_KEY,
  type AbacRequestContext,
  type AuthUser,
} from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { readHeader, type HttpRequestLike } from '../../core/http';
import { UuidParam } from '../admin/dto/uuid-param.dto';
import {
  DocumentService,
  type ClientMeta,
  type ConfirmUploadData,
  type DocumentActorContext,
  type InitiateUploadData,
  type WaiverData,
} from './document.service';
import type { DocumentChecklistResponse } from './dto/document-checklist.dto';
import { UploadConfirmDto, isConfirmBody } from './dto/upload-confirm.dto';
import { UploadInitiateDto } from './dto/upload-initiate.dto';
import { WaiverDto } from './dto/waiver.dto';
import { DOCUMENTS_RESOURCE_TYPE } from './kyc.constants';
import { parseUploadBody } from './upload-body.util';

/** Pins the ABAC resource for the document endpoints (explicit — never the default). */
const documentsResource = () => ({ resourceType: DOCUMENTS_RESOURCE_TYPE });

/**
 * FR-070 — staff document endpoints (api-contract `listDocuments`,
 * `uploadDocument`, + the FR-070 waiver). All run behind the global
 * `JwtAuthGuard` (401) plus `AbacGuard` via `@Requires`; the row-level lead
 * scope check is enforced in the service against the guard's resolved predicate
 * (LLD §Auth Check). The upload (POST) carries the LLD's 60/min mutation
 * throttle; the list (GET) the 300/min read tier.
 */
@Controller('leads/:id/documents')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  /** GET /api/v1/leads/{id}/documents — merged checklist (200). */
  @Get()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.UPLOAD_DOC, documentsResource)
  async listDocuments(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<DocumentChecklistResponse> {
    return this.documents.listChecklist(id, actorContext(user, req));
  }

  /**
   * POST /api/v1/leads/{id}/documents — two-phase upload on one path (LLD
   * §Endpoint 2). A body with `action:"confirm"` is Phase B (200); otherwise
   * Phase A initiate (201). The status code is set per phase.
   */
  @Post()
  @Requires(Capability.UPLOAD_DOC, documentsResource)
  async uploadDocument(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<InitiateUploadData | ConfirmUploadData> {
    const ctx = actorContext(user, req);
    if (isConfirmBody(body)) {
      return this.documents.confirmUpload(id, parseUploadBody(UploadConfirmDto, body), ctx);
    }
    return this.documents.initiateUpload(id, parseUploadBody(UploadInitiateDto, body), ctx);
  }

  /**
   * POST /api/v1/leads/{id}/documents/{did}/waive — authorised waiver (200).
   * `verify_doc` (KYC/BM only) is enforced in the service via EntitlementService
   * plus an explicit role-code gate (RM/SM/PARTNER → 403).
   */
  @Post(':did/waive')
  @HttpCode(200)
  @Requires(Capability.VERIFY_DOC, documentsResource)
  async waiveDocument(
    @Param('id', new ZodValidationPipe(UuidParam)) id: string,
    @Param('did', new ZodValidationPipe(UuidParam)) did: string,
    @Body(new ZodValidationPipe(WaiverDto)) dto: WaiverDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AbacRequestContext,
  ): Promise<WaiverData> {
    return this.documents.waiveDocument(id, did, dto, actorContext(user, req));
  }
}

/** Build the service actor context from the authenticated request. */
function actorContext(user: AuthUser, req: AbacRequestContext): DocumentActorContext {
  return {
    userId: user.userId,
    orgId: user.orgId,
    role: user.role,
    predicate: req[SCOPE_PREDICATE_KEY],
    requestMeta: clientMeta(req),
  };
}

/** Client metadata recorded on audit rows (never logged raw). */
export function clientMeta(req: HttpRequestLike): ClientMeta {
  return {
    ip: readHeader(req, 'x-forwarded-for') ?? undefined,
    userAgent: readHeader(req, 'user-agent') ?? undefined,
  };
}
