import type { AuthUser } from '../../core/auth';
import { PaginationParams } from '../../core/common';
import type { LeadListRepository } from './lead-list.repository';
import type { WorkspaceScopeContext } from './lead-list.service';
import { SavedViewService } from './saved-view.service';
import type { SavedViewRepository, SavedViewRow } from './saved-view.repository';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';

/**
 * FR-050 — saved-view service: TC-16 (create happy path, owner fields), TC-19
 * (over-wide share → VALIDATION_ERROR on `scope`), TC-17 service slice (list
 * passes the caller placement + predicate to the visibility query and maps
 * rows to the wire shape).
 */

const ORG = '00000000-0000-0000-0000-000000000001';
const bm: AuthUser = { userId: 'bm-1', orgId: ORG, role: 'BM', scope: 'B', jti: 'j1' };
const rm: AuthUser = { userId: 'rm-1', orgId: ORG, role: 'RM', scope: 'O', jti: 'j2' };

const bmCtx: WorkspaceScopeContext = {
  effectiveScope: 'B',
  predicate: { type: 'branch', branchId: 'branch-1' },
};
const rmCtx: WorkspaceScopeContext = {
  effectiveScope: 'O',
  predicate: { type: 'own', userId: 'rm-1' },
};

function viewRow(overrides: Partial<SavedViewRow> = {}): SavedViewRow {
  return {
    saved_view_id: 'sv-1',
    org_id: ORG,
    owner_id: 'bm-1',
    name: 'Hot CV — North',
    filter_json: { is_hot: true },
    is_shared: true,
    scope: 'B',
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-02T00:00:00Z'),
    created_by: 'bm-1',
    updated_by: 'bm-1',
    ...overrides,
  };
}

interface Harness {
  service: SavedViewService;
  repo: { list: jest.Mock; create: jest.Mock };
  users: { findActiveUser: jest.Mock };
}

function makeHarness(rows: SavedViewRow[] = [viewRow()]): Harness {
  const repo = {
    list: jest.fn().mockResolvedValue({ rows, total: rows.length }),
    create: jest.fn(async (fields: Record<string, unknown>) =>
      viewRow({
        owner_id: fields['owner_id'] as string,
        name: fields['name'] as string,
        is_shared: fields['is_shared'] as boolean,
        created_by: fields['owner_id'] as string,
        updated_by: fields['owner_id'] as string,
      }),
    ),
  };
  const users = {
    findActiveUser: jest.fn().mockResolvedValue({
      user_id: 'bm-1',
      branch_id: 'branch-1',
      team_id: null,
      region_id: 'region-1',
    }),
  };
  const service = new SavedViewService(
    repo as unknown as SavedViewRepository,
    users as unknown as LeadListRepository,
  );
  return { service, repo, users };
}

const page = PaginationParams.parse({});

describe('SavedViewService.list', () => {
  it("TC-17: queries own ∪ in-scope shared with the caller's placement + predicate", async () => {
    const { service, repo, users } = makeHarness();
    const result = await service.list(bm, page, bmCtx);

    expect(users.findActiveUser).toHaveBeenCalledWith(ORG, 'bm-1');
    expect(repo.list).toHaveBeenCalledWith(
      ORG,
      { user_id: 'bm-1', branch_id: 'branch-1', team_id: null, region_id: 'region-1' },
      bmCtx.predicate,
      1,
      25,
    );
    expect(result.pagination).toEqual({ page: 1, limit: 25, total: 1 });
    expect(result.data[0]).toEqual({
      saved_view_id: 'sv-1',
      name: 'Hot CV — North',
      filter_json: { is_hot: true },
      is_shared: true,
      scope: 'B',
      owner_id: 'bm-1',
      created_at: new Date('2026-06-01T00:00:00Z'),
      updated_at: new Date('2026-06-02T00:00:00Z'),
    });
    // Internal columns are not serialised.
    const keys = Object.keys(result.data[0] ?? {});
    expect(keys).not.toContain('org_id');
    expect(keys).not.toContain('created_by');
  });

  it('degrades to a placement-less caller when the users row is missing', async () => {
    const { service, repo, users } = makeHarness();
    users.findActiveUser.mockResolvedValueOnce(undefined);
    await service.list(bm, page, bmCtx);
    expect(repo.list).toHaveBeenCalledWith(
      ORG,
      { user_id: 'bm-1', branch_id: null, team_id: null, region_id: null },
      bmCtx.predicate,
      1,
      25,
    );
  });
});

describe('SavedViewService.create', () => {
  const body = (overrides: Record<string, unknown> = {}) =>
    CreateSavedViewDto.parse({
      name: 'Hot CV — North',
      filter_json: { is_hot: true, stage: ['documents_pending'] },
      is_shared: false,
      scope: 'O',
      ...overrides,
    });

  it('TC-16: persists with owner_id = caller and returns the wire view', async () => {
    const { service, repo } = makeHarness();
    const created = await service.create(bm, body(), bmCtx);

    expect(repo.create).toHaveBeenCalledWith({
      org_id: ORG,
      owner_id: 'bm-1',
      name: 'Hot CV — North',
      filter_json: { is_hot: true, stage: ['documents_pending'] },
      is_shared: false,
      scope: 'O',
    });
    expect(created.saved_view_id).toBe('sv-1');
    expect(created.owner_id).toBe('bm-1');
  });

  it('TC-19: an RM (scope O) cannot share a view org-wide — VALIDATION_ERROR on scope', async () => {
    const { service, repo } = makeHarness();
    await expect(
      service.create(rm, body({ is_shared: true, scope: 'A' }), rmCtx),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: [{ field: 'scope', issue: 'you cannot share a view wider than your own scope' }],
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('sharing at or below the caller scope is allowed (BM shares B and O)', async () => {
    const { service, repo } = makeHarness();
    await service.create(bm, body({ is_shared: true, scope: 'B' }), bmCtx);
    await service.create(bm, body({ is_shared: true, scope: 'O' }), bmCtx);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it('an unshared view skips the width check (scope is inert)', async () => {
    const { service, repo } = makeHarness();
    await service.create(rm, body({ is_shared: false, scope: 'A' }), rmCtx);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('deny-by-default: a missing effective scope is FORBIDDEN', async () => {
    const { service, repo } = makeHarness();
    await expect(service.create(bm, body(), {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
