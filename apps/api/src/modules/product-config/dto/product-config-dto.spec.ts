import { ConfigStatus } from '@lms/shared';

import { CreateProductConfigDto } from './create-product-config.dto';
import { UpdateProductConfigDto } from './update-product-config.dto';
import { ListProductConfigsQueryDto, toListParams } from './list-product-configs.dto';

/**
 * FR-040 — DTO validation tests (LLD §Validation Logic). These exercise the Zod
 * schemas directly, asserting both the accept path and the field-level rejects
 * that become `VALIDATION_ERROR` (400) at the controller boundary.
 */

const VALID_FIELD_SCHEMA = {
  groups: [
    {
      id: 'asset',
      label: 'Asset',
      fields: [{ key: 'vehicle_type', label: 'Vehicle Type', type: 'select', mandatory: true, options: ['LCV'] }],
    },
  ],
};

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    product_code: 'CV',
    name: 'CV v1',
    field_schema: VALID_FIELD_SCHEMA,
    document_checklist: { items: [{ doc_type: 'id', mandatory: true, applicant_scope: 'applicant' }] },
    sla_config: { capture_to_contact_hours: 4 },
    eligibility_mapping: { fields: [{ lms_field: 'vehicle_type', los_field: 'assetType' }] },
    pan_required_at: 'before_kyc',
    ...overrides,
  };
}

/** Find the first issue whose dotted path matches `path`. */
function issuePath(result: { success: false; error: { issues: { path: (string | number)[] }[] } }): string {
  return result.error.issues.map((i) => i.path.join('.'))[0];
}

describe('CreateProductConfigDto', () => {
  it('accepts a fully valid payload', () => {
    expect(CreateProductConfigDto.safeParse(validCreate()).success).toBe(true);
  });

  it('accepts when optional sla_config / eligibility_mapping are omitted', () => {
    const result = CreateProductConfigDto.safeParse(
      validCreate({ sla_config: undefined, eligibility_mapping: undefined }),
    );
    expect(result.success).toBe(true);
  });

  it('TC-A07 — rejects an invalid product_code', () => {
    const result = CreateProductConfigDto.safeParse(validCreate({ product_code: 'TRUCK' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['product_code']);
  });

  it('TC-A06 — rejects field_schema missing groups', () => {
    const result = CreateProductConfigDto.safeParse(validCreate({ field_schema: {} }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe('field_schema');
  });

  it('rejects a select field with no options', () => {
    const bad = {
      groups: [
        { id: 'g', label: 'G', fields: [{ key: 'k', label: 'L', type: 'select', mandatory: true }] },
      ],
    };
    const result = CreateProductConfigDto.safeParse(validCreate({ field_schema: bad }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePath(result)).toContain('options');
  });

  it('rejects a field key containing spaces', () => {
    const bad = {
      groups: [
        { id: 'g', label: 'G', fields: [{ key: 'bad key', label: 'L', type: 'text', mandatory: false }] },
      ],
    };
    expect(CreateProductConfigDto.safeParse(validCreate({ field_schema: bad })).success).toBe(false);
  });

  it('TC-A09 — rejects an invalid document_checklist doc_type', () => {
    const result = CreateProductConfigDto.safeParse(
      validCreate({ document_checklist: { items: [{ doc_type: 'passport', mandatory: true, applicant_scope: 'applicant' }] } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path.join('.')).toContain('doc_type');
  });

  it('TC-U03 / TC-A08 — rejects eligibility_mapping referencing an undeclared lms_field', () => {
    const result = CreateProductConfigDto.safeParse(
      validCreate({ eligibility_mapping: { fields: [{ lms_field: 'unknown_field', los_field: 'x' }] } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['eligibility_mapping', 'fields', 0, 'lms_field']);
    }
  });

  it('rejects sla_config with a non-positive integer hour value', () => {
    const result = CreateProductConfigDto.safeParse(validCreate({ sla_config: { capture_to_contact_hours: -1 } }));
    expect(result.success).toBe(false);
  });

  it('rejects a name longer than 120 characters', () => {
    expect(CreateProductConfigDto.safeParse(validCreate({ name: 'x'.repeat(121) })).success).toBe(false);
  });
});

describe('UpdateProductConfigDto', () => {
  it('accepts a single changed field', () => {
    expect(UpdateProductConfigDto.safeParse({ name: 'New name' }).success).toBe(true);
  });

  it('accepts status=retired', () => {
    expect(UpdateProductConfigDto.safeParse({ status: ConfigStatus.RETIRED }).success).toBe(true);
  });

  it('rejects status set to anything other than retired', () => {
    const result = UpdateProductConfigDto.safeParse({ status: 'active' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['status']);
  });

  it('rejects an empty body (at least one field required)', () => {
    expect(UpdateProductConfigDto.safeParse({}).success).toBe(false);
  });

  it('cross-validates eligibility_mapping when a field_schema is also submitted', () => {
    const result = UpdateProductConfigDto.safeParse({
      field_schema: VALID_FIELD_SCHEMA,
      eligibility_mapping: { fields: [{ lms_field: 'not_declared', los_field: 'x' }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['eligibility_mapping', 'fields', 0, 'lms_field']);
    }
  });

  it('does NOT cross-validate eligibility_mapping at DTO level when field_schema is absent (service does)', () => {
    // Without a submitted field_schema the DTO cannot know the declared keys, so it
    // accepts; the service re-checks against the merged/existing schema.
    const result = UpdateProductConfigDto.safeParse({
      eligibility_mapping: { fields: [{ lms_field: 'anything', los_field: 'x' }] },
    });
    expect(result.success).toBe(true);
  });
});

describe('ListProductConfigsQueryDto + toListParams', () => {
  it('defaults page/limit/sort', () => {
    const result = ListProductConfigsQueryDto.parse({});
    expect(result).toMatchObject({ page: 1, limit: 25, sort: '-created_at' });
  });

  it('rejects a limit above 100', () => {
    expect(ListProductConfigsQueryDto.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects an unknown sort token (SQL-injection defence)', () => {
    expect(ListProductConfigsQueryDto.safeParse({ sort: 'created_at; DROP' }).success).toBe(false);
  });

  it('maps bracketed filters and a signed sort to internal params', () => {
    const query = ListProductConfigsQueryDto.parse({
      'filter[status]': 'draft',
      'filter[product_code]': 'CV',
      sort: '-name',
    });
    expect(toListParams(query)).toEqual({
      status: 'draft',
      product_code: 'CV',
      sort: 'name',
      direction: 'desc',
    });
  });

  it('maps an unsigned sort token to ascending', () => {
    const query = ListProductConfigsQueryDto.parse({ sort: 'version' });
    expect(toListParams(query)).toMatchObject({ sort: 'version', direction: 'asc' });
  });
});
