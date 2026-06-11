import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ProductCode } from '@lms/shared';

/**
 * FR-041 — static guards over the Flyway seed migration
 * `docs/data-model/migrations/V2__seed_product_configs.sql`. This is the FR's
 * primary deliverable (the seven launch products), and a regression here silently
 * breaks every downstream capture FR (FR-010/080/081), so the migration text is
 * pinned by these checks.
 *
 * Live-database execution of the migration (T01–T10 API integration, T12 re-run
 * idempotency against a real Postgres, and SQL invariants INV-01..INV-08) is the
 * Testcontainers tier and is DEFERRED per the dispatch brief. These tests assert
 * the structural properties of the SQL that make those invariants hold once
 * Flyway applies it: all seven product codes present, ACTIVE v1, the correct
 * pan_required_at per product, and ON CONFLICT DO NOTHING (T12 idempotency).
 */

const MIGRATION_PATH = join(
  __dirname,
  '../../../../../docs/data-model/migrations/V2__seed_product_configs.sql',
);
const RAW_SQL = readFileSync(MIGRATION_PATH, 'utf8');

/**
 * Executable SQL only — `--` line comments are stripped so literal counts (status,
 * org/user UUIDs, NULL) reflect the seeded rows, not the documentation header.
 */
const SQL = RAW_SQL.split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

const ALL_PRODUCTS: ProductCode[] = [
  ProductCode.CV,
  ProductCode.CAR,
  ProductCode.TRACTOR,
  ProductCode.CE,
  ProductCode.TW,
  ProductCode.SBL,
  ProductCode.HRM,
];

/** The launch product codes that appear as a quoted literal in the migration. */
function productCodeLiterals(): ProductCode[] {
  return ALL_PRODUCTS.filter((c) => SQL.includes(`'${c}'`));
}

describe('V2__seed_product_configs.sql — structure', () => {
  it('targets product_configs and seeds via INSERT', () => {
    expect(SQL).toMatch(/INSERT\s+INTO\s+product_configs/i);
  });

  it('is idempotent: ON CONFLICT (org_id, product_code, version) DO NOTHING (T12)', () => {
    expect(SQL).toMatch(
      /ON\s+CONFLICT\s*\(\s*org_id\s*,\s*product_code\s*,\s*version\s*\)\s*DO\s+NOTHING/i,
    );
  });

  it('seeds all seven launch product codes exactly once each (INV-01)', () => {
    for (const code of ALL_PRODUCTS) {
      const occurrences = SQL.split(`'${code}'`).length - 1;
      expect(occurrences).toBe(1);
    }
    expect(productCodeLiterals().sort()).toEqual([...ALL_PRODUCTS].sort());
  });

  it('inserts every row as ACTIVE, version 1 (seven of each)', () => {
    // Seven status='active' literals and seven version-1 value cells (the literal
    // `  1,` line that follows each name). Count the standalone active markers.
    const activeCount = SQL.split("'active'").length - 1;
    expect(activeCount).toBe(7);
  });

  it('references the default org and system user for every row', () => {
    // Default org appears once per row (org_id) = 7; system user appears twice per
    // row (created_by + updated_by) = 14.
    const orgCount = SQL.split("'00000000-0000-0000-0000-000000000001'").length - 1;
    const sysUserCount = SQL.split("'00000000-0000-0000-0000-000000000000'").length - 1;
    expect(orgCount).toBe(7);
    expect(sysUserCount).toBe(14);
  });

  it('populates field_schema, document_checklist and eligibility_mapping (no NULLs) (INV-02/03/04)', () => {
    // sla_config is the only column seeded NULL (LLD: sla_config = NULL for all 7).
    const nullCount = SQL.split(/\bNULL\b/).length - 1;
    expect(nullCount).toBe(7); // exactly the seven sla_config cells
    // Each row carries a JSONB field_schema with a "required" array and an
    // eligibility_mapping object — both cast to ::jsonb.
    expect(SQL.split('"required"').length - 1).toBe(7);
    const jsonbCasts = SQL.split('::jsonb').length - 1;
    expect(jsonbCasts).toBe(21); // field_schema + document_checklist + eligibility_mapping per row
  });
});

describe('V2__seed_product_configs.sql — pan_required_at per product (INV-06/07)', () => {
  /** Return the pan_required_at literal that appears in the same row block as `code`. */
  function panTimingFor(code: ProductCode): string {
    const codeIdx = SQL.indexOf(`'${code}'`);
    expect(codeIdx).toBeGreaterThan(-1);
    // The row block runs until the next product code or the final ON CONFLICT.
    const nextIdxs = ALL_PRODUCTS.map((c) => SQL.indexOf(`'${c}'`, codeIdx + 1)).filter(
      (i) => i > -1,
    );
    const blockEnd = nextIdxs.length > 0 ? Math.min(...nextIdxs) : SQL.length;
    const block = SQL.slice(codeIdx, blockEnd);
    const match = block.match(/'(at_capture|before_kyc|before_handoff)'/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('CV, CAR, TRACTOR, CE are before_kyc', () => {
    for (const code of [ProductCode.CV, ProductCode.CAR, ProductCode.TRACTOR, ProductCode.CE]) {
      expect(panTimingFor(code)).toBe('before_kyc');
    }
  });

  it('TW is before_handoff (INV-06)', () => {
    expect(panTimingFor(ProductCode.TW)).toBe('before_handoff');
  });

  it('SBL and HRM are at_capture (INV-07)', () => {
    expect(panTimingFor(ProductCode.SBL)).toBe('at_capture');
    expect(panTimingFor(ProductCode.HRM)).toBe('at_capture');
  });
});

describe('V2__seed_product_configs.sql — CV field_schema / checklist spot check (T02)', () => {
  it('CV row declares vehicle_type, fleet_size, down_payment and a permit/insurance checklist', () => {
    const cvIdx = SQL.indexOf("'CV'");
    const block = SQL.slice(cvIdx, SQL.indexOf("'CAR'"));
    for (const key of ['vehicle_type', 'fleet_size', 'down_payment']) {
      expect(block).toContain(`"${key}"`);
    }
    expect(block).toContain('"permit"');
    expect(block).toContain('"insurance"');
  });
});
