import { Injectable } from '@nestjs/common';

import {
  ERROR_CODES,
  type DataScope,
  type PaginationMeta,
} from '@lms/shared';

import type { AuthUser } from '../../core/auth';
import type { PaginationParams } from '../../core/common';
import { DomainException } from '../../core/http';
import { SCOPE_WIDTH } from './workspace.constants';
import { LeadListRepository } from './lead-list.repository';
import type { WorkspaceScopeContext } from './lead-list.service';
import { SavedViewRepository, type SavedViewRow } from './saved-view.repository';
import type { CreateSavedViewDto } from './dto/create-saved-view.dto';

/** Wire shape of a saved view (LLD §Endpoint 2 list item). */
export interface SavedViewView {
  saved_view_id: string;
  name: string;
  filter_json: unknown;
  is_shared: boolean;
  scope: DataScope;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface SavedViewListResult {
  data: SavedViewView[];
  pagination: PaginationMeta;
}

/**
 * FR-050 — saved-view read/create (M6 is the sole writer of `saved_views`).
 * List = own ∪ in-scope shared (SQL predicate; out-of-scope rows are simply
 * absent — no 403). Create enforces the share-width rule: a view may not be
 * shared into a scope wider than the caller's own `view_lead` scope.
 */
@Injectable()
export class SavedViewService {
  constructor(
    private readonly repo: SavedViewRepository,
    private readonly users: LeadListRepository,
  ) {}

  async list(user: AuthUser, params: PaginationParams, ctx: WorkspaceScopeContext): Promise<SavedViewListResult> {
    // The caller's org placement (branch/team/region) anchors the audience-
    // membership legs; an unknown caller row degrades to own + org-wide legs.
    const caller = (await this.users.findActiveUser(user.orgId, user.userId)) ?? {
      user_id: user.userId,
      branch_id: null,
      team_id: null,
      region_id: null,
    };
    const { rows, total } = await this.repo.list(
      user.orgId,
      caller,
      ctx.predicate,
      params.page,
      params.limit,
    );
    return {
      data: rows.map(toView),
      pagination: { page: params.page, limit: params.limit, total },
    };
  }

  async create(user: AuthUser, dto: CreateSavedViewDto, ctx: WorkspaceScopeContext): Promise<SavedViewView> {
    // Deny-by-default: the guard always sets the effective scope on a grant.
    if (!ctx.effectiveScope) {
      throw new DomainException(ERROR_CODES.FORBIDDEN);
    }
    // Share-width rule (LLD §Validation): is_shared=true ⇒ scope ⊆ caller's own.
    if (dto.is_shared && SCOPE_WIDTH[dto.scope] > SCOPE_WIDTH[ctx.effectiveScope]) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: [{ field: 'scope', issue: 'you cannot share a view wider than your own scope' }],
      });
    }

    const row = await this.repo.create({
      org_id: user.orgId,
      owner_id: user.userId,
      name: dto.name,
      filter_json: dto.filter_json,
      is_shared: dto.is_shared,
      scope: dto.scope,
    });
    return toView(row);
  }
}

function toView(row: SavedViewRow): SavedViewView {
  return {
    saved_view_id: row.saved_view_id,
    name: row.name,
    filter_json: row.filter_json,
    is_shared: row.is_shared,
    scope: row.scope,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
