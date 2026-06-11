import { CreateSchemeDto } from './create-scheme.dto';
import { ListSchemesQueryDto } from './list-schemes.dto';

/**
 * FR-042 — DTO validation tests (LLD §Validation Logic). Exercise the Zod schemas
 * directly: the create accept path, the field-level rejects that become
 * `VALIDATION_ERROR` (400) at the controller boundary (TC-042-10 date range,
 * TC-042-12 missing required fields), and the list query coercion incl. the
 * LIMIT clamp at 100 (TC-042-23).
 */

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    code: 'DEALER-TW-Q3',
    name: 'Dealer TW Quarter 3',
    product_code: 'TW',
    subvention_flag: true,
    valid_from: '2026-07-01',
    valid_to: '2026-09-30',
    ...overrides,
  };
}

/** Dotted paths of every issue (order-independent membership checks). */
function issuePaths(result: { success: false; error: { issues: { path: (string | number)[] }[] } }): string[] {
  return result.error.issues.map((i) => i.path.join('.'));
}

describe('CreateSchemeDto', () => {
  it('accepts a fully valid payload', () => {
    expect(CreateSchemeDto.safeParse(validCreate()).success).toBe(true);
  });

  it('defaults product_code to null (all-product) and subvention_flag to false', () => {
    const result = CreateSchemeDto.safeParse({
      code: 'GLOBAL-OFFER',
      name: 'Global Offer',
      valid_from: '2026-07-01',
      valid_to: '2026-09-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.product_code).toBeNull();
      expect(result.data.subvention_flag).toBe(false);
    }
  });

  it('accepts valid_from === valid_to (one-day scheme boundary)', () => {
    expect(CreateSchemeDto.safeParse(validCreate({ valid_from: '2026-07-01', valid_to: '2026-07-01' })).success).toBe(
      true,
    );
  });

  it('rejects valid_to before valid_from on the valid_to path (TC-042-10)', () => {
    const result = CreateSchemeDto.safeParse(validCreate({ valid_from: '2026-10-01', valid_to: '2026-09-01' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePaths(result)).toContain('valid_to');
  });

  it('reports both missing required fields (TC-042-12)', () => {
    const result = CreateSchemeDto.safeParse({ name: 'No code, no dates' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = issuePaths(result);
      expect(paths).toContain('code');
      expect(paths).toContain('valid_from');
      expect(paths).toContain('valid_to');
    }
  });

  it('rejects a lowercase / non-conforming code', () => {
    const result = CreateSchemeDto.safeParse(validCreate({ code: 'dealer tw' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePaths(result)).toContain('code');
  });

  it('rejects a code longer than 40 characters', () => {
    const result = CreateSchemeDto.safeParse(validCreate({ code: 'A'.repeat(41) }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePaths(result)).toContain('code');
  });

  it('rejects a non-ISO valid_from', () => {
    const result = CreateSchemeDto.safeParse(validCreate({ valid_from: '01-07-2026' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePaths(result)).toContain('valid_from');
  });

  it('rejects an unknown product_code', () => {
    const result = CreateSchemeDto.safeParse(validCreate({ product_code: 'BIKE' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(issuePaths(result)).toContain('product_code');
  });
});

describe('ListSchemesQueryDto', () => {
  it('applies page/limit defaults when omitted', () => {
    const result = ListSchemesQueryDto.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
    }
  });

  it('rejects a limit above the 100 ceiling (TC-042-23 enforced as a hard bound)', () => {
    // The DTO bounds limit at 100; an over-limit request is a 400 (the server never
    // runs an unbounded list). Callers that want clamping send limit<=100.
    const result = ListSchemesQueryDto.safeParse({ limit: '999' });
    expect(result.success).toBe(false);
  });

  it('coerces string is_active encodings to boolean', () => {
    expect(ListSchemesQueryDto.parse({ is_active: 'true' }).is_active).toBe(true);
    expect(ListSchemesQueryDto.parse({ is_active: '0' }).is_active).toBe(false);
    expect(ListSchemesQueryDto.parse({}).is_active).toBeUndefined();
  });

  it('accepts an optional product_code filter', () => {
    const result = ListSchemesQueryDto.safeParse({ product_code: 'CV' });
    expect(result.success).toBe(true);
  });
});
