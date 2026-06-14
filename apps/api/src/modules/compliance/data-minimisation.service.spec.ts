/**
 * FR-111 — DataMinimisationService unit tests (Jest).
 * Covers T-05 through T-08 (allowed/disallowed field enforcement).
 */

import { ERROR_CODES } from '@lms/shared';

import type { KyselyDb } from '../../core/db';
import { DomainException } from '../../core/http';
import { DataMinimisationService } from './data-minimisation.service';

// ── helpers ───────────────────────────────────────────────────────────────────

const PRODUCT_CONFIG_ID = 'prod-config-001';

/** Build a minimal Kysely db mock that returns the given `field_schema`. */
function buildDbMock(fieldSchema: { allowedFields: string[] } | null): KyselyDb {
  const executeTakeFirstOrThrow = jest.fn().mockResolvedValue({
    field_schema: fieldSchema,
  });
  const where = jest.fn().mockReturnValue({ executeTakeFirstOrThrow });
  const select = jest.fn().mockReturnValue({ where });
  const selectFrom = jest.fn().mockReturnValue({ select });
  return { selectFrom } as unknown as KyselyDb;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DataMinimisationService', () => {
  // ── T-05: all fields allowed ───────────────────────────────────────────────

  it('T-05: returns without throwing when all incoming fields are in allowedFields', async () => {
    const db = buildDbMock({ allowedFields: ['mobile', 'annual_income', 'dob'] });
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, {
        mobile: '9999999999',
        annual_income: 500000,
      }),
    ).resolves.toBeUndefined();
  });

  // ── T-06: single disallowed field ─────────────────────────────────────────

  it('T-06: throws VALIDATION_ERROR with the disallowed field name in fields[]', async () => {
    const db = buildDbMock({ allowedFields: ['mobile', 'annual_income'] });
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, {
        mobile: '9999999999',
        aadhaar_number: '1234-5678-9012',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'aadhaar_number' }),
      ]),
    });
  });

  // ── T-07: multiple disallowed fields ──────────────────────────────────────

  it('T-07: throws VALIDATION_ERROR listing all disallowed field names', async () => {
    const db = buildDbMock({ allowedFields: ['mobile'] });
    const service = new DataMinimisationService(db);

    let caught: DomainException | undefined;
    try {
      await service.assertAllowed(PRODUCT_CONFIG_ID, {
        mobile: '9999999999',
        aadhaar_number: '1234-5678-9012',
        biometric_data: 'base64xyz',
      });
    } catch (err) {
      caught = err as DomainException;
    }

    expect(caught).toBeInstanceOf(DomainException);
    expect(caught?.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    const fieldNames = (caught?.fields ?? []).map((f) => f.field);
    expect(fieldNames).toContain('aadhaar_number');
    expect(fieldNames).toContain('biometric_data');
    expect(fieldNames).not.toContain('mobile');
  });

  // ── T-08: empty field map fast-exits without querying DB ──────────────────

  it('T-08: returns without throwing and skips DB query when incomingFields is empty', async () => {
    const db = buildDbMock({ allowedFields: ['mobile'] });
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, {}),
    ).resolves.toBeUndefined();

    // selectFrom must NOT have been called — empty map is a fast-exit.
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  // ── T-09: null field_schema → guard is inert (safe permissive default) ───────
  //
  // When product_configs.field_schema is null (FR-040 has not yet populated
  // allowedFields), the guard must skip the check entirely rather than
  // reject-all. This prevents false negatives in the current deployment
  // where no product has allowedFields configured yet (AMBIGUITY.md §FR-111-A2).

  it('T-09: returns without throwing when product field_schema is null (safe permissive default)', async () => {
    const db = buildDbMock(null);
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, { mobile: '9999999999' }),
    ).resolves.toBeUndefined();
  });

  // ── T-10: empty allowedFields array → guard is inert ─────────────────────

  it('T-10: returns without throwing when allowedFields is an empty array (guard not yet configured)', async () => {
    const db = buildDbMock({ allowedFields: [] });
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, { mobile: '9999999999', annual_income: 500000 }),
    ).resolves.toBeUndefined();
  });

  // ── T-11: allowedFields present and non-empty → disallowed field is rejected ─

  it('T-11: throws VALIDATION_ERROR when allowedFields is populated and a disallowed field is present', async () => {
    const db = buildDbMock({ allowedFields: ['mobile'] });
    const service = new DataMinimisationService(db);

    await expect(
      service.assertAllowed(PRODUCT_CONFIG_ID, { mobile: '9999999999', restricted_field: 'x' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'restricted_field' }),
      ]),
    });
  });
});
