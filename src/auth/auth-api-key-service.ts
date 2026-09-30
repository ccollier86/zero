/** Guardian user API-key facade: authentication plus session-only management. */

import { OBS_CODES } from '../observability/codes';
import { AuthApiKeyAuthority } from './auth-api-key-authority';
import {
  isAuthApiKeyToken,
  parseAuthApiKeyCredential,
  verifyAuthApiKeyCredential,
} from './auth-api-key-credential';
import { AuthApiKeyManagement } from './auth-api-key-management';
import type { AuthApiKeyStore } from './auth-api-key-store';
import type {
  AuthApiKeyAuthorityReference,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyMutationAuthority,
  AuthApiKeyPage,
  AuthApiKeySummary,
  AuthApiKeyTenantTarget,
  IssuedAuthApiKey,
} from './auth-api-key-types';
import type { AuthAuditService } from './auth-audit-service';
import { authContextAuthorityFingerprint } from './auth-context-authority';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { TenancyService } from './tenancy/tenancy-service';
import type { AuthContext, ResolvedAuthApiKeyConfig } from './types';
import type { UserStore } from './user-store';

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;

export interface AuthApiKeyServiceOptions {
  readonly config: ResolvedAuthApiKeyConfig;
  readonly store: AuthApiKeyStore;
  readonly users: UserStore;
  readonly tenancy: TenancyService | null;
  readonly authorization: AuthorizationKernel;
  readonly roles: AuthorizationRoleService | null;
  readonly audit: AuthAuditService;
  readonly emitCode: AuthPlatformCodeEmitter;
  readonly now?: () => number;
  readonly assertCurrentProfile?: () => void;
}

export class AuthApiKeyService {
  private readonly now: () => number;
  private readonly authority: AuthApiKeyAuthority;
  private readonly management: AuthApiKeyManagement;

  constructor(private readonly options: AuthApiKeyServiceOptions) {
    this.now = options.now ?? Date.now;
    this.authority = new AuthApiKeyAuthority(options);
    this.management = new AuthApiKeyManagement({
      ...options,
      authority: this.authority,
      now: this.now,
      assertCurrentProfile: () => this.assertCurrentProfile(),
    });
  }

  get enabled(): boolean {
    return this.options.config.enabled;
  }

  isApiKeyToken(raw: string): boolean {
    return isAuthApiKeyToken(raw);
  }

  /** Verify one raw credential and hydrate its complete live user authority. */
  resolve(raw: string): AuthContext | null {
    this.assertCurrentProfile();
    if (!this.enabled) return null;
    const parsed = parseAuthApiKeyCredential(raw);
    if (!parsed) return null;
    const record = this.options.store.getById(parsed.keyId);
    if (!record || !verifyAuthApiKeyCredential(raw, record.secretHash)) {
      this.emitRejected('secret');
      return null;
    }
    const now = this.now();
    const context = this.authority.hydrate(record, now);
    if (!context) {
      this.emitRejected('authority');
      return null;
    }
    this.options.store.touchLastUsed(
      record.keyId,
      record.keyGeneration,
      now,
      now - LAST_USED_WRITE_INTERVAL_MS,
    );
    this.assertCurrentProfile();
    return context;
  }

  captureAuthority(context: AuthContext): AuthApiKeyAuthorityReference | null {
    this.assertCurrentProfile();
    if (context.credentialKind !== 'api-key' || !context.credentialId) return null;
    const record = this.options.store.getById(context.credentialId);
    if (!record) return null;
    const current = this.authority.hydrate(record, this.now());
    if (!current || authContextAuthorityFingerprint(current)
      !== authContextAuthorityFingerprint(context)) return null;
    const reference = Object.freeze({
      kind: 'api-key',
      version: 1,
      keyId: record.keyId,
      keyGeneration: record.keyGeneration,
      userId: record.userId,
      scopeKind: record.scopeKind,
      scopeId: record.scopeId,
    });
    this.assertCurrentProfile();
    return reference;
  }

  resolveAuthority(reference: AuthApiKeyAuthorityReference): AuthContext | null {
    this.assertCurrentProfile();
    if (reference.version !== 1 || reference.kind !== 'api-key') return null;
    const record = this.options.store.getById(reference.keyId);
    if (!record
      || record.keyGeneration !== reference.keyGeneration
      || record.userId !== reference.userId
      || record.scopeKind !== reference.scopeKind
      || record.scopeId !== reference.scopeId) return null;
    const context = this.authority.hydrate(record, this.now());
    if (!context) return null;
    this.assertCurrentProfile();
    return context;
  }

  listSelf(auth: AuthContext, query?: AuthApiKeyListQuery): AuthApiKeyPage {
    return this.management.listSelf(auth, query);
  }

  issueSelf(
    operation: AuthApiKeyMutationAuthority,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.issueSelf(operation, input);
  }

  rotateSelf(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.rotateSelf(operation, keyId, input);
  }

  revokeSelf(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    return this.management.revokeSelf(operation, keyId);
  }

  listForAdministrator(
    auth: AuthContext,
    target: { userId?: string; membershipId?: string },
    query?: AuthApiKeyListQuery,
  ): AuthApiKeyPage {
    return this.management.listForAdministrator(auth, target, query);
  }

  issueForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    target: { userId?: string; membershipId?: string },
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.issueForAdministrator(operation, target, input);
  }

  rotateForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.rotateForAdministrator(operation, keyId, input);
  }

  revokeForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    return this.management.revokeForAdministrator(operation, keyId);
  }

  listPlatform(
    auth: AuthContext,
    query?: AuthApiKeyListQuery,
    tenantId?: string,
  ): AuthApiKeyPage {
    return this.management.listPlatform(auth, query, tenantId);
  }

  listForPlatformTarget(
    auth: AuthContext,
    target: AuthApiKeyTenantTarget,
    query?: AuthApiKeyListQuery,
  ): AuthApiKeyPage {
    return this.management.listForPlatformTarget(auth, target, query);
  }

  issueForPlatform(
    operation: AuthApiKeyMutationAuthority,
    target: AuthApiKeyTenantTarget,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.issueForPlatform(operation, target, input);
  }

  rotateForPlatform(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    return this.management.rotateForPlatform(operation, keyId, input);
  }

  revokeForPlatform(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    return this.management.revokeForPlatform(operation, keyId);
  }

  private assertCurrentProfile(): void {
    this.options.assertCurrentProfile?.();
  }

  private emitRejected(reason: 'secret' | 'authority'): void {
    this.options.emitCode(OBS_CODES.AUTH_API_KEY_REJECTED, {
      metadata: { reason },
    });
  }
}
