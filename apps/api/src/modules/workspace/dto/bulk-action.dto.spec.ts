import { BulkActionDto } from './bulk-action.dto';

/** FR-050 — bulk-action body bounds: action allow-list, batch ≤ 100, dedupe. */
describe('BulkActionDto', () => {
  const id = (n: number) => `f6a7c8d9-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const valid = {
    action: 'reassign',
    lead_ids: [id(1), id(2)],
    reason: 'Branch load balancing',
    params: { owner_id: id(99) },
  };

  it('accepts a valid reassign request', () => {
    const parsed = BulkActionDto.parse(valid);
    expect(parsed.action).toBe('reassign');
    expect(parsed.lead_ids).toEqual([id(1), id(2)]);
    expect(parsed.params.owner_id).toBe(id(99));
  });

  it("rejects actions without an implemented LeadService mutator ('stage'/'tag')", () => {
    for (const action of ['stage', 'tag', 'delete']) {
      const result = BulkActionDto.safeParse({ ...valid, action });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("action must be 'reassign'");
      }
    }
  });

  it('bounds the batch: empty and >100 selections are rejected', () => {
    expect(BulkActionDto.safeParse({ ...valid, lead_ids: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 101 }, (_, i) => id(i + 1));
    const result = BulkActionDto.safeParse({ ...valid, lead_ids: tooMany });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('at most 100 leads per bulk action');
    }
  });

  it('de-duplicates repeated lead ids (never double-dispatched)', () => {
    const parsed = BulkActionDto.parse({ ...valid, lead_ids: [id(1), id(1), id(2)] });
    expect(parsed.lead_ids).toEqual([id(1), id(2)]);
  });

  it('rejects non-uuid lead ids and owner ids', () => {
    expect(BulkActionDto.safeParse({ ...valid, lead_ids: ['nope'] }).success).toBe(false);
    expect(BulkActionDto.safeParse({ ...valid, params: { owner_id: 'nope' } }).success).toBe(false);
  });

  it('requires a non-empty reason (max 500)', () => {
    expect(BulkActionDto.safeParse({ ...valid, reason: '' }).success).toBe(false);
    expect(BulkActionDto.safeParse({ ...valid, reason: 'x'.repeat(501) }).success).toBe(false);
    expect(BulkActionDto.safeParse({ ...valid, reason: 'x'.repeat(500) }).success).toBe(true);
  });
});
