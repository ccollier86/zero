/** Create-time role-selection contract shared by HTTP and service adapters. */

import { AuthError, type AuthAuthorizationMode } from './types';
import { normalizeAuthRoleSelection } from './auth-role-selection';

export const AUTH_TENANT_MEMBER_MAX_ROLE_COUNT = 32;

/**
 * Normalize a new member's role selection without weakening the public HTTP
 * contract for non-HTTP callers. Omission deliberately means `member`; an
 * explicitly empty selection never does.
 */
export function normalizeAuthTenantMemberCreateRoleKeys(
  input: readonly string[] | undefined,
  mode: AuthAuthorizationMode,
): readonly string[] {
  const selected = input === undefined ? ['member'] : input;
  const normalized = normalizeAuthRoleSelection(selected, {
    minimum: 1,
    maximum: AUTH_TENANT_MEMBER_MAX_ROLE_COUNT,
    invalid: invalidTenantRoleSelection,
  });
  if (mode === 'simple' && normalized.length !== 1) {
    throw invalidTenantRoleSelection();
  }

  return normalized;
}

/**
 * Normalize an explicitly supplied replacement set. A literal empty array is
 * preserved for advanced customer memberships; sparse, blank, malformed, or
 * duplicate arrays cannot masquerade as that deliberate clear operation.
 */
export function normalizeAuthTenantMemberReplacementRoleKeys(
  input: readonly string[],
): readonly string[] {
  return normalizeAuthRoleSelection(input, {
    minimum: 0,
    maximum: AUTH_TENANT_MEMBER_MAX_ROLE_COUNT,
    invalid: invalidTenantRoleSelection,
  });
}

export function invalidTenantRoleSelection(): AuthError {
  return new AuthError(
    'Tenant member role selection is invalid',
    'TENANT_ROLE_SELECTION_INVALID',
    422,
  );
}
