import { Lead360ParamsSchema } from './lead360.dto';

/**
 * FR-051 — TC-051-05 (validation slice): the path-params schema accepts a UUID
 * and reports a non-UUID against the `id` field with the LLD's exact message,
 * which the shared ZodValidationPipe maps to 400 VALIDATION_ERROR with
 * `fields: [{ field: 'id', issue: 'id must be a valid UUID' }]`.
 */
describe('Lead360ParamsSchema (TC-051-05)', () => {
  it('accepts a valid UUID path param', () => {
    const parsed = Lead360ParamsSchema.parse({ id: 'f6b7c1de-0000-4000-8000-000000000051' });
    expect(parsed.id).toBe('f6b7c1de-0000-4000-8000-000000000051');
  });

  it("rejects 'not-a-uuid' with the field-level error the envelope serialises", () => {
    const result = Lead360ParamsSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['id']);
      expect(issue?.message).toBe('id must be a valid UUID');
    }
  });

  it('rejects a missing id with the same message (field id)', () => {
    const result = Lead360ParamsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['id']);
      expect(result.error.issues[0]?.message).toBe('id must be a valid UUID');
    }
  });
});
