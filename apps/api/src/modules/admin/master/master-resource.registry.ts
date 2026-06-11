import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../../core/http';
import { MASTER_DESCRIPTORS } from './descriptors';
import { MASTER_SLUGS } from './master.constants';
import type { MasterResourceDescriptor } from './master-resource.types';

/**
 * FR-131 — the master-resource allow-list and dispatcher. The generic
 * `/admin/{masterResource}` handler resolves the path slug to exactly one
 * {@link MasterResourceDescriptor} here; anything not in the allow-list is
 * rejected so the generic handler never collides with a concrete `/admin/*`
 * route owned by another FR (users/roles/teams → FR-130, products → FR-040,
 * sla-policies → FR-104, webhooks → FR-140, break-glass → FR-003).
 *
 * `resolve` throws `VALIDATION_ERROR` (400, field `masterResource`) for an
 * unknown slug (T05/T30). The controller maps an unknown slug to 404 NOT_FOUND
 * separately when the route-ownership contract requires existence-hiding; the
 * registry's own failure mode is the field-level validation error the LLD
 * specifies.
 */
@Injectable()
export class MasterResourceRegistry {
  private readonly bySlug: ReadonlyMap<string, MasterResourceDescriptor>;

  constructor() {
    this.bySlug = new Map(MASTER_DESCRIPTORS.map((d) => [d.slug, d]));
    // Drift guard: the dispatch map and the route pattern (MASTER_SLUGS) must
    // cover exactly the same slugs, or a slug could route but fail to resolve
    // (or vice-versa). A mismatch is a programming error, surfaced at boot.
    const descriptorSlugs = new Set(this.bySlug.keys());
    const expected = new Set<string>(MASTER_SLUGS);
    const mismatch =
      descriptorSlugs.size !== expected.size || [...expected].some((s) => !descriptorSlugs.has(s));
    if (mismatch) {
      throw new Error('MasterResourceRegistry: descriptor slugs do not match MASTER_SLUGS allow-list.');
    }
  }

  /** True when `slug` is an allow-listed master resource. */
  has(slug: string): boolean {
    return this.bySlug.has(slug);
  }

  /** Resolve a slug to its descriptor, or throw VALIDATION_ERROR (field `masterResource`). */
  resolve(slug: string): MasterResourceDescriptor {
    const descriptor = this.bySlug.get(slug);
    if (descriptor == null) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, 'Please correct the highlighted fields.', {
        fields: [{ field: 'masterResource', issue: `Unknown resource type '${slug}'.` }],
      });
    }
    return descriptor;
  }

  /** The set of allow-listed slugs (for diagnostics / tests). */
  slugs(): string[] {
    return [...this.bySlug.keys()];
  }
}
