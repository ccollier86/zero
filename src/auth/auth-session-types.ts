/** Durable parent-session types shared by browser access, refresh, and page auth. */

export type AuthSessionKind = 'web';
export type AuthSessionStatus = 'active' | 'revoked';
export type AuthSessionScopeKind = 'application' | 'tenant';
export type AuthSessionProvenance = 'local';

/** Explicit server-validated tenant binding requested at web-session issuance. */
export interface WebSessionBinding {
  tenantId: string;
  membershipId: string;
}

/**
 * Internal snapshot for a tenant being inserted by the same transaction that
 * persists the session. Live authority is revalidated after admission writes.
 */
export interface PreparedWebSessionBinding extends WebSessionBinding {
  tenantAuthorizationGeneration: number;
  membershipAuthorizationGeneration: number;
}

/**
 * Server-only durable authority shared by an access token and its refresh chain.
 * No bearer material, password data, or client-provided metadata is retained.
 */
export interface AuthSessionRecord {
  sessionId: string;
  userId: string;
  kind: AuthSessionKind;
  status: AuthSessionStatus;
  generation: number;
  scopeKind: AuthSessionScopeKind;
  scopeId: string;
  tenantId: string | null;
  membershipId: string | null;
  tenantAuthorizationGeneration: number | null;
  membershipAuthorizationGeneration: number | null;
  provenance: AuthSessionProvenance;
  authenticatedAt: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revocationReason: string | null;
}

export interface PrepareWebSessionInput {
  userId: string;
  expiresAt: number;
  binding?: WebSessionBinding | PreparedWebSessionBinding;
  authenticatedAt?: number;
}

export interface ResolveWebSessionInput {
  sessionId: string;
  userId: string;
  generation?: number;
}

export interface WebSessionIssueOptions {
  binding?: WebSessionBinding | PreparedWebSessionBinding;
}

/** One parent plus authorization data read in the same SQLite transaction. */
export interface ResolvedWebSessionAuthority {
  session: AuthSessionRecord;
  tenantRole: string | null;
}
