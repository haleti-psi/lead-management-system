/** Postgres unique-violation SQLSTATE (duplicate key). */
const PG_UNIQUE_VIOLATION = '23505';

/** Postgres foreign-key-violation SQLSTATE (referenced row absent). */
const PG_FK_VIOLATION = '23503';

/** Narrow a thrown error to a Postgres unique-constraint (23505) violation. */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgCode(err, PG_UNIQUE_VIOLATION);
}

/** Narrow a thrown error to a Postgres foreign-key (23503) violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return hasPgCode(err, PG_FK_VIOLATION);
}

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}
