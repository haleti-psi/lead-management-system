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
    const leads = { assignOwner: jest.fn().mockResolvedValue({ lead_id: 'lead-1' }) };
    const adapter = new LeadSlaWriterAdapter(leads as unknown as LeadService);

    await adapter.reassignOwner(
      { leadId: 'lead-1', newOwnerId: 'owner-2', reason: 'SLA breach', expectedVersion: 4 },
      tx,
    );

    // System-originated escalation reassignment under the port's optimistic lock;
    // team untouched (no teamId key) — FR-030 AssignOwnerInput shape.
    expect(leads.assignOwner).toHaveBeenCalledWith(
      'lead-1',
      {
        ownerId: 'owner-2',
        reason: 'SLA breach',
        method: 'escalation',
        actorId: '00000000-0000-0000-0000-000000000000',
        expectedVersion: 4,
      },
      tx,
    );
  });
});
