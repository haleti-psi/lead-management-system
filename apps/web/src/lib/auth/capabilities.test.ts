// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { can } from './capabilities';

describe('can', () => {
  it('grants a capability the role holds', () => {
    expect(can('RM', 'create_lead')).toBe(true);
    expect(can('ADMIN', 'user_mgmt')).toBe(true);
    expect(can('DPO', 'break_glass')).toBe(true);
  });

  it('denies a capability the role lacks', () => {
    expect(can('RM', 'user_mgmt')).toBe(false);
    expect(can('PARTNER', 'configuration')).toBe(false);
    expect(can('ADMIN', 'create_lead')).toBe(false);
  });
});
