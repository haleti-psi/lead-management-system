import 'reflect-metadata';

import { CaptureModule } from '../capture/capture.module';
import { DUPLICATE_CHECK_PORT } from '../capture/ports/duplicate-check.port';
import { DedupeModule } from './dedupe.module';
import { DuplicateCheckAdapter } from './duplicate-check.adapter';

/**
 * FR-020 — wiring assertions for the FR-010 → FR-020 port seam this FR closes.
 * The Wave-1 close-out learning ("cross-module providers don't aggregate")
 * makes these structural checks load-bearing: if DedupeModule is not @Global,
 * or capture keeps its own binding, `CaptureService` silently resolves the
 * wrong (or no) duplicate gate and the DUPLICATE_BLOCKED 409 flow dies.
 */
describe('DedupeModule seam wiring', () => {
  it('is @Global so its DUPLICATE_CHECK_PORT export reaches the capture injector', () => {
    expect(Reflect.getMetadata('__module:global__', DedupeModule)).toBe(true);
  });

  it('binds DUPLICATE_CHECK_PORT to the real DuplicateCheckAdapter (useExisting) and exports it', () => {
    const providers = Reflect.getMetadata('providers', DedupeModule) as Array<
      { provide?: unknown; useExisting?: unknown; useClass?: unknown } | unknown
    >;
    const binding = providers.find(
      (p): p is { provide: unknown; useExisting?: unknown; useClass?: unknown } =>
        typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === DUPLICATE_CHECK_PORT,
    );
    expect(binding?.useExisting).toBe(DuplicateCheckAdapter);

    const exports = Reflect.getMetadata('exports', DedupeModule) as unknown[];
    expect(exports).toContain(DUPLICATE_CHECK_PORT);
  });

  it('CaptureModule no longer provides the port itself (the noop rebind is complete)', () => {
    const providers = Reflect.getMetadata('providers', CaptureModule) as Array<
      { provide?: unknown } | unknown
    >;
    const stale = providers.find(
      (p) => typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === DUPLICATE_CHECK_PORT,
    );
    expect(stale).toBeUndefined();

    const exports = Reflect.getMetadata('exports', CaptureModule) as unknown[];
    expect(exports).not.toContain(DUPLICATE_CHECK_PORT);
  });
});
