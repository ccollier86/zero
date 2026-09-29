/** Safe, accessor-free inspection of caught native/database-adapter failures. */

/**
 * Read one bounded data property from an error or its short prototype chain.
 * Accessors, hostile proxies, and exotic prototypes are treated as absent.
 */
export function readDatabaseCaughtErrorDataProperty(
  error: unknown,
  property: 'code' | 'message',
): unknown {
  try {
    if (!error || typeof error !== 'object') return undefined;
    let cursor: object | null = error;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, property);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
      cursor = Object.getPrototypeOf(cursor) as object | null;
    }
  } catch {
    // Caught proxy traps are never evidence for a failure classification and
    // their thrown values must not escape the database error boundary.
  }
  return undefined;
}
