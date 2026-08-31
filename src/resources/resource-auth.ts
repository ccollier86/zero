/**
 * resource-auth.ts
 *
 * Converts Zero auth context into the resource policy user shape. This file
 * owns auth-to-policy adaptation only; it does not verify tokens, evaluate
 * policies, query resources, or mount routes.
 */

import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import type { ResourcePolicyUser } from './resource-policy-types';

/**
 * Resolve the resource policy user for a request.
 *
 * When auth is backed by UserStore, this hydrates trusted user properties so
 * metadataPolicy() can evaluate configured admin/system claims. Without a
 * store, it falls back to JWT claims and an empty property map.
 */
export function createResourcePolicyUser(
  authContext: AuthContext | null | undefined,
  userStore: UserStore | null | undefined
): ResourcePolicyUser | null {
  if (!authContext) return null;

  if (!userStore) {
    return {
      userId: authContext.userId,
      email: authContext.email,
      role: authContext.role,
      properties: {},
    };
  }

  const user = userStore.getUserById(authContext.userId);
  if (!user) return null;
  if (user.status === 'suspended' || user.passwordChangeRequired) return null;
  if (user.emailVerificationRequired && !user.emailVerifiedAt) return null;

  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    properties: user.properties,
  };
}
