import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { ErrorState } from '@/components/common/ErrorState';
import { Lead360View } from './Lead360View';

/**
 * FR-051 — the `/leads/:id` page (LLD §UI Component Tree), rendered inside the
 * foundation `AppShell` layout route. The page header (title + stage chips) is
 * part of `Lead360View`'s summary card — the foundation has no shared
 * `PageHeader` primitive yet (see AMBIGUITY.md). Quick-actions (stage move,
 * reassign, …) belong to FR-052/FR-030 and are not rendered here.
 */
export function LeadDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    // Unreachable under the `/leads/:id` route; defensive for direct renders.
    return <ErrorState title="Couldn't load this lead" message="We couldn't find that item." />;
  }

  return (
    <section aria-label="Lead 360">
      <Lead360View leadId={id} />
    </section>
  );
}
