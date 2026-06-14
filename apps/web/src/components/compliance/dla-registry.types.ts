/**
 * FR-113 — DLA/LSP Registry resource types shared across web components.
 * Mirror of the API response shape (api-contract.yaml `listDla` / `createDla` /
 * `updateDla`).
 */

export type DlaType = 'dla' | 'lsp' | 'partner';
export type ConfigStatus = 'draft' | 'active' | 'retired';
export type ProductCode = 'CV' | 'CAR' | 'TRACTOR' | 'CE' | 'TW' | 'SBL' | 'HRM';

export interface GrievanceOfficer {
  name: string;
  email: string;
  phone: string;
}

export interface DlaItem {
  dlaRegistryId: string;
  name: string;
  type: DlaType;
  owner: string | null;
  url: string | null;
  grievanceOfficer: GrievanceOfficer | null;
  enabledProducts: ProductCode[] | null;
  dataCollected: string[] | null;
  storageLocation: string | null;
  status: ConfigStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DlaListResult {
  data: DlaItem[];
  meta: {
    correlation_id: string;
    pagination: { page: number; limit: number; total: number };
  };
  error: null;
}

export interface CreateDlaInput {
  name: string;
  type: DlaType;
  owner?: string | null;
  url?: string | null;
  grievance_officer?: GrievanceOfficer | null;
  enabled_products?: ProductCode[] | null;
  data_collected?: string[] | null;
  storage_location?: string | null;
  status?: ConfigStatus;
}

export interface UpdateDlaInput {
  dla_registry_id: string;
  name?: string;
  type?: DlaType;
  owner?: string | null;
  url?: string | null;
  grievance_officer?: GrievanceOfficer | null;
  enabled_products?: ProductCode[] | null;
  data_collected?: string[] | null;
  storage_location?: string | null;
  status?: ConfigStatus;
}

/** Human-readable labels for each DLA type. */
export const DLA_TYPE_LABELS: Record<DlaType, string> = {
  dla: 'DLA',
  lsp: 'LSP',
  partner: 'Partner',
};

/** Human-readable labels for each config_status value. */
export const CONFIG_STATUS_LABELS: Record<ConfigStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  retired: 'Retired',
};

/**
 * Valid forward transitions for DLA registry status.
 * draft → active → retired (no reversals).
 */
export const VALID_DLA_STATUS_TRANSITIONS: Partial<Record<ConfigStatus, ConfigStatus[]>> = {
  draft: ['active'],
  active: ['retired'],
  retired: [],
};

/** Returns the valid next status options for the given current status. */
export function nextDlaStatuses(current: ConfigStatus): ConfigStatus[] {
  return VALID_DLA_STATUS_TRANSITIONS[current] ?? [];
}
