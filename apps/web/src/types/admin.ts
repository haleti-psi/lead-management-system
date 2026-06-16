/**
 * FR-130 — User / Role / Team administration view & request types.
 *
 * These mirror the API views returned by the NestJS admin controllers
 * (`admin-users.controller.ts`, `admin-roles.controller.ts`,
 * `admin-teams.controller.ts`) and the request DTOs (`create-user.dto.ts`,
 * `update-user.dto.ts`, `update-role.dto.ts`, `create-team.dto.ts`,
 * `update-team.dto.ts`). `email`/`mobile` arrive ALREADY MASKED from the server's
 * MaskingInterceptor — the web never receives or sends raw PII here.
 */
import type { Capability, DataScope, ProductCode, UserStatus } from '@lms/shared';

/** A user row as returned by `GET/POST/PATCH /admin/users` (masked email/mobile). */
export interface UserView {
  user_id: string;
  username: string;
  full_name: string;
  /** Server-masked, e.g. `j***@example.com`. */
  email: string;
  /** Server-masked, e.g. `98xxxxxx10`; null when unset. */
  mobile: string | null;
  role_id: string;
  role_code: string | null;
  branch_id: string | null;
  team_id: string | null;
  region_id: string | null;
  partner_id: string | null;
  product_skills: ProductCode[] | null;
  mfa_enabled: boolean;
  status: UserStatus;
  reporting_manager_id: string | null;
  last_login_at: string | null;
  created_at: string;
}

/** `POST /admin/users` body (CreateUserDto). */
export interface CreateUserBody {
  username: string;
  email: string;
  full_name: string;
  mobile?: string;
  role_id: string;
  branch_id?: string;
  team_id?: string;
  region_id?: string;
  partner_id?: string;
  product_skills?: ProductCode[];
  reporting_manager_id?: string;
  mfa_enabled?: boolean;
}

/**
 * `PATCH /admin/users/{id}` body (UpdateUserDto). All fields optional (partial
 * update, ≥1 required). `status` is restricted to `active`/`inactive` server-side
 * — a `locked` value is rejected (lockout is system-only). `reassign_to` is the
 * UUID of the user to receive open leads when deactivating a user that owns any.
 */
export interface UpdateUserBody {
  full_name?: string;
  mobile?: string;
  role_id?: string;
  branch_id?: string;
  team_id?: string;
  region_id?: string;
  partner_id?: string;
  product_skills?: ProductCode[];
  reporting_manager_id?: string;
  mfa_enabled?: boolean;
  status?: Extract<UserStatus, 'active' | 'inactive'>;
  reassign_to?: string;
}

/** One capability grant on a role (`role_permissions` row). */
export interface RolePermissionView {
  role_permission_id: string;
  capability: Capability;
  max_scope: DataScope;
}

/** A role + its permission set as returned by `GET/PATCH /admin/roles`. */
export interface RoleView {
  role_id: string;
  code: string;
  name: string;
  default_scope: DataScope;
  is_external: boolean;
  permissions: RolePermissionView[];
}

/** `PATCH /admin/roles/{id}` body (UpdateRoleDto). `code` is never editable. */
export interface UpdateRoleBody {
  name?: string;
  default_scope?: DataScope;
  /** When present, REPLACES the role's whole permission set. */
  permissions?: Array<{ capability: Capability; max_scope: DataScope }>;
}

/** A team as returned by `GET/POST/PATCH /admin/teams`. */
export interface TeamView {
  team_id: string;
  name: string;
  branch_id: string;
  manager_id: string | null;
  is_active: boolean;
}

/** `POST /admin/teams` body (CreateTeamDto). */
export interface CreateTeamBody {
  name: string;
  branch_id: string;
  manager_id?: string;
}

/** `PATCH /admin/teams/{id}` body (UpdateTeamDto). `is_active:false` deactivates. */
export interface UpdateTeamBody {
  name?: string;
  branch_id?: string;
  manager_id?: string;
  is_active?: boolean;
}

/**
 * A reference-data option (branch / region) sourced from the FR-131 master
 * endpoints (`GET /admin/branches`, `GET /admin/regions`). Only the id + label
 * fields the admin forms need are modelled; the full master record carries more.
 */
export interface RefDataOption {
  id: string;
  code: string;
  name: string;
}
