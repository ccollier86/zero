/**
 * resource-auth.ts
 *
 * Converts Zero auth context into the resource policy user shape. This file
 * owns auth-to-policy adaptation only; it does not verify tokens, evaluate
 * policies, query resources, or mount routes.
 */

import {
  createAuthorizationSubjectSnapshot,
  type AuthorizationRoleAssignmentResolver,
} from '../auth/authorization-access';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import type {
  ResourcePolicyAuthorizationContext,
  ResourcePolicyUser,
} from './resource-policy-types';

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

/**
 * Project the same live RBAC subject used by route guards into resource policy.
 *
 * A missing kernel is kept distinct from an anonymous subject: managed policy
 * helpers can return a service-unavailable denial for broken composition while
 * an anonymous request receives the ordinary authentication denial.
 */
export function createResourcePolicyAuthorization(
  authContext: AuthContext | null | undefined,
  user: ResourcePolicyUser | null,
  kernel: AuthorizationKernel | null | undefined,
  roleAssignments?: AuthorizationRoleAssignmentResolver | null,
): ResourcePolicyAuthorizationContext | null {
  if (!kernel) return null;
  return Object.freeze({
    kernel,
    tenantKind: authContext?.tenantKind ?? null,
    subject: authContext && user
      ? createAuthorizationSubjectSnapshot(
          kernel,
          authContext,
          user.properties,
          roleAssignments,
        )
      : null,
  });
}
