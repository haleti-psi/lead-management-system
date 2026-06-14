/**
 * FR-052 — Pipeline Board page.
 *
 * Route: /pipeline
 * The page is protected (inside ProtectedRoute + AppShell).
 * It renders the KanbanBoard which owns all state and data fetching.
 * The Toaster is already mounted in main.tsx / the app root.
 */

import type { ReactElement } from 'react';
import { KanbanBoard } from '@/components/pipeline/KanbanBoard';

export function PipelineBoardPage(): ReactElement {
  return <KanbanBoard />;
}
