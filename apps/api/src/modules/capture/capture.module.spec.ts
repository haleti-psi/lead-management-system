import 'reflect-metadata';

import { LEAD_SLA_WRITER_PORT } from '../../core/sla';
import { AdminModule } from '../admin/admin.module';
import { LEAD_REASSIGN_PORT } from '../admin/ports/lead-reassign.port';
import { LeadReassignmentAdapter } from './adapters/lead-reassignment.adapter';
import { LeadSlaWriterAdapter } from './adapters/lead-sla-writer.adapter';
import { CaptureModule } from './capture.module';

/**
 * FR-010 — wiring assertions for the two Wave-1 port seams this FR closes. The
 * Wave-1 close-out learning ("cross-module providers don't aggregate") makes
 * these structural checks load-bearing:
 *  - CaptureModule must be @Global and EXPORT `LEAD_SLA_WRITER_PORT`, otherwise
 *    the global SlaEngine's `@Optional() @Inject(LEAD_SLA_WRITER_PORT)` stays
 *    undefined and SLA writes keep failing at runtime;
 *  - AdminModule must rebind `LEAD_REASSIGN_PORT` to the capture adapter
 *    (replacing the Wave-1 UnimplementedLeadReassignAdapter placeholder).
 */
describe('CaptureModule seam wiring', () => {
  it('is @Global so its exports reach the global SlaEngine/AdminModule injectors', () => {
    expect(Reflect.getMetadata('__module:global__', CaptureModule)).toBe(true);
  });

  it('exports the LEAD_SLA_WRITER_PORT binding and the reassignment adapter', () => {
    const exports = Reflect.getMetadata('exports', CaptureModule) as unknown[];
    expect(exports).toContain(LEAD_SLA_WRITER_PORT);
    expect(exports).toContain(LeadReassignmentAdapter);
  });

  it('binds LEAD_SLA_WRITER_PORT to the LeadSlaWriterAdapter (useExisting)', () => {
    const providers = Reflect.getMetadata('providers', CaptureModule) as Array<
      { provide?: unknown; useExisting?: unknown } | unknown
    >;
    const binding = providers.find(
      (p): p is { provide: unknown; useExisting: unknown } =>
        typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === LEAD_SLA_WRITER_PORT,
    );
    expect(binding?.useExisting).toBe(LeadSlaWriterAdapter);
  });

  it('AdminModule rebinds LEAD_REASSIGN_PORT to the capture LeadReassignmentAdapter', () => {
    const providers = Reflect.getMetadata('providers', AdminModule) as Array<
      { provide?: unknown; useExisting?: unknown; useClass?: unknown } | unknown
    >;
    const binding = providers.find(
      (p): p is { provide: unknown; useExisting?: unknown; useClass?: unknown } =>
        typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === LEAD_REASSIGN_PORT,
    );
    expect(binding).toBeDefined();
    expect(binding?.useExisting).toBe(LeadReassignmentAdapter);
    // The Wave-1 placeholder must no longer be the bound implementation.
    expect(binding?.useClass).toBeUndefined();
  });
});
