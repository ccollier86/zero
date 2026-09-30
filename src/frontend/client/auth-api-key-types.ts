/** Browser-safe contracts for Guardian user API-key management. */

export type AuthApiKeyScopeKind = 'application' | 'tenant';
export type AuthApiKeyCreatedVia = 'self' | 'administrator';
export type AuthApiKeyStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'invalidated'
  | 'unavailable';

/** Secret-free key projection safe to retain in browser state. */
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

/** Server-authoritative mutation presentation for the exact management view. */
export interface AuthApiKeyManagementCapabilities {
  readonly canIssue: boolean;
  readonly canRotate: boolean;
  readonly canRevoke: boolean;
}

export interface AuthPlatformApiKeyListQuery extends AuthApiKeyListQuery {
  readonly tenantId?: string;
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

/** The raw secret is returned once and must not be persisted by the SDK. */
export interface IssuedAuthApiKey {
  readonly apiKey: AuthApiKeySummary;
  readonly secret: string;
}

export interface AuthApiKeySelfSdkSurface {
  list(query?: AuthApiKeyListQuery): Promise<AuthApiKeyPage>;
  issue(input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  rotate(keyId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  revoke(keyId: string): Promise<AuthApiKeySummary>;
}

export interface AuthApiKeyApplicationAdminSdkSurface {
  listUser(userId: string, query?: AuthApiKeyListQuery): Promise<AuthApiKeyPage>;
  issueUser(userId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  rotate(keyId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  revoke(keyId: string): Promise<AuthApiKeySummary>;
}

export interface AuthApiKeyTenantAdminSdkSurface {
  listMember(membershipId: string, query?: AuthApiKeyListQuery): Promise<AuthApiKeyPage>;
  issueMember(
    membershipId: string,
    input: AuthApiKeyIssueInput,
  ): Promise<IssuedAuthApiKey>;
  rotate(keyId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  revoke(keyId: string): Promise<AuthApiKeySummary>;
}

export interface AuthApiKeyPlatformAdminSdkSurface {
  list(query?: AuthPlatformApiKeyListQuery): Promise<AuthApiKeyPage>;
  listMember(
    tenantId: string,
    membershipId: string,
    query?: AuthApiKeyListQuery,
  ): Promise<AuthApiKeyPage>;
  issueMember(
    tenantId: string,
    membershipId: string,
    input: AuthApiKeyIssueInput,
  ): Promise<IssuedAuthApiKey>;
  rotate(keyId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  revoke(keyId: string): Promise<AuthApiKeySummary>;
}

/** Mode-safe namespaces keep a component from accidentally crossing control planes. */
export interface AuthApiKeySdkSurface {
  readonly self: AuthApiKeySelfSdkSurface;
  readonly applicationAdmin: AuthApiKeyApplicationAdminSdkSurface;
  readonly tenantAdmin: AuthApiKeyTenantAdminSdkSurface;
  readonly platformAdmin: AuthApiKeyPlatformAdminSdkSurface;
}
