import { CreateSlaPolicyDto } from './create-sla-policy.dto';

/**
 * FR-104 validation tests (TC-007/008/009/010/011). These assert the Zod schema
 * directly (the ZodValidationPipe maps a failure to VALIDATION_ERROR(400) with
 * field-level issues). `safeParse` lets us inspect the issue path/message.
 */

const validBase = {
  name: 'First Contact – CV 4h',
  applies_to: 'first_contact' as const,
  condition: { product_code: ['CV', 'CAR'] },
  threshold_minutes: 240,
  escalation_chain: [
    { at_minutes: 180, notify_roles: ['RM'], action: 'notify' as const },
    { at_minutes: 240, notify_roles: ['BM'], action: 'notify' as const },
    { at_minutes: 300, notify_roles: ['SM'], action: 'reassign' as const },
  ],
};

function issuesFor(input: unknown): { field: string; message: string }[] {
  const result = CreateSlaPolicyDto.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

describe('CreateSlaPolicyDto', () => {
  it('accepts a valid policy (TC-001 input)', () => {
    expect(CreateSlaPolicyDto.safeParse(validBase).success).toBe(true);
  });

  it('rejects a non-positive threshold (TC-007)', () => {
    const issues = issuesFor({ ...validBase, threshold_minutes: 0 });
    expect(issues.some((i) => i.field === 'threshold_minutes')).toBe(true);
  });

  it('rejects an empty escalation chain (TC-008)', () => {
    const issues = issuesFor({ ...validBase, escalation_chain: [] });
    expect(issues.some((i) => i.field === 'escalation_chain')).toBe(true);
    expect(issues.some((i) => i.message === 'Escalation chain must have at least one step.')).toBe(true);
  });

  it('rejects duplicate at_minutes (TC-009)', () => {
    const issues = issuesFor({
      ...validBase,
      escalation_chain: [
        { at_minutes: 240, notify_roles: ['RM'], action: 'notify' },
        { at_minutes: 240, notify_roles: ['BM'], action: 'notify' },
      ],
    });
    expect(
      issues.some(
        (i) => i.field === 'escalation_chain' && i.message === 'Duplicate at_minutes values are not allowed.',
      ),
    ).toBe(true);
  });

  it('rejects a reassign step that is not the final/highest at_minutes (TC-010)', () => {
    const issues = issuesFor({
      ...validBase,
      escalation_chain: [
        { at_minutes: 300, notify_roles: ['SM'], action: 'reassign' },
        { at_minutes: 360, notify_roles: ['BM'], action: 'notify' },
      ],
    });
    expect(issues.some((i) => i.field === 'escalation_chain')).toBe(true);
  });

  it('rejects more than one reassign step (TC-010)', () => {
    const issues = issuesFor({
      ...validBase,
      escalation_chain: [
        { at_minutes: 180, notify_roles: ['RM'], action: 'reassign' },
        { at_minutes: 300, notify_roles: ['SM'], action: 'reassign' },
      ],
    });
    expect(
      issues.some(
        (i) =>
          i.field === 'escalation_chain' &&
          i.message === 'Only one reassign step is allowed per escalation chain.',
      ),
    ).toBe(true);
  });

  it('rejects an invalid applies_to enum (TC-011)', () => {
    const issues = issuesFor({ ...validBase, applies_to: 'foo' });
    expect(issues.some((i) => i.field === 'applies_to')).toBe(true);
  });

  it('rejects an invalid notify_roles enum (TC-011)', () => {
    const issues = issuesFor({
      ...validBase,
      escalation_chain: [{ at_minutes: 60, notify_roles: ['XYZ'], action: 'notify' }],
    });
    expect(issues.some((i) => i.field.startsWith('escalation_chain'))).toBe(true);
  });

  it('rejects a name longer than 120 characters', () => {
    const issues = issuesFor({ ...validBase, name: 'x'.repeat(121) });
    expect(issues.some((i) => i.field === 'name')).toBe(true);
  });

  it('accepts a single notify-only step (no reassign required)', () => {
    const result = CreateSlaPolicyDto.safeParse({
      ...validBase,
      escalation_chain: [{ at_minutes: 120, notify_roles: ['RM'], action: 'notify' }],
    });
    expect(result.success).toBe(true);
  });
});
