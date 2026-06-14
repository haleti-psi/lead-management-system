import { CommCategory, CommChannel, Lang } from '@lms/shared';

import { CreateTemplateDto } from './create-template.dto';

describe('CreateTemplateDto', () => {
  const validBase = {
    code: 'DOC_REQUEST_SMS_EN',
    version: 1,
    channel: CommChannel.SMS,
    language: Lang.ENGLISH,
    category: CommCategory.TRANSACTIONAL,
    body: 'Dear {{name}}, please upload your docs.',
  };

  it('parses a valid payload', () => {
    const result = CreateTemplateDto.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('T13-style: rejects empty code', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, code: '' });
    expect(result.success).toBe(false);
  });

  it('rejects code > 60 chars', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, code: 'A'.repeat(61) });
    expect(result.success).toBe(false);
  });

  it('rejects code with spaces/special chars', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, code: 'DOC REQUEST' });
    expect(result.success).toBe(false);
  });

  it('rejects version < 1', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, version: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer version', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, version: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, channel: 'telegram' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, category: 'promotional' });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects body > 4000 chars', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, body: 'X'.repeat(4001) });
    expect(result.success).toBe(false);
  });

  it('allows optional product_code to be omitted', () => {
    const result = CreateTemplateDto.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.product_code).toBeUndefined();
    }
  });

  it('rejects invalid product_code value', () => {
    const result = CreateTemplateDto.safeParse({ ...validBase, product_code: 'INVALID_PRODUCT' });
    expect(result.success).toBe(false);
  });
});
