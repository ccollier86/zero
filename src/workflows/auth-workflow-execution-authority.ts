/** Auth-backed adapter for durable workflow execution authority. */

import {
  createAuthorizationSubjectSnapshot,
  type AuthorizationPropertyStore,
  type AuthorizationRoleAssignmentResolver,
} from '../auth/authorization-access';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import type {
  AuthRequestAuthorityReference,
  AuthRequestCredentialResolver,
} from '../auth/auth-api-key-types';
import { serviceDataScopeFromIdentity } from '../auth/service-data-scope';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import {
  createActorIdentity,
  sameExecutionIdentity,
  type WorkflowActorExecutionAuthority,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowExecutionAuthorityStore,
  type WorkflowResolvedExecutionAuthority,
} from './workflow-execution-authority';

export interface AuthWorkflowExecutionAuthorityProviderOptions {
  tokens: TokenService;
  /** Managed Guardian credential dispatcher; omitted by legacy standalone callers. */
  requestCredentials?: AuthRequestCredentialResolver | null;
  kernel: AuthorizationKernel;
  properties: AuthorizationPropertyStore;
  roleAssignments?: AuthorizationRoleAssignmentResolver | null;
  authorityStore: WorkflowExecutionAuthorityStore;
}

/**
 * Captures only live, server-derived auth state and re-resolves the same state
 * for every workflow dispatch/commit. No request body field participates.
 */
export class AuthWorkflowExecutionAuthorityProvider
implements WorkflowExecutionAuthorityProvider {
  constructor(
    private readonly options: AuthWorkflowExecutionAuthorityProviderOptions,
  ) {}

  captureActor(context: AuthContext): WorkflowActorExecutionAuthority | null {
    const reference = this.captureAuthority(context);
    if (!reference) return null;
    const current = this.resolveAuthority(reference);
    if (!current) return null;
    const resolved = this.resolveLive(current);
    if (!resolved) return null;

    return Object.freeze({
      version: 1,
      kind: 'actor',
      reference,
      identity: resolved.identity,
      propertiesMac: this.options.authorityStore.propertyMac(resolved.userProperties),
    });
  }

  revalidateActor(
    authority: WorkflowActorExecutionAuthority,
  ): WorkflowResolvedExecutionAuthority | null {
    const current = this.resolveAuthority(authority.reference);
    if (!current) return null;
    const resolved = this.resolveLive(current);
    if (!resolved
      || !sameExecutionIdentity(resolved.identity, authority.identity)
      || this.options.authorityStore.propertyMac(resolved.userProperties)
        !== authority.propertiesMac) return null;
    return Object.freeze({
      persisted: authority,
      identity: resolved.identity,
      scope: resolved.scope,
      authContext: current,
      userProperties: resolved.userProperties,
    });
  }

  private captureAuthority(
    context: AuthContext,
  ): WorkflowActorExecutionAuthority['reference'] | null {
    if (this.options.requestCredentials) {
      return this.options.requestCredentials.captureAuthority(context);
    }
    return this.options.tokens.captureAuthContextAuthority(context);
  }

  private resolveAuthority(
    reference: WorkflowActorExecutionAuthority['reference'],
  ): AuthContext | null {
    if (this.options.requestCredentials) {
      if (isRequestAuthorityReference(reference)) {
        return this.options.requestCredentials.resolveAuthority(reference);
      }
      // Managed runtimes never create new bare references, but retaining this
      // bridge lets workflows sealed before the resolver upgrade finish.
      return this.options.tokens.resolveAuthContextAuthority(reference);
    }
    return isRequestAuthorityReference(reference)
      ? reference.kind === 'session'
        ? this.options.tokens.resolveAuthContextAuthority(reference.reference)
        : null
      : this.options.tokens.resolveAuthContextAuthority(reference);
  }

  private resolveLive(context: AuthContext) {
    const scope = serviceDataScopeFromIdentity(
      context,
      this.options.kernel.tenancy.mode,
    );
    if (!scope) return null;
    const properties = Object.freeze({
      ...this.options.properties.getProperties(context.userId),
    });
    const subject = createAuthorizationSubjectSnapshot(
      this.options.kernel,
      context,
      properties,
      this.options.roleAssignments,
    );
    const authorization = subject.authorization;
    if (!authorization
      || authorization.scopeKind !== scope.scopeKind
      || authorization.scopeId !== scope.scopeId
      || (authorization.tenantId ?? null) !== scope.tenantId) return null;
    return {
      identity: createActorIdentity(context, authorization),
      scope,
      userProperties: properties,
    } as const;
  }
}

function isRequestAuthorityReference(
  reference: WorkflowActorExecutionAuthority['reference'],
): reference is AuthRequestAuthorityReference {
  return 'kind' in reference
    && (reference.kind === 'session' || reference.kind === 'api-key');
}
