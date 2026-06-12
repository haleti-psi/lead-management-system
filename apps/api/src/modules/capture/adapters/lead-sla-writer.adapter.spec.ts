import type { DbTransaction } from '../../../core/db';
import type { LeadService } from '../lead.service';
import { LeadSlaWriterAdapter } from './lead-sla-writer.adapter';

/**
 * FR-010 — the Wave-1 `core/sla` seam adapter: every port call must delegate to
 * the corresponding `LeadService` mutator (sole writer of `leads`) with the
 * caller's tx — never issue SQL itself.
 */
describe('LeadSlaWriterAdapter', () => {
  const tx = { __tx: true } as unknown as DbTransaction;

  it('setSlaDueAt delegates to LeadService.setSlaDueAt with the same tx', async () => {
    const leads = { setSlaDueAt: jest.fn().mockResolvedValue(undefined) };
    const adapter = new LeadSlaWriterAdapter(leads as unknown as LeadService);
    const dueAt = new Date('2026-06-15T09:00:00Z');

    await adapter.setSlaDueAt({ leadId: 'lead-1', dueAt, expectedVersion: 4 }, tx);

    expect(leads.setSlaDueAt).toHaveBeenCalledWith('lead-1', dueAt, 4, tx);
  });

  it('reassignOwner delegates to LeadService.assignOwner (idempotent in the service)', async () => {
    const leads = { assignOwner: jest.fn().mockResolvedValue(undefined) };
    const adapter = new LeadSlaWriterAdapter(leads as unknown as LeadService);

    await adapter.reassignOwner(
      { leadId: 'lead-1', newOwnerId: 'owner-2', reason: 'SLA breach', expectedVersion: 4 },
      tx,
    );

    expect(leads.assignOwner).toHaveBeenCalledWith('lead-1', 'owner-2', 'SLA breach', tx);
  });
});
