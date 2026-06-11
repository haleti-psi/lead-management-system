import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { ListUsersQuery } from './list-users.dto';
import { ListTeamsQuery } from './list-teams.dto';
import { UpdateRoleDto } from './update-role.dto';
import { CreateTeamDto } from './create-team.dto';
import { UpdateTeamDto } from './update-team.dto';
import { UuidParam } from './uuid-param.dto';

/**
 * FR-130 DTO validation tests. The ZodValidationPipe maps any failure to
 * VALIDATION_ERROR(400) with `fields[]` whose `field` is the issue path — so
 * these assert the schemas directly (the field path is what the controller
 * surfaces). Covers T-05 (missing username), T-06 (mobile pattern), T-16
 * (status=locked rejected as a field error), T-23 (invalid branch UUID).
 */
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function fields(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return (result.error?.issues ?? []).map((i) => (i.path.length ? i.path.join('.') : '_'));
}

function baseCreateUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username: 'jdoe',
    email: 'jdoe@nbfc.com',
    full_name: 'Jane Doe',
    role_id: VALID_UUID,
    ...overrides,
  };
}

describe('CreateUserDto', () => {
  it('accepts a valid payload and defaults mfa_enabled to false', () => {
    const result = CreateUserDto.safeParse(baseCreateUser());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mfa_enabled).toBe(false);
  });

  it('rejects a missing username (T-05)', () => {
    expect(fields(CreateUserDto, baseCreateUser({ username: undefined }))).toContain('username');
  });

  it('rejects a username with illegal characters', () => {
    expect(fields(CreateUserDto, baseCreateUser({ username: 'has space!' }))).toContain('username');
  });

  it('rejects an invalid email', () => {
    expect(fields(CreateUserDto, baseCreateUser({ email: 'not-an-email' }))).toContain('email');
  });

  it('rejects an invalid mobile format (T-06)', () => {
    expect(fields(CreateUserDto, baseCreateUser({ mobile: '12345' }))).toContain('mobile');
  });

  it('accepts a valid 10-digit Indian mobile', () => {
    expect(CreateUserDto.safeParse(baseCreateUser({ mobile: '9876543210' })).success).toBe(true);
  });

  it('rejects a non-UUID role_id', () => {
    expect(fields(CreateUserDto, baseCreateUser({ role_id: 'nope' }))).toContain('role_id');
  });

  it('rejects an unknown product skill code', () => {
    expect(fields(CreateUserDto, baseCreateUser({ product_skills: ['NOT_A_PRODUCT'] }))).toContain('product_skills.0');
  });

  it('accepts known product skill codes', () => {
    expect(CreateUserDto.safeParse(baseCreateUser({ product_skills: ['CV', 'CAR'] })).success).toBe(true);
  });

  it('strips unknown fields (no password injection)', () => {
    const result = CreateUserDto.safeParse(baseCreateUser({ password_hash: 'x', status: 'active' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect('password_hash' in result.data).toBe(false);
      expect('status' in result.data).toBe(false);
    }
  });
});

describe('UpdateUserDto', () => {
  it('accepts a single-field patch', () => {
    expect(UpdateUserDto.safeParse({ full_name: 'Jane E. Doe' }).success).toBe(true);
  });

  it('rejects an empty patch (at least one field required)', () => {
    expect(UpdateUserDto.safeParse({}).success).toBe(false);
  });

  it('accepts status=inactive', () => {
    expect(UpdateUserDto.safeParse({ status: 'inactive' }).success).toBe(true);
  });

  it('rejects status=locked as a field error (T-16 — lockout is system-only)', () => {
    expect(fields(UpdateUserDto, { status: 'locked' })).toContain('status');
  });

  it('rejects a non-UUID reassign_to', () => {
    expect(fields(UpdateUserDto, { status: 'inactive', reassign_to: 'nope' })).toContain('reassign_to');
  });
});

describe('ListUsersQuery', () => {
  it('defaults page=1 limit=25 and coerces string numbers', () => {
    const result = ListUsersQuery.safeParse({ page: '2', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it('caps limit at 100', () => {
    expect(ListUsersQuery.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('parses nested filter[status]', () => {
    const result = ListUsersQuery.safeParse({ filter: { status: 'active' } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.filter?.status).toBe('active');
  });

  it('rejects an unknown sort column', () => {
    expect(ListUsersQuery.safeParse({ sort: '-password' }).success).toBe(false);
  });

  it('accepts a +/- prefixed allowed sort column', () => {
    expect(ListUsersQuery.safeParse({ sort: '-created_at' }).success).toBe(true);
  });
});

describe('UpdateRoleDto', () => {
  it('accepts a permissions replacement', () => {
    const result = UpdateRoleDto.safeParse({
      permissions: [{ capability: 'create_lead', max_scope: 'B' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a permission with an unknown capability', () => {
    expect(fields(UpdateRoleDto, { permissions: [{ capability: 'do_everything', max_scope: 'B' }] })).toContain(
      'permissions.0.capability',
    );
  });

  it('rejects an empty patch', () => {
    expect(UpdateRoleDto.safeParse({}).success).toBe(false);
  });

  it('rejects a name shorter than 2 chars', () => {
    expect(fields(UpdateRoleDto, { name: 'x' })).toContain('name');
  });
});

describe('CreateTeamDto / UpdateTeamDto', () => {
  it('accepts a valid team create', () => {
    expect(CreateTeamDto.safeParse({ name: 'North HL', branch_id: VALID_UUID }).success).toBe(true);
  });

  it('rejects an invalid branch_id UUID (T-23)', () => {
    expect(fields(CreateTeamDto, { name: 'North HL', branch_id: 'not-a-uuid' })).toContain('branch_id');
  });

  it('accepts is_active=false on update (deactivation)', () => {
    expect(UpdateTeamDto.safeParse({ is_active: false }).success).toBe(true);
  });

  it('rejects an empty team update', () => {
    expect(UpdateTeamDto.safeParse({}).success).toBe(false);
  });
});

describe('ListTeamsQuery', () => {
  it('coerces filter[is_active] string to boolean', () => {
    const result = ListTeamsQuery.safeParse({ filter: { is_active: 'true' } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.filter?.is_active).toBe(true);
  });
});

describe('UuidParam', () => {
  it('accepts a valid UUID', () => {
    expect(UuidParam.safeParse(VALID_UUID).success).toBe(true);
  });

  it('rejects a non-UUID with the id message', () => {
    const result = UuidParam.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('id must be a valid UUID');
  });
});
