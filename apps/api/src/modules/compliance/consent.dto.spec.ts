import { ConsentActor, ConsentPurpose, ConsentState, CreationChannel, ERROR_CODES } from '@lms/shared';

import { ZodValidationPipe } from '../../core/common';
import { isDomainException } from '../../core/http';
import { CaptureConsentDto } from './dto/capture-consent.dto';
import { CustomerConsentDto } from './dto/customer-consent.dto';
import { ListConsentsQuery } from './dto/list-consents.dto';

/**
 * FR-110 — Zod boundary tests (FR-110-tests T04–T06 + the customer-path rules
 * T22/T23), exercised through the real ZodValidationPipe so the asserted
 * outcome is the wire contract: VALIDATION_ERROR (400) with `fields[]`.
 */

function fieldsOf(run: () => unknown): Array<{ field: string; issue: string }> {
  try {
    run();
  } catch (err) {
    if (isDomainException(err) && err.code === ERROR_CODES.VALIDATION_ERROR) {
      return (err.fields ?? []) as Array<{ field: string; issue: string }>;
    }
    throw err;
  }
  throw new Error('expected VALIDATION_ERROR');
}

const staffPipe = new ZodValidationPipe(CaptureConsentDto);
const customerPipe = new ZodValidationPipe(CustomerConsentDto);

const validStaffBody = {
  purpose: 'lead_contact',
  state: 'granted',
  notice_version: 'v1.0',
  consent_text_version: 'v1.0',
};

describe('CaptureConsentDto (staff path)', () => {
  it('parses a minimal valid body and applies the staff defaults channel=manual, actor=rm', () => {
    const dto = staffPipe.transform(validStaffBody);
    expect(dto).toMatchObject({
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
      channel: CreationChannel.MANUAL,
      actor: ConsentActor.RM,
    });
  });

  it('T04: invalid purpose enum → VALIDATION_ERROR with field "purpose"', () => {
    const fields = fieldsOf(() => staffPipe.transform({ ...validStaffBody, purpose: 'invalid_purpose' }));
    expect(fields).toEqual([
      { field: 'purpose', issue: 'purpose must be one of the allowed consent purposes.' },
    ]);
  });

  it('T05: missing notice_version → VALIDATION_ERROR with field "notice_version"', () => {
    const { notice_version: _omitted, ...body } = validStaffBody;
    const fields = fieldsOf(() => staffPipe.transform(body));
    expect(fields).toEqual([{ field: 'notice_version', issue: 'notice_version is required.' }]);
  });

  it('T06: missing consent_text_version → VALIDATION_ERROR with field "consent_text_version"', () => {
    const { consent_text_version: _omitted, ...body } = validStaffBody;
    const fields = fieldsOf(() => staffPipe.transform(body));
    expect(fields).toEqual([
      { field: 'consent_text_version', issue: 'consent_text_version is required.' },
    ]);
  });

  it('accepts the system-managed states at the Zod tier (the SERVICE rejects them — T07/T08 split)', () => {
    // LLD: "state cannot be expired or superseded" is a business rule applied
    // in the service, not Zod — the schema admits any consent_state member.
    expect(staffPipe.transform({ ...validStaffBody, state: 'expired' }).state).toBe(
      ConsentState.EXPIRED,
    );
  });

  it('rejects a malformed ip_device with field "ip_device"', () => {
    const fields = fieldsOf(() => staffPipe.transform({ ...validStaffBody, ip_device: 'not-an-object' }));
    expect(fields[0]?.field).toBe('ip_device');
    expect(fields[0]?.issue).toBe('ip_device must be an object with ip and device.');
  });

  it('rejects a past expires_at and accepts a future one (parsed to Date)', () => {
    const past = fieldsOf(() => staffPipe.transform({ ...validStaffBody, expires_at: '2020-01-01T00:00:00Z' }));
    expect(past[0]?.field).toBe('expires_at');
    expect(past[0]?.issue).toBe('expires_at must be a future ISO 8601 datetime.');

    const dto = staffPipe.transform({ ...validStaffBody, expires_at: '2030-01-01T00:00:00Z' });
    expect(dto.expires_at).toBeInstanceOf(Date);
  });

  it('rejects a non-ISO expires_at', () => {
    const fields = fieldsOf(() => staffPipe.transform({ ...validStaffBody, expires_at: 'tomorrow' }));
    expect(fields[0]?.field).toBe('expires_at');
  });
});

describe('CustomerConsentDto (self-service path)', () => {
  const validCustomerBody = {
    purpose: 'lead_contact',
    state: 'granted',
    notice_version: 'v2.1',
    consent_text_version: 'v2.1',
  };

  it('parses a valid grant', () => {
    expect(customerPipe.transform(validCustomerBody)).toMatchObject({
      purpose: ConsentPurpose.LEAD_CONTACT,
      state: ConsentState.GRANTED,
    });
  });

  it('T22: state=withdrawn → VALIDATION_ERROR with field "state" and a "granted or denied" message', () => {
    const fields = fieldsOf(() => customerPipe.transform({ ...validCustomerBody, state: 'withdrawn' }));
    expect(fields).toEqual([
      { field: 'state', issue: 'state must be granted or denied for customer consent.' },
    ]);
  });

  it('T23: purpose=partner_sharing (not customer-capturable) → VALIDATION_ERROR with field "purpose"', () => {
    const fields = fieldsOf(() => customerPipe.transform({ ...validCustomerBody, purpose: 'partner_sharing' }));
    expect(fields).toEqual([
      { field: 'purpose', issue: 'purpose is not valid for customer self-service.' },
    ]);
  });

  it.each(['aa_bank_data', 'gst_business_data'])(
    'blocks the remaining non-customer purposes (%s)',
    (purpose) => {
      const fields = fieldsOf(() => customerPipe.transform({ ...validCustomerBody, purpose }));
      expect(fields[0]?.field).toBe('purpose');
    },
  );

  it('denied is accepted (customer may decline a purpose)', () => {
    expect(customerPipe.transform({ ...validCustomerBody, state: 'denied' }).state).toBe(
      ConsentState.DENIED,
    );
  });
});

describe('ListConsentsQuery', () => {
  it('defaults page=1 limit=25 and caps limit at 100 (LIMIT ≤ 100)', () => {
    const pipe = new ZodValidationPipe(ListConsentsQuery);
    expect(pipe.transform({})).toEqual({ page: 1, limit: 25 });
    expect(() => pipe.transform({ limit: '101' })).toThrow();
    expect(pipe.transform({ page: '2', limit: '100' })).toEqual({ page: 2, limit: 100 });
  });

  it('accepts the optional purpose/state filters and rejects unknown enum values', () => {
    const pipe = new ZodValidationPipe(ListConsentsQuery);
    expect(pipe.transform({ purpose: 'kyc', state: 'withdrawn' })).toMatchObject({
      purpose: ConsentPurpose.KYC,
      state: ConsentState.WITHDRAWN,
    });
    const fields = fieldsOf(() => pipe.transform({ purpose: 'nope' }));
    expect(fields[0]?.field).toBe('purpose');
  });
});
