import type {
  ConsentStatus,
  DataScope,
  KycStatus,
  LeadStage,
  Priority,
  ProductCode,
} from '@lms/shared';

/**
 * FR-050 — a row of the scope-filtered lead list. EXACTLY the contract `Lead`
 * schema (api-contract.yaml#/components/schemas/Lead) returned by `GET /leads`:
 * raw `name`/`mobile`/`pan` are never serialised — only the masked projections
 * leave the server. `score` is `null` when the lead is unscored.
 */
export interface LeadListItem {
  lead_id: string;
  lead_code: string;
  stage: LeadStage;
  product_code: ProductCode;
  is_hot: boolean;
  score: number | null;
  consent_status: ConsentStatus;
  kyc_status: KycStatus;
  name_masked: string | null;
  mobile_masked: string | null;
}

/** Score band buckets (LLD §Data Operations `score_band`). */
export type ScoreBand = 'hot' | 'warm' | 'cold' | 'unscored';

/** First-contact SLA buckets (LLD §Data Operations `sla_state`). */
export type SlaState = 'breached' | 'due_soon' | 'ok' | 'none';

/**
 * The allow-listed lead-list filters the UI sends as `filter[<key>]=<value>`
 * query params (LLD §Validation `FILTER_ALLOWLIST`). Every field is optional;
 * only present keys are sent. Kept as a flat string map of single values — the
 * filter controls are single-select, and the page reads/writes them via the URL
 * query string so dashboard drill-through links work unchanged.
 */
export interface LeadListFilters {
  stage?: LeadStage;
  product_code?: ProductCode;
  owner_id?: string;
  branch_id?: string;
  team_id?: string;
  partner?: string;
  priority?: Priority;
  consent_status?: ConsentStatus;
  kyc_status?: KycStatus;
  is_hot?: boolean;
  score_band?: ScoreBand;
  sla_state?: SlaState;
  date_from?: string;
  date_to?: string;
}

/** Params for `useLeads` (page/limit/sort + free-text `q` + allow-listed filters). */
export interface LeadListParams {
  page: number;
  limit: number;
  sort: string;
  q?: string;
  filters: LeadListFilters;
}

/**
 * FR-050 — a saved work queue (`GET /saved-views` item). `filter_json` is an
 * opaque persisted instance of the same filter grammar; the UI applies it by
 * mapping known keys back onto the list filters. Dates arrive as ISO strings.
 */
export interface SavedView {
  saved_view_id: string;
  name: string;
  filter_json: LeadListFilters;
  is_shared: boolean;
  scope: DataScope;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

/** Body for `POST /saved-views` (LLD §Endpoint 3). */
export interface CreateSavedViewBody {
  name: string;
  filter_json: LeadListFilters;
  is_shared: boolean;
  scope: DataScope;
}
