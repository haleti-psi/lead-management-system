import {
  IntegrationMonitorQuerySchema,
  toLogFilters,
} from './integration-monitor-query.dto';

/**
 * FR-140 unit tests for {@link IntegrationMonitorQuerySchema} (FR-140-tests.md
 * T14, T15). Verifies defaults and the LIMIT cap.
 */
describe('IntegrationMonitorQuerySchema', () => {
  // T14 — defaults: page=1, limit=25, sort=-created_at.
  it('defaults page=1, limit=25, sort=-created_at on an empty query (T14)', () => {
    const result = IntegrationMonitorQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
    expect(result.sort).toBe('-created_at');
  });

  // T15 — limit > 100 is rejected.
  it('rejects limit > 100 (T15)', () => {
    const result = IntegrationMonitorQuerySchema.safeParse({ limit: 150 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'limit')).toBe(true);
    }
  });

  it('rejects an unknown sort token', () => {
    const result = IntegrationMonitorQuerySchema.safeParse({ sort: 'created_at; DROP TABLE' });
    expect(result.success).toBe(false);
  });

  it('parses bracketed filters and maps them to camelCase filters', () => {
    const parsed = IntegrationMonitorQuerySchema.parse({
      'filter[status]': 'failed',
      'filter[integration]': 'los_handoff',
      'filter[lead_id]': '11111111-1111-1111-1111-111111111111',
    });
    const filters = toLogFilters(parsed);
    expect(filters.status).toBe('failed');
    expect(filters.integration).toBe('los_handoff');
    expect(filters.leadId).toBe('11111111-1111-1111-1111-111111111111');
  });
});
