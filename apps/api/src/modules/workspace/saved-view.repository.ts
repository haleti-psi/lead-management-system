import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';

import { DataScope, type ScopePredicate } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import type { SavedViews } from '../../core/db/types.generated';
import type { WorkspaceUserRef } from './lead-list.repository';

/** Full `saved_views` row (M6-owned; FR-050 is its sole writer). */
export type SavedViewRow = Selectable<SavedViews>;

/** Insert fields for `POST /saved-views` (LLD §Data Operations · create). */
export interface SavedViewWriteFields {
  org_id: string;
  owner_id: string;
  name: string;
  filter_json: Record<string, unknown>;
  is_shared: boolean;
  scope: DataScope;
}

/**
 * FR-050 — `saved_views` reads + the single write path (owner-writes §11: M6
 * owns `saved_views` ONLY). List visibility = own ∪ in-scope shared, compiled
 * into SQL (LLD §Endpoint 2):
 *
 * - **audience membership** — the caller sits inside the scope the owner
 *   shared into (`A` = whole org; `B`/`T`/`R` = same branch/team/region as the
 *   owner), and
 * - **scope containment** — the owner sits inside the caller's own `view_lead`
 *   scope (a BM sees views shared by the SMs/RMs of their branch — TC-17).
 *
 * Out-of-scope shared views are simply not returned (no 403).
 */
@Injectable()
export class SavedViewRepository {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /** Own ∪ in-scope shared, newest first, LIMIT-bounded; plus the same-WHERE total. */
  async list(
    orgId: string,
    caller: WorkspaceUserRef,
    predicate: ScopePredicate | undefined,
    page: number,
    limit: number,
  ): Promise<{ rows: SavedViewRow[]; total: number }> {
    const base = this.visibleViews(orgId, caller, predicate);
    const [rows, totalRow] = await Promise.all([
      base
        .selectAll('sv')
        .orderBy('sv.updated_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit)
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirst(),
    ]);
    return { rows, total: Number(totalRow?.total ?? 0) };
  }

  /** Single-row INSERT (no UnitOfWork needed — §11.1 covers multi-entity only). */
  async create(fields: SavedViewWriteFields): Promise<SavedViewRow> {
    return this.db
      .insertInto('saved_views')
      .values({
        org_id: fields.org_id,
        owner_id: fields.owner_id,
        name: fields.name,
        filter_json: JSON.stringify(fields.filter_json),
        is_shared: fields.is_shared,
        scope: fields.scope,
        created_by: fields.owner_id,
        updated_by: fields.owner_id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Visibility query (exposed for compile-level component tests). */
  visibleViews(orgId: string, caller: WorkspaceUserRef, predicate: ScopePredicate | undefined) {
    return this.db
      .selectFrom('saved_views as sv')
      .leftJoin('users as u', 'u.user_id', 'sv.owner_id')
      .where('sv.org_id', '=', orgId)
      .where((eb) => {
        const shared = [
          // (b) audience membership — caller inside the owner's shared scope.
          eb('sv.scope', '=', DataScope.A),
          ...(caller.branch_id !== null
            ? [eb.and([eb('sv.scope', '=', DataScope.B), eb('u.branch_id', '=', caller.branch_id)])]
            : []),
          ...(caller.team_id !== null
            ? [eb.and([eb('sv.scope', '=', DataScope.T), eb('u.team_id', '=', caller.team_id)])]
            : []),
          ...(caller.region_id !== null
            ? [eb.and([eb('sv.scope', '=', DataScope.R), eb('u.region_id', '=', caller.region_id)])]
            : []),
        ];
        // (a) scope containment — owner inside the caller's view_lead scope.
        if (predicate) {
          switch (predicate.type) {
            case 'team':
              if (predicate.userIds.length > 0) {
                shared.push(eb('sv.owner_id', 'in', [...predicate.userIds]));
              }
              break;
            case 'branch':
              shared.push(eb('u.branch_id', '=', predicate.branchId));
              break;
            case 'region':
              if (predicate.branchIds.length > 0) {
                shared.push(eb('u.branch_id', 'in', [...predicate.branchIds]));
              }
              break;
            case 'all':
            case 'masked':
              shared.push(eb.val(true));
              break;
            default:
              // own/partner/customer_token add no extra shared leg.
              break;
          }
        }
        return eb.or([
          eb('sv.owner_id', '=', caller.user_id),
          eb.and([eb('sv.is_shared', '=', true), eb.or(shared)]),
        ]);
      });
  }
}
