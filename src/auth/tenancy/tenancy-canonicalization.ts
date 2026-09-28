import { TenancyError } from './tenancy-types';

const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TENANT_ROLE_PATTERN = /^[a-z][a-z0-9:_-]{0,63}$/;

/**
 * Canonicalize a tenant slug before persistence or lookup.
 *
 * Slugs are one lowercase ASCII label. Whitespace and underscores become
 * hyphens, and repeated hyphens collapse so equivalent routing identifiers
 * cannot occupy separate tenant rows.
 */
export function canonicalizeTenantSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');

  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new TenancyError(
      'Tenant slug must be a 1-63 character lowercase ASCII label',
      'TENANT_INVALID_SLUG',
    );
  }
  return slug;
}

/** Normalize product-facing whitespace while preserving international names. */
export function canonicalizeTenantName(value: string): string {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > 120) {
    throw new TenancyError(
      'Tenant name must contain between 1 and 120 characters',
      'TENANT_INVALID_NAME',
    );
  }
  return name;
}

/** Canonical simple-mode role key used by the protected owner invariant. */
export function canonicalizeTenantRoleKey(value: string): string {
  const roleKey = value.normalize('NFKC').trim().toLowerCase();
  if (!TENANT_ROLE_PATTERN.test(roleKey)) {
    throw new TenancyError(
      'Tenant role key must be a 1-64 character lowercase identifier',
      'TENANT_INVALID_ROLE',
    );
  }
  return roleKey;
}
