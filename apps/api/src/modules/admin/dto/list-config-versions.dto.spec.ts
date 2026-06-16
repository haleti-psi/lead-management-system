import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../core/common';
import { ListConfigVersionsQuery } from './list-config-versions.dto';

/**
 * FR-132 — `GET /admin/config` query-schema tests: pagination defaults/coercion,
 * the LIMIT cap (NFR-17), and the optional `config_type` passthrough.
 */
describe('ListConfigVersionsQuery', () => {
  it('defaults page=1 and limit=DEFAULT_PAGE_LIMIT when absent', () => {
    expect(ListConfigVersionsQuery.parse({})).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT });
  });

  it('coerces string page/limit and keeps config_type', () => {
    expect(ListConfigVersionsQuery.parse({ page: '2', limit: '50', config_type: 'sla_policy' })).toEqual({
      page: 2,
      limit: 50,
      config_type: 'sla_policy',
    });
  });

  it('accepts limit at the MAX_PAGE_LIMIT boundary', () => {
    expect(ListConfigVersionsQuery.parse({ limit: MAX_PAGE_LIMIT }).limit).toBe(MAX_PAGE_LIMIT);
  });

  it('rejects a limit above MAX_PAGE_LIMIT', () => {
    expect(ListConfigVersionsQuery.safeParse({ limit: MAX_PAGE_LIMIT + 1 }).success).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(ListConfigVersionsQuery.safeParse({ page: 0 }).success).toBe(false);
  });
});
