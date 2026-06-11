import { SlaTarget } from '@lms/shared';

import { SlaPolicyRepository } from './sla-policy.repository';
import type { KyselyDb } from '../../core/db';

/**
 * FR-104 unit tests for {@link SlaPolicyRepository.findActivePolicy} (the policy
 * matcher the SLA engine relies on): a condition-matched policy wins over a
 * condition-less fallback; with no product attribute only the fallback applies.
 *
 * A Kysely fake returns a fixed `sla_policies` result set for the
 * `selectFrom('sla_policies').selectAll()....execute()` chain.
 */

function fakeDb(rows: Record<string, unknown>[]): KyselyDb {
  const chain = {
    selectAll: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    async execute() {
      return rows;
    },
  };
  return { selectFrom: () => chain } as unknown as KyselyDb;
}

const conditionLess = {
  sla_policy_id: 'fallback',
  applies_to: 'first_contact',
  threshold_minutes: 240,
  escalation_chain: [{ at_minutes: 240, notify_roles: ['BM'], action: 'notify' }],
  condition: null,
};

const cvSpecific = {
  sla_policy_id: 'cv',
  applies_to: 'first_contact',
  threshold_minutes: 120,
  escalation_chain: [{ at_minutes: 120, notify_roles: ['RM'], action: 'notify' }],
  condition: { product_code: ['CV', 'CAR'] },
};

describe('SlaPolicyRepository.findActivePolicy', () => {
  it('prefers a condition-matched policy over the condition-less fallback', async () => {
    const repo = new SlaPolicyRepository(fakeDb([cvSpecific, conditionLess]));
    const policy = await repo.findActivePolicy(SlaTarget.FIRST_CONTACT, { product_code: 'CV' });
    expect(policy?.sla_policy_id).toBe('cv');
    expect(policy?.threshold_minutes).toBe(120);
  });

  it('uses the condition-less fallback when the product does not match', async () => {
    const repo = new SlaPolicyRepository(fakeDb([cvSpecific, conditionLess]));
    const policy = await repo.findActivePolicy(SlaTarget.FIRST_CONTACT, { product_code: 'HL' });
    expect(policy?.sla_policy_id).toBe('fallback');
  });

  it('uses the fallback when no product attribute is supplied', async () => {
    const repo = new SlaPolicyRepository(fakeDb([cvSpecific, conditionLess]));
    const policy = await repo.findActivePolicy(SlaTarget.FIRST_CONTACT, {});
    expect(policy?.sla_policy_id).toBe('fallback');
  });

  it('returns undefined when no active policy applies', async () => {
    const repo = new SlaPolicyRepository(fakeDb([cvSpecific]));
    const policy = await repo.findActivePolicy(SlaTarget.FIRST_CONTACT, { product_code: 'HL' });
    expect(policy).toBeUndefined();
  });

  it('parses a stringified JSONB condition/escalation_chain', async () => {
    const stringified = {
      ...cvSpecific,
      condition: JSON.stringify({ product_code: ['CV'] }),
      escalation_chain: JSON.stringify(cvSpecific.escalation_chain),
    };
    const repo = new SlaPolicyRepository(fakeDb([stringified]));
    const policy = await repo.findActivePolicy(SlaTarget.FIRST_CONTACT, { product_code: 'CV' });
    expect(policy?.sla_policy_id).toBe('cv');
    expect(policy?.escalation_chain).toHaveLength(1);
  });
});
