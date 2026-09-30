import type { AuthContext } from './types';

export type AuthApiKeyScopeKind = 'application' | 'tenant';
export type AuthApiKeyCreatedVia = 'self' | 'administrator';
export type AuthApiKeyStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  /** Permanently invalidated by an account security-generation change. */
  | 'invalidated'
  /** Temporarily unusable because its user, tenant, or membership is inactive. */
  | 'unavailable';

/** Private persisted API-key record. It never contains the raw bearer secret. */
export interface AuthApiKeyRecord {
  readonly keyId: string;
  readonly userId: string;
  readonly label: string;
  readonly secretHash: string;
  readonly secretHint: string;
  readonly scopeKind: AuthApiKeyScopeKind;
  readonly scopeId: string;
  readonly tenantId: string | null;
  readonly membershipId: string | null;
  readonly issuedAuthGeneration: number;
  readonly keyGeneration: number;
  readonly createdByUserId: string | null;
  readonly createdVia: AuthApiKeyCreatedVia;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly revokedByUserId: string | null;
  readonly rotatedFromKeyId: string | null;
}

/** Secret-free API projection safe for management UI and logs. */
export interface AuthApiKeySummary {
  readonly keyId: string;
  readonly userId: string;
  readonly label: string;
  readonly hint: string;
  readonly scopeKind: AuthApiKeyScopeKind;
  readonly scopeId: string;
  readonly tenantId: string | null;
  readonly membershipId: string | null;
  readonly createdByUserId: string | null;
  readonly createdVia: AuthApiKeyCreatedVia;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly status: AuthApiKeyStatus;
}

export interface AuthApiKeyIssueInput {
  readonly label: string;
  readonly ttl?: string;
}

export interface AuthApiKeyListQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

/** Live server-owned actions available for the returned management scope. */
export interface AuthApiKeyManagementCapabilities {
  readonly canIssue: boolean;
  readonly canRotate: boolean;
  readonly canRevoke: boolean;
}

export interface AuthApiKeyPage {
  readonly apiKeys: readonly AuthApiKeySummary[];
  readonly capabilities: Readonly<AuthApiKeyManagementCapabilities>;
  readonly page: Readonly<{
    readonly limit: number;
    readonly count: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  }>;
}

/** Session-only mutation fence captured by a Guardian management route. */
export interface AuthApiKeyMutationAuthority {
  readonly auth: AuthContext;
  /** Revalidate the exact session and required management permission in-transaction. */
  readonly assertCurrent: () => AuthContext;
  readonly auditRequest?: import('./auth-audit-types').AuthAuditRequestContext;
}

export interface AuthApiKeyTenantTarget {
  readonly tenantId: string;
  readonly membershipId: string;
}

export interface IssuedAuthApiKey {
  readonly apiKey: AuthApiKeySummary;
  /** Returned exactly once. Guardian never persists this value. */
  readonly secret: string;
}

export interface AuthApiKeyAuthorityReference {
  readonly kind: 'api-key';
  readonly version: 1;
  readonly keyId: string;
  readonly keyGeneration: number;
  readonly userId: string;
  readonly scopeKind: AuthApiKeyScopeKind;
  readonly scopeId: string;
}

export type AuthRequestAuthorityReference =
  | {
      readonly kind: 'session';
      readonly reference: import('./types').AuthContextAuthorityReference;
    }
  | AuthApiKeyAuthorityReference;

/** Credential-neutral resolver used only by app API middleware and commit fences. */
export interface AuthRequestCredentialResolver {
  resolve(request: Request): Promise<AuthContext | null>;
  captureAuthority(context: AuthContext): AuthRequestAuthorityReference | null;
  resolveAuthority(reference: AuthRequestAuthorityReference): AuthContext | null;
}
