/**
 * FR-114 — T33: GrievanceCodeGenerator unit tests.
 * Exercises `nextGrievanceNo` without a real Postgres connection.
 */

import type { DbTransaction } from '../../core/db';
import { GrievanceCodeGenerator } from './code-generator-grievance.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const FIXED_DATE = new Date('2026-06-14T09:00:00Z');

/** Test subclass that stubs out the advisory-lock SQL so no DB is required. */
class TestableGrievanceCodeGenerator extends GrievanceCodeGenerator {
  protected override async acquireYearLock(
    _tx: DbTransaction,
    _orgId: string,
    _year: number,
  ): Promise<void> {
    // no-op in tests
  }
}

// ─────────────────────────────────────── T33: nextGrievanceNo ──

describe('GrievanceCodeGenerator.nextGrievanceNo', () => {
  function makeGen() {
    return new TestableGrievanceCodeGenerator();
  }

  function makeTx(maxNo: string | null): DbTransaction {
    return {
      selectFrom: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue(
          maxNo != null ? { max_no: maxNo } : undefined,
        ),
      }),
    } as unknown as DbTransaction;
  }

  it('T33: returns GRV-{YYYY}-000001 when no prior grievance exists', async () => {
    const gen = makeGen();
    const result = await gen.nextGrievanceNo(ORG, makeTx(null), FIXED_DATE);
    expect(result).toBe('GRV-2026-000001');
  });

  it('T33: returns GRV-{YYYY}-000002 when max is GRV-2026-000001', async () => {
    const gen = makeGen();
    const result = await gen.nextGrievanceNo(ORG, makeTx('GRV-2026-000001'), FIXED_DATE);
    expect(result).toBe('GRV-2026-000002');
  });

  it('T33: codes from two sequential calls differ by exactly 1', async () => {
    const gen = makeGen();

    const tx1 = makeTx(null);
    const tx2 = makeTx('GRV-2026-000001');

    const code1 = await gen.nextGrievanceNo(ORG, tx1, FIXED_DATE);
    const code2 = await gen.nextGrievanceNo(ORG, tx2, FIXED_DATE);

    const seq1 = Number.parseInt(code1.split('-')[2]!, 10);
    const seq2 = Number.parseInt(code2.split('-')[2]!, 10);
    expect(seq2 - seq1).toBe(1);
  });

  it('matches GRV-{YYYY}-{seq6} pattern', async () => {
    const gen = makeGen();
    const result = await gen.nextGrievanceNo(ORG, makeTx(null), FIXED_DATE);
    expect(result).toMatch(/^GRV-\d{4}-\d{6}$/);
  });

  it('pads seq to 6 digits', async () => {
    const gen = makeGen();
    const result = await gen.nextGrievanceNo(ORG, makeTx('GRV-2026-000009'), FIXED_DATE);
    expect(result).toBe('GRV-2026-000010');
    expect(result.split('-')[2]!.length).toBe(6);
  });

  it('year derived from IST (Asia/Kolkata UTC+5:30)', async () => {
    const gen = makeGen();
    // IST new year: 2027-01-01T00:00:00+05:30 = 2026-12-31T18:30:00Z
    const istNewYear = new Date('2026-12-31T18:31:00Z'); // 00:01 IST on 2027-01-01
    const result = await gen.nextGrievanceNo(ORG, makeTx(null), istNewYear);
    expect(result).toMatch(/^GRV-2027-\d{6}$/);
  });
});
