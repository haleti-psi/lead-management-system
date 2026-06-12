import {
  DEFAULT_SORT,
  FILTER_ALLOWLIST,
  LeadFilterSchema,
  ListLeadsQuerySchema,
  SORT_ALLOWLIST,
} from './list-leads.dto';

/**
 * FR-050 — DTO-layer tests: TC-25 (allow-list accepts every AC-3 key, rejects
 * unknown), TC-26 (limit clamp/reject), plus the Zod analogues of the deferred
 * API cases TC-07 (unknown filter key), TC-08 (disallowed sort), TC-09 (bad
 * enum value, path `filter.stage`) and the TC-14 `q` length rule.
 */

describe('ListLeadsQuerySchema', () => {
  it('applies defaults: page 1, limit 25, sort created_at:desc, empty filter', () => {
    const parsed = ListLeadsQuerySchema.parse({});
    expect(parsed).toEqual({
      page: 1,
      limit: 25,
      sort: { field: 'created_at', dir: 'desc' },
      filter: {},
    });
    expect(DEFAULT_SORT).toBe('created_at:desc');
  });

  it('TC-26: limit > 100 is CLAMPED to 100 (transform, not an error)', () => {
    expect(ListLeadsQuerySchema.parse({ limit: '500' }).limit).toBe(100);
    expect(ListLeadsQuerySchema.parse({ limit: 100 }).limit).toBe(100);
  });

  it('TC-26: limit < 1 is rejected', () => {
    expect(ListLeadsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListLeadsQuerySchema.safeParse({ limit: -5 }).success).toBe(false);
  });

  it('TC-08 analogue: a sort field outside the allow-list is rejected with the LLD message', () => {
    const result = ListLeadsQuerySchema.safeParse({ sort: 'mobile:asc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('sort field is not allowed');
      expect(result.error.issues[0]?.path).toEqual(['sort']);
    }
  });

  it('accepts every allow-listed sort field in both directions', () => {
    for (const field of SORT_ALLOWLIST) {
      for (const dir of ['asc', 'desc'] as const) {
        const parsed = ListLeadsQuerySchema.parse({ sort: `${field}:${dir}` });
        expect(parsed.sort).toEqual({ field, dir });
      }
    }
  });

  it('rejects a valid field with an invalid direction', () => {
    expect(ListLeadsQuerySchema.safeParse({ sort: 'created_at:up' }).success).toBe(false);
  });

  it('TC-14 analogue: q shorter than 2 characters is rejected; q is trimmed', () => {
    const short = ListLeadsQuerySchema.safeParse({ q: 'a' });
    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.error.issues[0]?.message).toBe('search needs at least 2 characters');
    }
    expect(ListLeadsQuerySchema.safeParse({ q: ' x ' }).success).toBe(false);
    expect(ListLeadsQuerySchema.parse({ q: ' 000123 ' }).q).toBe('000123');
  });

  it('TC-07 analogue: an unknown filter key is rejected, naming filter + the key', () => {
    const result = ListLeadsQuerySchema.safeParse({ filter: { salary: '5' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['filter']);
      expect(issue?.message).toBe("unknown filter 'salary'");
    }
  });

  it('TC-09 analogue: a bad enum value reports path filter.stage', () => {
    const result = ListLeadsQuerySchema.safeParse({ filter: { stage: 'not_a_stage' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['filter', 'stage']);
      expect(issue?.message).toBe('invalid stage value');
    }
  });
});

describe('LeadFilterSchema (TC-25)', () => {
  it('accepts every AC-3 allow-listed key with a valid value', () => {
    const samples: Record<(typeof FILTER_ALLOWLIST)[number], unknown> = {
      product_code: 'CV',
      stage: ['documents_pending'],
      branch_id: 'f6a7c8d9-0000-4000-8000-000000000001',
      team_id: 'f6a7c8d9-0000-4000-8000-000000000002',
      owner_id: 'f6a7c8d9-0000-4000-8000-000000000003',
      source: 'DSA',
      partner: 'PTR-0001',
      priority: 'high',
      consent_status: 'captured',
      kyc_status: 'in_progress',
      is_hot: 'true',
      score_band: 'hot',
      sla_state: 'breached',
      date_from: '2026-01-01',
      date_to: '2026-06-01',
    };
    const parsed = LeadFilterSchema.parse(samples);
    // Single enum values normalise to arrays; query-string booleans coerce.
    expect(parsed.product_code).toEqual(['CV']);
    expect(parsed.stage).toEqual(['documents_pending']);
    expect(parsed.is_hot).toBe(true);
    expect(parsed.date_from).toBeInstanceOf(Date);
  });

  it('every allow-listed key is covered by the schema (no silent drops)', () => {
    for (const key of FILTER_ALLOWLIST) {
      expect(Object.keys(LeadFilterSchema.innerType().shape)).toContain(key);
    }
  });

  it('accepts native JSON booleans and arrays (saved-view filter_json form)', () => {
    const parsed = LeadFilterSchema.parse({ is_hot: false, stage: ['captured', 'assigned'] });
    expect(parsed.is_hot).toBe(false);
    expect(parsed.stage).toEqual(['captured', 'assigned']);
  });

  it('rejects is_hot values that are not true/false', () => {
    const result = LeadFilterSchema.safeParse({ is_hot: 'yes' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('is_hot must be true/false');
    }
  });

  it('rejects invalid score_band / sla_state values', () => {
    expect(LeadFilterSchema.safeParse({ score_band: 'tepid' }).success).toBe(false);
    expect(LeadFilterSchema.safeParse({ sla_state: 'late' }).success).toBe(false);
  });

  it('rejects non-uuid branch/team/owner ids', () => {
    const result = LeadFilterSchema.safeParse({ owner_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('must be a valid id');
    }
  });

  it('enforces date_from ≤ date_to (cross-field)', () => {
    const result = LeadFilterSchema.safeParse({ date_from: '2026-06-02', date_to: '2026-06-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('date_from must be ≤ date_to');
    }
    expect(
      LeadFilterSchema.safeParse({ date_from: '2026-06-01', date_to: '2026-06-01' }).success,
    ).toBe(true);
  });
});
