import type { DbTransaction } from '../../../core/db';
import { isDomainException } from '../../../core/http';
import { UnimplementedLeadReassignAdapter } from './unimplemented-lead-reassign.adapter';

/**
 * The owner-writes seam placeholder must NEVER silently succeed: until Wave 2
 * binds `LeadService.bulkReassign`, an attempt to reassign leads on deactivation
 * has to fail loudly (INTERNAL_ERROR) so the surrounding transaction rolls back
 * rather than leaving open leads orphaned on an inactive user.
 */
describe('UnimplementedLeadReassignAdapter', () => {
  it('throws INTERNAL_ERROR (not a no-op) when invoked', async () => {
    const adapter = new UnimplementedLeadReassignAdapter();
    try {
      await adapter.bulkReassign('from-1', 'to-1', 'owner_deactivated', {} as DbTransaction);
      fail('expected the placeholder to throw');
    } catch (err) {
      expect(isDomainException(err)).toBe(true);
      if (isDomainException(err)) expect(err.code).toBe('INTERNAL_ERROR');
    }
  });
});
