import type {
  ApplicantScope,
  ConfigStatus,
  DocType,
  PanTiming,
  ProductCode,
} from '@lms/shared';

/**
 * FR-040 — web-side types for the Product Configuration admin screen. These mirror
 * the NestJS product-config module exactly (its repository row shapes and Zod
 * DTOs) so the uniform `{ data, meta, error }` envelope deserialises without a
 * cast. The large JSONB payloads (`field_schema`, `document_checklist`,
 * `sla_config`, `eligibility_mapping`) are only present on the single-item GET, not
 * the list view (the API omits them from list responses to keep payloads small —
 * LLD §1).
 */

/** The capture-form field types a `field_schema` field may declare. */
export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean', 'file'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** A single field inside a `field_schema` group. */
export interface FieldSchemaField {
  key: string;
  label: string;
  type: FieldType;
  mandatory: boolean;
  options?: string[];
}

/** A group of capture fields. */
export interface FieldSchemaGroup {
  id: string;
  label: string;
  fields: FieldSchemaField[];
}

export interface FieldSchema {
  groups: FieldSchemaGroup[];
}

/** A single mandatory/optional document requirement. */
export interface ChecklistItem {
  doc_type: DocType;
  mandatory: boolean;
  applicant_scope: ApplicantScope;
}

export interface DocumentChecklist {
  items: ChecklistItem[];
}

/** Free-form keys; numeric values are positive integer hours. */
export type SlaConfig = Record<string, number>;

/** A single LMS→LOS field mapping row. */
export interface EligibilityMappingField {
  lms_field: string;
  los_field: string;
}

export interface EligibilityMapping {
  fields: EligibilityMappingField[];
}

/** List-row view of a product config (no large JSONB payloads — LLD §1). */
export interface ProductConfigListRow {
  product_config_id: string;
  product_code: ProductCode;
  name: string;
  version: number;
  status: ConfigStatus;
  pan_required_at: PanTiming;
  created_at: string;
  updated_at: string;
  created_by: string;
}

/** Full single product config (GET /admin/products/{id}). */
export interface ProductConfig extends ProductConfigListRow {
  field_schema: FieldSchema;
  document_checklist: DocumentChecklist;
  sla_config: SlaConfig | null;
  eligibility_mapping: EligibilityMapping | null;
  org_id: string;
  updated_by: string;
}

/** POST /admin/products request body (CreateProductConfigDto). */
export interface CreateProductConfigBody {
  product_code: ProductCode;
  name: string;
  field_schema: FieldSchema;
  document_checklist: DocumentChecklist;
  sla_config?: SlaConfig;
  eligibility_mapping?: EligibilityMapping;
  pan_required_at: PanTiming;
}

/** PATCH /admin/products/{id} body — edit an active config (≥1 field), all optional. */
export interface UpdateProductConfigBody {
  name?: string;
  field_schema?: FieldSchema;
  document_checklist?: DocumentChecklist;
  sla_config?: SlaConfig;
  eligibility_mapping?: EligibilityMapping;
  pan_required_at?: PanTiming;
}

/** PATCH /admin/products/{id} body — retire (status-only). */
export interface RetireProductConfigBody {
  status: typeof ConfigStatus.RETIRED;
}

/** POST /admin/products 201 result (maker step — pending checker approval). */
export interface CreateProductConfigResult {
  product_config_id: string;
  version: number;
  status: ConfigStatus;
  configuration_version_id: string;
  config_version_status: 'pending';
}

/** PATCH (edit) 200 result — a new draft version awaiting checker approval. */
export interface EditProductConfigResult extends CreateProductConfigResult {
  based_on_version: number;
}

/** PATCH (retire) 200 result. */
export interface RetireProductConfigResult {
  product_config_id: string;
  status: ConfigStatus;
}
