/** Browser-side predicates for canonical tenant identifiers returned by Zero. */

// Keep this response-boundary rule aligned with
// auth/tenancy/tenancy-canonicalization.ts. Persisted slugs are lowercase ASCII
// labels, may contain consecutive internal hyphens, and are at most 63 bytes.
const CANONICAL_TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isCanonicalAuthTenantSlug(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_TENANT_SLUG.test(value);
}
