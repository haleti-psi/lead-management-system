// Shared Vitest setup for the web app (web foundation wave).
// Registers Testing Library's DOM cleanup after every test so component renders
// do not leak across tests. Auto-cleanup only self-registers when vitest globals
// are enabled; this repo uses explicit imports, so we wire it here once for all
// component specs. Node-environment specs (e.g. apiClient) render nothing, so the
// cleanup is a harmless no-op for them.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
