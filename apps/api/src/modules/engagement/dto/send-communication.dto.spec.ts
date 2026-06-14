import { CommChannel, ConsentPurpose } from '@lms/shared';

import { SendCommunicationDto } from './send-communication.dto';

describe('SendCommunicationDto', () => {
  const validSmsBase = {
    template_id: '00000000-0000-0000-0001-000000000001',
    channel: CommChannel.SMS,
    consent_basis: ConsentPurpose.LEAD_CONTACT,
    recipient: '9876543210',
  };

  it('parses a valid SMS send', () => {
    const result = SendCommunicationDto.safeParse(validSmsBase);
    expect(result.success).toBe(true);
  });

  it('parses a valid WhatsApp send with 6-9 prefix mobile', () => {
    const result = SendCommunicationDto.safeParse({
      ...validSmsBase,
      channel: CommChannel.WHATSAPP,
      recipient: '6123456789',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid email send', () => {
    const result = SendCommunicationDto.safeParse({
      template_id: '00000000-0000-0000-0001-000000000001',
      channel: CommChannel.EMAIL,
      consent_basis: ConsentPurpose.COMMUNICATION,
      recipient: 'user@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('T13: rejects invalid mobile (too short)', () => {
    const result = SendCommunicationDto.safeParse({ ...validSmsBase, recipient: '12345' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('recipient');
    }
  });

  it('T13: rejects mobile not starting with 6-9', () => {
    const result = SendCommunicationDto.safeParse({ ...validSmsBase, recipient: '1234567890' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = SendCommunicationDto.safeParse({
      ...validSmsBase,
      channel: CommChannel.EMAIL,
      recipient: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid template_id (not UUID)', () => {
    const result = SendCommunicationDto.safeParse({ ...validSmsBase, template_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = SendCommunicationDto.safeParse({ ...validSmsBase, channel: 'signal' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid consent_basis', () => {
    const result = SendCommunicationDto.safeParse({ ...validSmsBase, consent_basis: 'unknown' });
    expect(result.success).toBe(false);
  });
});
