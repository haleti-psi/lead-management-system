import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';

import { AuditAction, Capability, ERROR_CODES, RoleCode } from '@lms/shared';

import { AuditAppender } from '../../core/audit';
import { CurrentUser, Requires, type AuthUser } from '../../core/auth';
import { ZodValidationPipe } from '../../core/common';
import { UnitOfWork } from '../../core/db';
import { DomainException } from '../../core/http';
import { RetentionEngine, SYSTEM_ACTOR_ID } from './retention.engine';
import { RetentionPolicyRepository, rowToDto } from './retention-policy.repository';
import {
  CreateRetentionPolicyDto,
  ListRetentionPoliciesQuery,
  RunRetentionDto,
  type RetentionPolicyDto,
  type RetentionRunResponse,
} from './retention-policy.dto';
import type { DataCategory } from '@lms/shared';

/** ABAC resource resolver for retention policy endpoints. */
const retentionResource = () => ({ resourceType: 'retention_policies' as const });

/** Roles allowed to LIST / GET retention policies (DPO + ADMIN). */
const LIST_ALLOWED_ROLES = new Set<string>([RoleCode.DPO, RoleCode.ADMIN]);

/** Roles allowed to CREATE retention policies (ADMIN only per LLD §Auth Check #2). */
const CREATE_ALLOWED_ROLES = new Set<string>([RoleCode.ADMIN]);

/**
 * FR-115 — Retention Policy CRUD + run trigger.
 *
 * GET  /api/v1/admin/retention-policies   — DPO or ADMIN
 * POST /api/v1/admin/retention-policies   — ADMIN only
 * POST /api/v1/admin/retention/run        — dry_run: DPO or ADMIN; apply: ADMIN or system
 *
 * All endpoints are behind global JwtAuthGuard (implicit) + AbacGuard
 * via @Requires('configuration', retentionResource). The controller additionally
 * enforces the EXACT allowed-role set (capability alone admits many roles —
 * BM/HEAD/KYC also hold `configuration`, so explicit role checks are mandatory).
 */
@Controller('admin')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class RetentionPolicyController {
  constructor(
    private readonly repo: RetentionPolicyRepository,
    private readonly engine: RetentionEngine,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditAppender,
  ) {}

  // ── GET /admin/retention-policies ────────────────────────────────────────────

  /** List active retention policies (DPO + ADMIN, paginated). */
  @Get('retention-policies')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Requires(Capability.CONFIGURATION, retentionResource)
  async listRetentionPolicies(
    @Query(new ZodValidationPipe(ListRetentionPoliciesQuery)) query: ListRetentionPoliciesQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: RetentionPolicyDto[]; meta: { page: number; limit: number; total: number } }> {
    this.assertListRole(user.role);

    const { rows, total } = await this.repo.list({
      orgId: user.orgId,
      data_category: query.data_category,
      action: query.action,
      is_active: query.is_active,
      page: query.page,
      limit: query.limit,
    });

    return {
      data: rows.map(rowToDto),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  // ── POST /admin/retention-policies ───────────────────────────────────────────

  /** Create a retention policy (ADMIN only; consent category rejected). */
  @Post('retention-policies')
  @HttpCode(201)
  @Requires(Capability.CONFIGURATION, retentionResource)
  async createRetentionPolicy(
    @Body(new ZodValidationPipe(CreateRetentionPolicyDto)) dto: CreateRetentionPolicyDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RetentionPolicyDto> {
    this.assertCreateRole(user.role);

    // Service-layer guard: consent records are retention-exempt
    if (dto.data_category === 'consent') {
      throw new DomainException(
        ERROR_CODES.VALIDATION_ERROR,
        'Consent records cannot be targeted by a retention policy',
        {
          fields: [
            { field: 'data_category', issue: 'Consent records cannot be targeted by a retention policy' },
          ],
        },
      );
    }

    return this.uow.run(async (tx) => {
      const row = await this.repo.create(
        {
          org_id: user.orgId,
          data_category: dto.data_category as DataCategory,
          lead_outcome: dto.lead_outcome ?? null,
          retain_days: dto.retain_days,
          action: dto.action,
          legal_hold: dto.legal_hold,
          created_by: user.userId,
          updated_by: user.userId,
        },
        tx,
      );

      await this.audit.append(
        {
          action: AuditAction.CONFIG_CHANGE,
          entity_type: 'retention_policies',
          entity_id: row.retention_policy_id,
          actor_id: user.userId,
          org_id: user.orgId,
          lead_id: null,
          detail: {
            event: 'RETENTION_POLICY_CREATED',
            data_category: row.data_category,
            action: row.action,
            retain_days: row.retain_days,
          },
        },
        tx,
      );

      return rowToDto(row);
    });
  }

  // ── POST /admin/retention/run ─────────────────────────────────────────────────

  /**
   * Trigger a retention run.
   * dry_run → DPO or ADMIN; apply → ADMIN or system actor.
   * Returns 202 in both modes.
   */
  @Post('retention/run')
  @HttpCode(202)
  @Requires(Capability.CONFIGURATION, retentionResource)
  async runRetention(
    @Body(new ZodValidationPipe(RunRetentionDto)) dto: RunRetentionDto,
    @CurrentUser() user: AuthUser,
    @Req() _req: unknown,
  ): Promise<RetentionRunResponse> {
    // List-access check: DPO or ADMIN may call this endpoint
    this.assertListRole(user.role);

    const isSystemActor = user.userId === SYSTEM_ACTOR_ID;

    // Apply-mode restricted to ADMIN or system
    if (dto.mode === 'apply') {
      if (!CREATE_ALLOWED_ROLES.has(user.role) && !isSystemActor) {
        throw new DomainException(
          ERROR_CODES.FORBIDDEN,
          'Only ADMIN or system actor may trigger apply-mode retention runs.',
        );
      }
    }

    const runId = randomUUID();

    if (dto.mode === 'dry_run') {
      const preview = await this.engine.dryRun(
        user.orgId,
        dto.data_category as DataCategory | undefined,
      );

      return {
        run_id: runId,
        mode: 'dry_run',
        status: 'completed',
        preview,
      };
    }

    // apply mode — write run-start audit record; then run synchronously
    // (Cloud Tasks enqueue is out of scope for this implementation; run inline)
    await this.audit.append({
      action: AuditAction.CONFIG_CHANGE,
      entity_type: 'retention_run',
      entity_id: runId,
      actor_id: user.userId,
      org_id: user.orgId,
      lead_id: null,
      detail: {
        run_mode: 'apply',
        data_category: dto.data_category ?? null,
        status: 'started',
      },
    });

    // Run inline (non-blocking in practice would be Cloud Tasks, but the
    // controller returns 202 immediately; engine runs per-lead transactions).
    void this.engine.applyRun(runId, user.orgId, dto.data_category as DataCategory | undefined).then(() => {
      // Best-effort completion audit
      void this.audit.append({
        action: AuditAction.CONFIG_CHANGE,
        entity_type: 'retention_run',
        entity_id: runId,
        actor_id: SYSTEM_ACTOR_ID,
        org_id: user.orgId,
        lead_id: null,
        detail: { run_mode: 'apply', status: 'completed' },
      });
    }).catch((err: unknown) => {
      // Engine errors are already logged per-lead; only log at run level here
      const message = err instanceof Error ? err.message : 'unknown';
      void this.audit.append({
        action: AuditAction.CONFIG_CHANGE,
        entity_type: 'retention_run',
        entity_id: runId,
        actor_id: SYSTEM_ACTOR_ID,
        org_id: user.orgId,
        lead_id: null,
        detail: { run_mode: 'apply', status: 'failed', error: message },
      });
    });

    return {
      run_id: runId,
      mode: 'apply',
      status: 'queued',
      preview: null,
    };
  }

  // ── Role assertion helpers ────────────────────────────────────────────────────

  private assertListRole(role: string): void {
    if (!LIST_ALLOWED_ROLES.has(role)) {
      throw new DomainException(
        ERROR_CODES.FORBIDDEN,
        'Only DPO and ADMIN may access retention policies.',
      );
    }
  }

  private assertCreateRole(role: string): void {
    if (!CREATE_ALLOWED_ROLES.has(role)) {
      throw new DomainException(
        ERROR_CODES.FORBIDDEN,
        'Only ADMIN may create retention policies.',
      );
    }
  }
}
