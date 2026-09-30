/**
 * resource-policy-authority.ts
 *
 * Captures and revalidates the complete authority used by generated Resource
 * policy decisions. It owns request and commit-boundary fencing only; it does
 * not evaluate resource policy, route tenants, or access application rows.
 */

import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import {
  createResourcePolicyAuthorization,
  createResourcePolicyUser,
} from './resource-auth';
import type { ResourceCrudRequestContext } from './resource-crud-contracts';

/** Immutable authority snapshot shared by policy evaluation and commit fences. */
export interface ResourcePolicyAuthoritySnapshot {
  readonly authContext: AuthContext | null;
  readonly user: ReturnType<typeof createResourcePolicyUser>;
  readonly authorization: ReturnType<typeof createResourcePolicyAuthorization>;
  /** Stable logical caller identity used only to namespace durable receipts. */
  readonly receiptPrincipalFingerprint: string;
  /** Full transient session/RBAC snapshot used for live request fencing. */
  readonly fingerprint: string;
}

/** Inputs required to resolve Resource policy authority without transport state. */
export interface ResourcePolicyAuthorityOptions {
  readonly userStore?: UserStore | null;
  readonly authorizationKernel?: AuthorizationKernel | null;
  readonly roleAssignments?: AuthorizationRoleAssignmentResolver | null;
}

/** Capture and compare Resource authority across asynchronous and commit work. */
export class ResourcePolicyAuthorityService {
  constructor(private readonly options: ResourcePolicyAuthorityOptions) {}

  /** Capture one immutable authority snapshot from a request context. */
  capture(context: ResourceCrudRequestContext): ResourcePolicyAuthoritySnapshot {
    return this.resolve(context.authContext ?? null);
  }

  /** Re-resolve asynchronous bearer authority and compare the full snapshot. */
  async isCurrent(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): Promise<boolean> {
    if (!context.revalidateAuthContext) return true;
    try {
      const authContext = await context.revalidateAuthContext();
      return this.resolve(authContext).fingerprint === captured.fingerprint;
    } catch {
      return false;
    }
  }

  /** Compare durable authority synchronously at a database commit boundary. */
  isCurrentAtCommit(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): boolean {
    if (!context.resolveAuthContextAtCommit) return true;
    try {
      const authContext = context.resolveAuthContextAtCommit();
      return this.resolve(authContext).fingerprint === captured.fingerprint;
    } catch {
      return false;
    }
  }

  /**
   * Compare authority for physical tenant binding/actor work.
   *
   * Unlike the default-plane compatibility path, physical isolation requires
   * a synchronous durable resolver and therefore fails closed when absent.
   */
  isCurrentForTenantDatabase(
    context: ResourceCrudRequestContext,
    captured: ResourcePolicyAuthoritySnapshot,
  ): boolean {
    const resolver = context.resolveAuthContextAtCommit;
    if (!resolver) return false;
    try {
      return this.resolve(resolver()).fingerprint === captured.fingerprint;
    } catch {
      return false;
    }
  }

  private resolve(authContext: AuthContext | null): ResourcePolicyAuthoritySnapshot {
    const user = createResourcePolicyUser(authContext, this.options.userStore);
    const authorization = createResourcePolicyAuthorization(
      authContext,
      user,
      this.options.authorizationKernel,
      this.options.roleAssignments,
    );
    return {
      authContext,
      user,
      authorization,
      receiptPrincipalFingerprint: receiptPrincipalFingerprint(
        authContext,
        authorization,
      ),
      fingerprint: policyAuthorityFingerprint(authContext, user, authorization),
    };
  }
}

function receiptPrincipalFingerprint(
  auth: AuthContext | null,
  authorization: ReturnType<typeof createResourcePolicyAuthorization>,
): string {
  return JSON.stringify({
    auth: auth ? {
      userId: auth.userId,
      clientId: auth.clientId ?? null,
      sessionScopeKind: auth.sessionScopeKind ?? null,
      sessionScopeId: auth.sessionScopeId ?? null,
      tenantId: auth.tenantId ?? null,
      membershipId: auth.membershipId ?? null,
    } : null,
    authorizationScope: authorization?.subject?.authorization ? {
      scopeKind: authorization.subject.authorization.scopeKind,
      scopeId: authorization.subject.authorization.scopeId,
    } : null,
  });
}

function policyAuthorityFingerprint(
  auth: AuthContext | null,
  user: ReturnType<typeof createResourcePolicyUser>,
  authorization: ReturnType<typeof createResourcePolicyAuthorization>,
): string {
  return JSON.stringify({
    auth: auth ? {
      userId: auth.userId,
      email: auth.email,
      role: auth.role,
      credentialKind: auth.credentialKind ?? 'session',
      credentialId: auth.credentialId ?? null,
      authGeneration: auth.authGeneration ?? null,
      clientId: auth.clientId ?? null,
      sessionKind: auth.sessionKind ?? null,
      scope: auth.scope ? [...auth.scope].sort(compareText) : null,
      sessionId: auth.sessionId ?? null,
      sessionGeneration: auth.sessionGeneration ?? null,
      sessionScopeKind: auth.sessionScopeKind ?? null,
      sessionScopeId: auth.sessionScopeId ?? null,
      tenantId: auth.tenantId ?? null,
      membershipId: auth.membershipId ?? null,
      tenantKind: auth.tenantKind ?? null,
      tenantRole: auth.tenantRole ?? null,
      tenantAuthorizationGeneration: auth.tenantAuthorizationGeneration ?? null,
      membershipAuthorizationGeneration:
        auth.membershipAuthorizationGeneration ?? null,
      authorizationAssignmentRevision:
        auth.authorizationAssignmentRevision ?? null,
    } : null,
    user: user ? {
      userId: user.userId,
      email: user.email ?? null,
      role: user.role,
      properties: Object.entries(user.properties).sort(([left], [right]) =>
        compareText(left, right)),
    } : null,
    authorization: authorization?.subject?.authorization ? {
      tenantKind: authorization.tenantKind ?? null,
      scopeKind: authorization.subject.authorization.scopeKind,
      scopeId: authorization.subject.authorization.scopeId,
      roles: authorization.subject.authorization.roles,
      permissions: authorization.subject.authorization.permissions,
      allPermissions: authorization.subject.authorization.allPermissions ?? false,
      revision: authorization.subject.authorization.revision,
    } : null,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
