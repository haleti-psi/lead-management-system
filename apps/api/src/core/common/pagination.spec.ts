import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, PaginationParams, toOffset } from './pagination';

describe('PaginationParams', () => {
  it('applies defaults when fields are absent', () => {
    const parsed = PaginationParams.parse({});
    expect(parsed).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT });
  });

  it('coerces numeric query strings to integers', () => {
    const parsed = PaginationParams.parse({ page: '3', limit: '50' });
    expect(parsed).toEqual({ page: 3, limit: 50 });
  });

  it('accepts the maximum allowed limit', () => {
    expect(PaginationParams.parse({ limit: MAX_PAGE_LIMIT }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('rejects limit above the maximum', () => {
    const result = PaginationParams.safeParse({ limit: MAX_PAGE_LIMIT + 1 });
    expect(result.success).toBe(false);
  });

  it('rejects page below 1', () => {
    expect(PaginationParams.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects a non-integer limit', () => {
    expect(PaginationParams.safeParse({ limit: 10.5 }).success).toBe(false);
  });

  it('derives a zero-based offset from page and limit', () => {
    expect(toOffset({ page: 1, limit: 25 })).toBe(0);
    expect(toOffset({ page: 3, limit: 25 })).toBe(50);
  });
});
