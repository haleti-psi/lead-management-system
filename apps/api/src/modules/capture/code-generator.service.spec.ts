import type { DbTransaction } from '../../core/db';
import { CodeGenerator } from './code-generator.service';

/**
 * FR-010 unit tests U-12/U-13 for {@link CodeGenerator}. The Postgres advisory
 * lock is overridden through the protected test seam (no DB in the unit tier);
 * the MAX(lead_code) read is a mocked Kysely chain. U-13 simulates the
 * serialized concurrent calls the lock guarantees: the second allocator sees
 * the first's committed code and must produce the next unique value.
 */

const ORG = '00000000-0000-0000-0000-000000000001';

class TestableCodeGenerator extends CodeGenerator {
  readonly lockCalls: Array<{ orgId: string; year: number }> = [];

  protected override acquireYearLock(
    _tx: DbTransaction,
    orgId: string,
    year: number,
  ): Promise<void> {
    this.lockCalls.push({ orgId, year });
    return Promise.resolve();
  }
}

interface MaxChainMock {
  where: jest.Mock;
  select: jest.Mock;
  limit: jest.Mock;
  executeTakeFirst: jest.Mock;
}

/** Mock tx whose MAX(lead_code) query returns the queued values in order. */
function txReturningMax(maxCodes: Array<string | null>): DbTransaction {
  let call = 0;
  const chain: MaxChainMock = {
    where: jest.fn(() => chain),
    select: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    executeTakeFirst: jest.fn(async () => ({ max_code: maxCodes[call++] ?? null })),
  };
  return { selectFrom: jest.fn(() => chain) } as unknown as DbTransaction;
}

describe('CodeGenerator.nextLeadCode', () => {
  it('U-12: generates LD-YYYY-seq6 format', async () => {
    const generator = new TestableCodeGenerator();
    const code = await generator.nextLeadCode(txReturningMax([null]), ORG);
    expect(code).toMatch(/^LD-\d{4}-\d{6}$/);
    expect(code.endsWith('-000001')).toBe(true);
  });

  it('uses the IST calendar year in the prefix', async () => {
    const generator = new TestableCodeGenerator();
    // 2026-12-31 19:00 UTC is already 2027-01-01 00:30 IST.
    const istNewYear = new Date('2026-12-31T19:00:00.000Z');
    const code = await generator.nextLeadCode(txReturningMax([null]), ORG, istNewYear);
    expect(code.startsWith('LD-2027-')).toBe(true);
  });

  it('increments from the current MAX for the year', async () => {
    const generator = new TestableCodeGenerator();
    const year = new Date().getFullYear();
    const code = await generator.nextLeadCode(txReturningMax([`LD-${year}-000122`]), ORG);
    expect(code).toBe(`LD-${year}-000123`);
  });

  it('U-13: serialized concurrent calls allocate unique, consecutive codes', async () => {
    const generator = new TestableCodeGenerator();
    const year = new Date().getFullYear();
    // The advisory lock forces caller B to run after caller A committed; B's
    // MAX read therefore returns A's code.
    const tx = txReturningMax([`LD-${year}-000122`, `LD-${year}-000123`]);
    const first = await generator.nextLeadCode(tx, ORG);
    const second = await generator.nextLeadCode(tx, ORG);
    expect(first).toBe(`LD-${year}-000123`);
    expect(second).toBe(`LD-${year}-000124`);
    expect(first).not.toBe(second);
    // Both allocations took the org+year lock first.
    expect(generator.lockCalls).toHaveLength(2);
    expect(generator.lockCalls[0]).toEqual({ orgId: ORG, year });
  });

  it('throws INTERNAL_ERROR when the year sequence is exhausted', async () => {
    const generator = new TestableCodeGenerator();
    const year = new Date().getFullYear();
    await expect(
      generator.nextLeadCode(txReturningMax([`LD-${year}-999999`]), ORG),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
