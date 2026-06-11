import { MaskingService, REDACTED_TOKEN } from './masking.service';

describe('MaskingService', () => {
  const svc = new MaskingService();

  // C-01
  it('masks mobile as first-2 + Xs + last-2 for RM scope O', () => {
    expect(svc.mask('mobile', '9876543210')).toBe('98xxxxxx10');
  });

  // C-02
  it('masks PAN as first-3 + Xs + last-2 for RM scope O', () => {
    expect(svc.mask('pan', 'ABCDE1234F')).toBe('ABCxxxx4F');
  });

  // C-03
  it('masks mobile for DPO scope M identically (DPO never gets raw)', () => {
    expect(svc.mask('mobile', '9876543210', { strict: true })).toBe('98xxxxxx10');
  });

  // C-04
  it('returns last-4 token suffix only for aadhaar_ref_token at every scope', () => {
    expect(svc.mask('aadhaar', 'TOKEN_ABCD_1234')).toBe('1234');
    expect(svc.mask('aadhaar', 'TOKEN_ABCD_1234', { strict: true })).toBe('1234');
  });

  // C-05
  it('applies strictest masking on export for DPO scope M (no unmasked PII)', () => {
    expect(svc.mask('pan', 'ABCDE1234F', { strict: true })).toBe('ABCxxxx4F');
  });

  // C-06
  it('returns full mobile for an active break-glass grant holder', () => {
    expect(svc.mask('mobile', '9876543210', { breakGlassActive: true })).toBe('9876543210');
  });

  // C-07
  it('masks email as first-2 chars + **** + @domain', () => {
    expect(svc.mask('email', 'abc@example.com')).toBe('ab****@example.com');
  });

  it('reduces full_name to the first name under strict masking, leaves it intact otherwise', () => {
    expect(svc.mask('full_name', 'Asha Verma', { strict: true })).toBe('Asha');
    expect(svc.mask('full_name', 'Asha Verma')).toBe('Asha Verma');
  });

  it('passes null/empty through unchanged', () => {
    expect(svc.mask('mobile', null)).toBeNull();
    expect(svc.mask('pan', undefined)).toBeNull();
    expect(svc.mask('email', '')).toBe('');
  });

  it('break-glass bypass returns the raw value for every field kind', () => {
    expect(svc.mask('pan', 'ABCDE1234F', { breakGlassActive: true })).toBe('ABCDE1234F');
    expect(svc.mask('email', 'abc@example.com', { breakGlassActive: true })).toBe('abc@example.com');
    expect(svc.mask('aadhaar', 'TOKEN_ABCD_1234', { breakGlassActive: true })).toBe('TOKEN_ABCD_1234');
  });

  // ── maskEventPayload (FR-141: PII masked before the outbox row is written) ──
  describe('maskEventPayload', () => {
    // T09 / INV-02 / INV-03
    it('masks mobile and PAN in an event payload (raw values never survive)', () => {
      const out = svc.maskEventPayload({ mobile: '9876543210', pan_masked: 'ABCDE1234F' });
      expect(out['mobile']).toBe('98xxxxxx10');
      expect(out['pan_masked']).toBe('ABCxxxx4F');
      expect(JSON.stringify(out)).not.toContain('9876543210');
      expect(JSON.stringify(out)).not.toContain('ABCDE1234F');
    });

    it('masks every known format-shaped PII alias (pan_token, aadhaar_ref_token, name, email)', () => {
      const out = svc.maskEventPayload({
        pan_token: 'ABCDE1234F',
        aadhaar_ref_token: 'TOKEN_ABCD_1234',
        name: 'Asha Verma',
        email: 'abc@example.com',
      });
      expect(out['pan_token']).toBe('ABCxxxx4F');
      expect(out['aadhaar_ref_token']).toBe('1234');
      // outbox masking is always strict → full_name reduced to first name
      expect(out['name']).toBe('Asha');
      expect(out['email']).toBe('ab****@example.com');
    });

    it('redacts identifier PII with no partial mask (ckyc_id, dob, address)', () => {
      const out = svc.maskEventPayload({
        ckyc_id: '1234567890123456',
        dob: '1990-04-01',
        address: '12 MG Road, Pune',
      });
      expect(out['ckyc_id']).toBe(REDACTED_TOKEN);
      expect(out['dob']).toBe(REDACTED_TOKEN);
      expect(out['address']).toBe(REDACTED_TOKEN);
      expect(JSON.stringify(out)).not.toContain('1990-04-01');
      expect(JSON.stringify(out)).not.toContain('MG Road');
    });

    it('recurses into nested objects and arrays, masking PII at any depth', () => {
      const out = svc.maskEventPayload({
        lead: { mobile: '9876543210', meta: { dob: '1990-04-01' } },
        applicants: [{ pan: 'ABCDE1234F' }, { name: 'Asha Verma' }],
      });
      const lead = out['lead'] as Record<string, unknown>;
      expect(lead['mobile']).toBe('98xxxxxx10');
      expect((lead['meta'] as Record<string, unknown>)['dob']).toBe(REDACTED_TOKEN);
      const applicants = out['applicants'] as Array<Record<string, unknown>>;
      expect(applicants[0]?.['pan']).toBe('ABCxxxx4F');
      expect(applicants[1]?.['name']).toBe('Asha');
    });

    it('leaves non-PII fields untouched and does not mutate the input', () => {
      const input = { lead_id: 'L-1', stage: 'assigned', score: 42, mobile: '9876543210' };
      const out = svc.maskEventPayload(input);
      expect(out['lead_id']).toBe('L-1');
      expect(out['stage']).toBe('assigned');
      expect(out['score']).toBe(42);
      // original object is not mutated
      expect(input.mobile).toBe('9876543210');
    });

    it('never honours break-glass — the outbox always gets masked PII', () => {
      // maskEventPayload exposes no break-glass option; PII is always masked.
      const out = svc.maskEventPayload({ mobile: '9876543210' });
      expect(out['mobile']).toBe('98xxxxxx10');
    });
  });
});
