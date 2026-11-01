/**
 * Projects properties used by live authorization fences. Managed stores use
 * Guardian's explicit policy-trust declaration; legacy adapters remain
 * conservative and bind every supplied property. This is not a permission
 * evaluator and must not alter the full property data exposed to services.
 */

/** The small property boundary consumed by request and audit admission. */
export interface AuthAuthorityPropertyStore {
  getProperties(userId: string): Record<string, string>;
  getAuthorityProperties?(userId: string): Record<string, string>;
}

/** Read a policy-aware snapshot, retaining all-property fencing for legacy stores. */
export function readAuthAuthorityProperties(
  store: AuthAuthorityPropertyStore | null | undefined,
  userId: string,
): Record<string, string> {
  return store?.getAuthorityProperties
    ? store.getAuthorityProperties(userId)
    : store?.getProperties(userId) ?? {};
}
