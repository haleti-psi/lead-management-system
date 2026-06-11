import { ProductCode } from '@lms/shared';

import { ProductConfigRepository, type ProductConfigRow } from './product-config.repository';
import type { KyselyDb } from '../../core/db';

/**
 * FR-041 unit tests for the supported-product runtime reads added to
 * {@link ProductConfigRepository}: {@link ProductConfigRepository.findActiveByProductCode}
 * (TC T11 — the active config a new lead pins to, consumed by FR-010 capture) and
 * {@link ProductConfigRepository.findAllActive} (the product-picker feed). Both
 * are LIMIT-bounded, org-scoped, `status='active'` reads.
 *
 * A Kysely fake returns a fixed `product_configs` result set for the
 * `selectFrom('product_configs').selectAll()...execute()/executeTakeFirst()`
 * chains and records every `where(col, op, val)` triple so the org/status/product
 * predicates and the LIMIT are asserted without a database (the live-DB path is
 * the Testcontainers tier, DEFERRED per the dispatch brief).
 */

const ORG_ID_DEFAULT = '00000000-0000-0000-0000-000000000001';

interface Recorded {
  wheres: Array<[string, string, unknown]>;
  orderBy?: [string, string];
  limit?: number;
}

function fakeDb(rows: ProductConfigRow[]): { db: KyselyDb; rec: Recorded } {
  const rec: Recorded = { wheres: [] };
  const chain = {
    selectAll: () => chain,
    where: (col: string, op: string, val: unknown) => {
      rec.wheres.push([col, op, val]);
      return chain;
    },
    orderBy: (col: string, dir: string) => {
      rec.orderBy = [col, dir];
      return chain;
    },
    limit: (n: number) => {
      rec.limit = n;
      return chain;
    },
    async execute() {
      return rows;
    },
    async executeTakeFirst() {
      return rows[0];
    },
  };
  return { db: { selectFrom: () => chain } as unknown as KyselyDb, rec };
}

function row(overrides: Partial<ProductConfigRow> = {}): ProductConfigRow {
  return {
    product_config_id: 'pc-1',
    org_id: ORG_ID_DEFAULT,
    product_code: ProductCode.SBL,
    name: 'Secured Business Loan',
    version: 1,
    status: 'active',
    field_schema: { required: ['turnover'], optional: [] },
    document_checklist: ['kyc_applicant_business_bo'],
    sla_config: null,
    eligibility_mapping: { turnover: '$.field_schema.turnover' },
    pan_required_at: 'at_capture',
    created_at: new Date(),
    updated_at: new Date(),
    created_by: '00000000-0000-0000-0000-000000000000',
    updated_by: '00000000-0000-0000-0000-000000000000',
    ...overrides,
  } as ProductConfigRow;
}

describe('ProductConfigRepository.findActiveByProductCode (T11)', () => {
  it('returns the active SBL row with version 1 and turnover in eligibility_mapping', async () => {
    const { db } = fakeDb([row()]);
    const repo = new ProductConfigRepository(db);

    const result = await repo.findActiveByProductCode(ProductCode.SBL);

    expect(result).toBeDefined();
    expect(result?.product_code).toBe(ProductCode.SBL);
    expect(result?.status).toBe('active');
    expect(result?.version).toBe(1);
    expect(result?.eligibility_mapping).toMatchObject({ turnover: expect.any(String) });
  });

  it('filters by org, the requested product_code and status=active, newest version first, LIMIT 1', async () => {
    const { db, rec } = fakeDb([row()]);
    const repo = new ProductConfigRepository(db);

    await repo.findActiveByProductCode(ProductCode.SBL);

    expect(rec.wheres).toEqual(
      expect.arrayContaining([
        ['org_id', '=', ORG_ID_DEFAULT],
        ['product_code', '=', ProductCode.SBL],
        ['status', '=', 'active'],
      ]),
    );
    expect(rec.orderBy).toEqual(['version', 'desc']);
    expect(rec.limit).toBe(1);
  });

  it('returns undefined when no active config exists for the product', async () => {
    const { db } = fakeDb([]);
    const repo = new ProductConfigRepository(db);

    await expect(repo.findActiveByProductCode(ProductCode.CV)).resolves.toBeUndefined();
  });
});

describe('ProductConfigRepository.findAllActive', () => {
  it('returns the active configs ordered by product_code, bounded by LIMIT 100', async () => {
    const { db, rec } = fakeDb([
      row({ product_code: ProductCode.CAR, name: 'Car' }),
      row({ product_code: ProductCode.CV, name: 'Commercial Vehicle' }),
    ]);
    const repo = new ProductConfigRepository(db);

    const result = await repo.findAllActive();

    expect(result).toHaveLength(2);
    expect(rec.wheres).toEqual(
      expect.arrayContaining([
        ['org_id', '=', ORG_ID_DEFAULT],
        ['status', '=', 'active'],
      ]),
    );
    expect(rec.orderBy).toEqual(['product_code', 'asc']);
    expect(rec.limit).toBe(100);
  });
});
