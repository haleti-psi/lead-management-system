import { SearchQuerySchema } from './search-query.dto';

/**
 * FR-054 — Zod validation for `SearchQueryDto` (T10, T11, T12, T20).
 */
describe('SearchQuerySchema', () => {
  it('T22 — accepts q of exactly 2 characters (boundary valid)', () => {
    const result = SearchQuerySchema.safeParse({ q: 'Ra' });
    expect(result.success).toBe(true);
  });

  it('accepts a normal search query', () => {
    const result = SearchQuerySchema.safeParse({ q: 'Ravi Kumar' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.q).toBe('Ravi Kumar');
  });

  it('T10 — rejects q shorter than 2 chars', () => {
    const result = SearchQuerySchema.safeParse({ q: 'R' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.message).toContain('2 characters');
    }
  });

  it('T11 — rejects missing q', () => {
    const result = SearchQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('T12 — rejects q exceeding 100 chars', () => {
    const result = SearchQuerySchema.safeParse({ q: 'A'.repeat(101) });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.message).toContain('100 characters');
    }
  });

  it('T20 — strips SQL metacharacters (treated as literal input, not SQL error)', () => {
    // The DTO just validates length; the repo escapes ILIKE chars — DTO should accept
    const result = SearchQuerySchema.safeParse({ q: "%' OR 1=1--" });
    expect(result.success).toBe(true);
  });

  it('strips unknown query params (Zod strip mode)', () => {
    const result = SearchQuerySchema.safeParse({ q: 'test', unknown_param: 'foo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknown_param']).toBeUndefined();
    }
  });
});
