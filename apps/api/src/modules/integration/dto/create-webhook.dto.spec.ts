import { CreateWebhookSchema } from './create-webhook.dto';

/**
 * FR-140 unit tests for {@link CreateWebhookSchema} (FR-140-tests.md T11–T13).
 * Pure Zod validation — no I/O.
 */
describe('CreateWebhookSchema', () => {
  const valid = {
    eventCode: 'LEAD_HANDED_OFF',
    targetUrl: 'https://partner.example.com/hooks/lead',
    secretRef: 'projects/123/secrets/webhook-hmac/versions/latest',
  };

  it('accepts a valid https webhook with a Secret Manager secretRef', () => {
    const result = CreateWebhookSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  // T11 — http:// targetUrl is rejected on the targetUrl field.
  it('rejects a targetUrl without https:// (T11)', () => {
    const result = CreateWebhookSchema.safeParse({ ...valid, targetUrl: 'http://example.com' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['targetUrl']);
      expect(result.error.issues[0]?.message).toContain('Must begin with https://');
    }
  });

  // T12 — an unknown eventCode is rejected on the eventCode field.
  it('rejects an unknown eventCode (T12)', () => {
    const result = CreateWebhookSchema.safeParse({ ...valid, eventCode: 'UNKNOWN_CODE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'eventCode')).toBe(true);
    }
  });

  // T13 — a secretRef not starting with projects/ is rejected.
  it('rejects a secretRef that is not a Secret Manager path (T13)', () => {
    const result = CreateWebhookSchema.safeParse({ ...valid, secretRef: 'sm://wrong/path/123' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'secretRef')).toBe(true);
    }
  });
});
