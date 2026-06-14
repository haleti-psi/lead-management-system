import { Inject, Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { KYSELY, type KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';

/**
 * Internal shape of `product_configs.field_schema` JSONB. The exact structure
 * is defined by FR-040 (M5 product config). The coding agent uses `allowedFields`
 * as `string[]` per the LLD §Ambiguities #2. If FR-040 uses a different property
 * name, this type must be updated accordingly (see AMBIGUITY.md §FR-111-2).
 */
interface ProductFieldSchema {
  allowedFields: string[];
}

/**
 * FR-111 — schema-level data minimisation enforcement (LLD §Summary "1.
 * Schema-level data minimisation enforcement"). Called by `LeadService` and
 * document-capture services before persisting custom field values.
 *
 * Reads `product_configs.field_schema` (JSONB, owned by FR-040 / M5) and
 * rejects any incoming field key whose name is NOT listed in
 * `field_schema.allowedFields`. Throws `VALIDATION_ERROR` with a `fields[]`
 * array listing every disallowed key.
 *
 * **No write path** — this service is read-only against `product_configs`.
 */
@Injectable()
export class DataMinimisationService {
  constructor(@Inject(KYSELY) private readonly db: KyselyDb) {}

  /**
   * Assert that every key in `incomingFields` is declared as allowed in the
   * product config's `field_schema.allowedFields`. Throws `VALIDATION_ERROR`
   * if any disallowed key is present (LLD §Data Operations 3 / §Validation).
   *
   * @param productConfigId  UUID of the `product_configs` row.
   * @param incomingFields   Key–value map of the fields being persisted.
   */
  async assertAllowed(
    productConfigId: string,
    incomingFields: Record<string, unknown>,
  ): Promise<void> {
    if (Object.keys(incomingFields).length === 0) {
      // Empty field map is always allowed (T-08).
      return;
    }

    const config = await this.db
      .selectFrom('product_configs')
      .select(['field_schema'])
      .where('product_config_id', '=', productConfigId)
      .executeTakeFirstOrThrow();

    const fieldSchema = config.field_schema as ProductFieldSchema | null;

    // If field_schema is absent or allowedFields is not yet populated (the
    // current reality — FR-040 has not yet written allowedFields to any
    // product_configs row), the guard is inert: skip the check and allow all
    // fields. The minimisation guard only activates once FR-040 populates
    // allowedFields. See AMBIGUITY.md §FR-111-A2.
    const allowedFields: string[] | undefined = fieldSchema?.allowedFields;
    if (!allowedFields || allowedFields.length === 0) {
      return;
    }

    const disallowedFields = Object.keys(incomingFields).filter(
      (key) => !allowedFields.includes(key),
    );

    if (disallowedFields.length > 0) {
      throw new DomainException(ERROR_CODES.VALIDATION_ERROR, undefined, {
        fields: disallowedFields.map((f) => ({
          field: f,
          issue: 'Field not permitted for this product configuration.',
        })),
      });
    }
  }
}
