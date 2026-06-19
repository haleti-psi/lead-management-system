import type { RoleCode } from '@lms/shared';
import { useAuth } from '@/hooks/use-auth';

/**
 * Client-side mirror of docs/contracts/auth-matrix.json `capability_matrix`.
 *
 * The access-token JWT carries only `role` (+ scope), so the web maps role →
 * capabilities here to gate UI affordances (nav items, quick-create, buttons).
 * This is a UI convenience ONLY — the server's `EntitlementService.can()`
 * (FR-002) remains authoritative for every protected action. Keep this table in
 * sync with auth-matrix.json; it does not grant access, it only hides controls
 * the user cannot use.
 */
export type Capability =
  | 'create_lead'
  | 'view_lead'
  | 'edit_lead'
  | 'upload_doc'
  | 'verify_doc'
  | 'kyc_signoff'
  | 'move_stage'
  | 'hand_off'
  | 'approve_lead'
  | 'allocate'
  | 'bulk_action'
  | 'customer_comm'
  | 'reports'
  | 'export'
  | 'consent_ledger'
  | 'audit_trail'
  | 'configuration'
  | 'user_mgmt'
  | 'break_glass';

export const ROLE_CAPABILITIES: Readonly<Record<RoleCode, readonly Capability[]>> = {
  RM: ['create_lead', 'view_lead', 'edit_lead', 'upload_doc', 'verify_doc', 'move_stage', 'hand_off', 'customer_comm', 'reports', 'export', 'consent_ledger', 'audit_trail'],
  BM: ['create_lead', 'view_lead', 'edit_lead', 'upload_doc', 'verify_doc', 'kyc_signoff', 'move_stage', 'hand_off', 'approve_lead', 'allocate', 'bulk_action', 'customer_comm', 'reports', 'export', 'consent_ledger', 'audit_trail', 'configuration'],
  SM: ['create_lead', 'view_lead', 'edit_lead', 'move_stage', 'approve_lead', 'allocate', 'bulk_action', 'customer_comm', 'reports', 'export', 'consent_ledger', 'audit_trail'],
  HEAD: ['create_lead', 'view_lead', 'approve_lead', 'allocate', 'bulk_action', 'reports', 'export', 'consent_ledger', 'audit_trail', 'configuration'],
  KYC: ['view_lead', 'edit_lead', 'upload_doc', 'verify_doc', 'kyc_signoff', 'move_stage', 'hand_off', 'bulk_action', 'customer_comm', 'reports', 'export', 'consent_ledger', 'audit_trail', 'configuration'],
  DPO: ['view_lead', 'kyc_signoff', 'hand_off', 'reports', 'export', 'consent_ledger', 'audit_trail', 'configuration', 'break_glass'],
  PARTNER: ['create_lead', 'view_lead', 'edit_lead', 'upload_doc', 'move_stage', 'customer_comm', 'reports', 'export', 'consent_ledger', 'audit_trail'],
  ADMIN: ['user_mgmt', 'configuration', 'audit_trail', 'export', 'consent_ledger', 'customer_comm', 'break_glass'],
  CUSTOMER: ['create_lead', 'view_lead', 'edit_lead', 'upload_doc', 'customer_comm', 'consent_ledger', 'audit_trail', 'export'],
};

export function can(role: RoleCode, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Hook form: returns a predicate bound to the current user's role. */
export function useCan(): (capability: Capability) => boolean {
  const { user } = useAuth();
  return (capability: Capability) => (user ? can(user.role, capability) : false);
}
