import { MaskingService } from './masking.service';

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
});
