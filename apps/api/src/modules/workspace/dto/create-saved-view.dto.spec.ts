import { CreateSavedViewDto } from './create-saved-view.dto';

/**
 * FR-050 — saved-view body validation: TC-18 (filter_json outside the
 * allow-list), TC-20 (name length boundary 120/121), bad scope. The share-width
 * cross-field rule (TC-19) lives in SavedViewService (needs the caller scope).
 */
describe('CreateSavedViewDto', () => {
  const valid = {
    name: 'Hot CV — North',
    filter_json: { stage: ['documents_pending'], is_hot: true, product_code: ['CV'] },
    is_shared: true,
    scope: 'B',
  };

  it('TC-16 analogue: accepts a valid body and normalises filter values', () => {
    const parsed = CreateSavedViewDto.parse(valid);
    expect(parsed.name).toBe('Hot CV — North');
    expect(parsed.filter_json.stage).toEqual(['documents_pending']);
    expect(parsed.filter_json.is_hot).toBe(true);
    expect(parsed.scope).toBe('B');
  });

  it('is_shared defaults to false', () => {
    const parsed = CreateSavedViewDto.parse({ name: 'Mine', filter_json: {}, scope: 'O' });
    expect(parsed.is_shared).toBe(false);
  });

  it('TC-18: filter_json with a non-allow-listed key is rejected, referencing filter_json', () => {
    const result = CreateSavedViewDto.safeParse({ ...valid, filter_json: { salary: 5 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['filter_json']);
      expect(issue?.message).toBe('saved view contains an unsupported filter');
    }
  });

  it('filter_json values are validated by the same per-key schemas as the list', () => {
    const result = CreateSavedViewDto.safeParse({ ...valid, filter_json: { stage: ['nope'] } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['filter_json', 'stage']);
      expect(result.error.issues[0]?.message).toBe('invalid stage value');
    }
  });

  it('TC-20: a 121-char name is rejected; a 120-char name passes', () => {
    const result121 = CreateSavedViewDto.safeParse({ ...valid, name: 'x'.repeat(121) });
    expect(result121.success).toBe(false);
    if (!result121.success) {
      expect(result121.error.issues[0]?.message).toBe('name is required (max 120 chars)');
    }
    expect(CreateSavedViewDto.safeParse({ ...valid, name: 'x'.repeat(120) }).success).toBe(true);
  });

  it('empty name is rejected (required)', () => {
    expect(CreateSavedViewDto.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(CreateSavedViewDto.safeParse({ filter_json: {}, scope: 'O' }).success).toBe(false);
  });

  it('scope outside the data_scope enum is rejected with the LLD message', () => {
    const result = CreateSavedViewDto.safeParse({ ...valid, scope: 'Z' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('invalid scope');
    }
  });
});
