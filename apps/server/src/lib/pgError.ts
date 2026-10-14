/** Postgres error codes the routes answer for. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_UNIQUE_VIOLATION = '23505';

/** Whether a query failed with a Postgres error code. Drizzle wraps the driver's error. */
export function isPgError(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === code) return true;
  return 'cause' in error && isPgError(error.cause, code);
}
