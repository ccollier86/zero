/** Public contracts for durable workflow execution authority. */

import type { AuthRequestAuthorityReference } from '../auth/auth-api-key-types';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import type { ServiceDataScope } from '../auth/service-data-scope';

export type WorkflowExecutionAuthorityKind = 'actor' | 'system';

/** Immutable, secret-free identity exposed to step handlers. */
export type WorkflowExecutionIdentity =
  | Readonly<{
      kind: 'actor';
      userId: string;
      platformRole: string;
      scopeKind: 'application' | 'tenant';
      scopeId: string;
      tenantId: string | null;
      membershipId: string | null;
      roles: readonly string[];
      permissions: readonly string[];
      allPermissions: boolean;
      authorizationRevision: string;
    } & (
      | {
          /** Omitted by v1 session seals for backwards-compatible persistence. */
          credentialKind?: 'session';
          credentialId?: null;
          sessionKind: 'web' | 'native';
          clientId: string | null;
        }
      | {
          credentialKind: 'api-key';
          credentialId: string;
          sessionKind: null;
          clientId: null;
        }
    )>
  | Readonly<{
      kind: 'system';
      principal: string;
      reason: string;
      scopeKind: 'application' | 'tenant';
      scopeId: string;
      tenantId: string | null;
      roles: readonly [];
      permissions: readonly [];
      allPermissions: true;
      legacyCompatibility: boolean;
    }>;

export interface WorkflowActorExecutionAuthority {
  readonly version: 1;
  readonly kind: 'actor';
  readonly reference: AuthContextAuthorityReference | AuthRequestAuthorityReference;
  readonly identity: Extract<WorkflowExecutionIdentity, { kind: 'actor' }>;
  /** Keyed digest only; raw server-owned user properties are never persisted. */
  readonly propertiesMac: string;
}

export interface WorkflowSystemExecutionAuthority {
  readonly version: 1;
  readonly kind: 'system';
  readonly identity: Extract<WorkflowExecutionIdentity, { kind: 'system' }>;
}

export type WorkflowPersistedExecutionAuthority =
  | WorkflowActorExecutionAuthority
  | WorkflowSystemExecutionAuthority;

/** MAC-sealed authority envelope used by adjacent private workflow records. */
export interface WorkflowAuthoritySeal {
  readonly authorityJson: string;
  readonly authorityMac: string;
}

/** Live result returned only after the persisted seal and authority are valid. */
export interface WorkflowResolvedExecutionAuthority {
  readonly persisted: WorkflowPersistedExecutionAuthority;
  readonly identity: WorkflowExecutionIdentity;
  readonly scope: ServiceDataScope;
  readonly authContext: AuthContext | null;
  readonly userProperties: Readonly<Record<string, string>>;
}

/** Auth adapter contract; the workflow core does not depend on HTTP/Elysia. */
export interface WorkflowExecutionAuthorityProvider {
  captureActor(context: AuthContext): WorkflowActorExecutionAuthority | null;
  revalidateActor(
    authority: WorkflowActorExecutionAuthority,
  ): WorkflowResolvedExecutionAuthority | null;
}

/**
 * Optional bridge used to construct the request-equivalent `ctx.zero` facade.
 * Implementations must close every service over `input.scope` and use
 * `input.assertCurrentAuthority()` before security-sensitive commits.
 */
export interface WorkflowExecutionServiceProvider<TServices = unknown> {
  createServices(input: {
    readonly authority: WorkflowResolvedExecutionAuthority;
    readonly assertCurrentAuthority: () => void;
  }): TServices;
}

export interface WorkflowSystemExecutionOptions {
  /** Stable component/plugin name used in the private audit seal. */
  principal: string;
  /** Human-readable bounded reason for privileged background execution. */
  reason: string;
  /** Required in multi-tenant mode; defaults to application scope in single mode. */
  scope?: ServiceDataScope;
}

export type WorkflowAuthorityFailureReason =
  | 'authority-missing'
  | 'authority-seal-invalid'
  | 'authority-revoked'
  | 'authority-scope-mismatch';

export type WorkflowAuthorityReadResult =
  | { ok: true; authority: WorkflowPersistedExecutionAuthority }
  | { ok: false; reason: 'authority-missing' | 'authority-seal-invalid' };
