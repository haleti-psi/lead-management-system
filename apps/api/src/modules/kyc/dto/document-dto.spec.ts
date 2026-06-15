import { ApplicantScope, DocType } from '@lms/shared';

import { UploadConfirmDto, isConfirmBody } from './upload-confirm.dto';
import { UploadInitiateDto } from './upload-initiate.dto';
import { WaiverDto } from './waiver.dto';

describe('UploadInitiateDto', () => {
  const valid = {
    doc_type: DocType.PAN,
    applicant_scope: ApplicantScope.APPLICANT,
    file_name: 'pan.pdf',
    file_type: 'application/pdf',
    file_size_kb: 200,
  };

  it('accepts a well-formed body', () => {
    expect(UploadInitiateDto.safeParse(valid).success).toBe(true);
  });

  it('rejects an invalid doc_type', () => {
    expect(UploadInitiateDto.safeParse({ ...valid, doc_type: 'nope' }).success).toBe(false);
  });

  it('rejects an empty file_name', () => {
    expect(UploadInitiateDto.safeParse({ ...valid, file_name: '' }).success).toBe(false);
  });

  it('rejects a non-integer file_size_kb', () => {
    expect(UploadInitiateDto.safeParse({ ...valid, file_size_kb: 1.5 }).success).toBe(false);
  });
});

describe('UploadConfirmDto / isConfirmBody', () => {
  it('detects a confirm body', () => {
    expect(isConfirmBody({ action: 'confirm', document_id: 'x' })).toBe(true);
    expect(isConfirmBody({ doc_type: 'pan' })).toBe(false);
    expect(isConfirmBody(null)).toBe(false);
  });

  it('requires a uuid document_id', () => {
    expect(UploadConfirmDto.safeParse({ action: 'confirm', document_id: 'not-a-uuid' }).success).toBe(false);
    expect(
      UploadConfirmDto.safeParse({ action: 'confirm', document_id: '11111111-1111-1111-1111-111111111111' }).success,
    ).toBe(true);
  });
});

describe('WaiverDto', () => {
  it('requires a reason of 10–500 chars', () => {
    expect(WaiverDto.safeParse({ reason: 'too short' }).success).toBe(false);
    expect(WaiverDto.safeParse({ reason: 'A sufficiently long compliance reason' }).success).toBe(true);
  });

  it('rejects a past expires_at', () => {
    expect(
      WaiverDto.safeParse({ reason: 'A sufficiently long compliance reason', expires_at: '2000-01-01' }).success,
    ).toBe(false);
  });

  it('accepts a future expires_at date', () => {
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(
      WaiverDto.safeParse({ reason: 'A sufficiently long compliance reason', expires_at: future }).success,
    ).toBe(true);
  });
});
