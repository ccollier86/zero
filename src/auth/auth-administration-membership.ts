/** Live administration-organization membership detection for security policy. */

import type { TenancyService } from './tenancy/tenancy-service';

/**
 * Resolve whether a user currently belongs to the protected administration
 * organization. Every such member crosses the platform control-plane trust
 * boundary, including a retained legacy membership whose current role grants
 * no explicit application permission.
 *
 * This intentionally reads live tenancy state on every call. It is a security
 * policy predicate, not a claim suitable for caching in a token or user row.
 */
export function createAdministrationMemberResolver(
  tenancy: TenancyService | null,
): (userId: string) => boolean {
  return (userId) => {
    if (!tenancy) return false;
    return tenancy.hasActiveAdministrationMembership(userId);
  };
}
