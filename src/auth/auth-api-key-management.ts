/** Session-only lifecycle and administrative policy for Guardian user API keys. */

import { OBS_CODES } from '../observability/codes';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import {
  type AuthApiKeyAuthority,
  type AuthApiKeyBinding,
} from './auth-api-key-authority';
import { createAuthApiKeyCredential } from './auth-api-key-credential';
import { AuthApiKeyDirectory } from './auth-api-key-directory';
import {
  apiKeyAuthorityChanged,
  apiKeyConflict,
  apiKeyForbidden,
  apiKeyLimitReached,
  apiKeyNotFound,
  apiKeySubjectIneligible,
  apiKeyValidation,
} from './auth-api-key-errors';
import { resolveAuthApiKeyExpiry } from './auth-api-key-time';
import { AuthApiKeyManagementPolicy } from './auth-api-key-management-policy';
import type { AuthApiKeyStore } from './auth-api-key-store';
import type {
  AuthApiKeyCreatedVia,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyMutationAuthority,
  AuthApiKeyPage,
  AuthApiKeyRecord,
  AuthApiKeySummary,
  AuthApiKeyTenantTarget,
  IssuedAuthApiKey,
} from './auth-api-key-types';
import {
  authAuditActorFromContext,
  type AuthAuditService,
} from './auth-audit-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AuthContext, ResolvedAuthApiKeyConfig } from './types';
import type { UserStore } from './user-store';

export interface AuthApiKeyManagementOptions {
  readonly config: ResolvedAuthApiKeyConfig;
  readonly store: AuthApiKeyStore;
  readonly users: UserStore;
  readonly authority: AuthApiKeyAuthority;
  readonly authorization: AuthorizationKernel;
  readonly roles: AuthorizationRoleService | null;
  readonly audit: AuthAuditService;
  readonly emitCode: AuthPlatformCodeEmitter;
  readonly now: () => number;
  readonly assertCurrentProfile: () => void;
}

export class AuthApiKeyManagement {
  private readonly directory: AuthApiKeyDirectory;
  private readonly policy: AuthApiKeyManagementPolicy;

  constructor(private readonly options: AuthApiKeyManagementOptions) {
    this.directory = new AuthApiKeyDirectory(options);
    this.policy = new AuthApiKeyManagementPolicy(options);
  }

  listSelf(auth: AuthContext, query: AuthApiKeyListQuery = {}): AuthApiKeyPage {
    this.policy.requireSession(auth);
    this.policy.requireSelfService();
    const binding = this.options.authority.bindingFromActor(auth);
    if (!binding) throw apiKeyForbidden();
    return this.directory.listUserBinding(
      auth.userId,
      binding,
      query,
      this.policy.selfCapabilities(auth, binding),
    );
  }

  issueSelf(
    operation: AuthApiKeyMutationAuthority,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireSession(operation.auth);
    this.policy.requireSelfService();
    return this.issueInTransaction(operation, input, 'self', (actor) => {
      const binding = this.options.authority.bindingFromActor(actor);
      // API keys are deliberately unavailable in the protected multi-tenant
      // Administration Organization. The exact session has already been
      // revalidated above, so a missing customer/application binding is an
      // authorization denial rather than a concurrency failure.
      if (!binding) throw apiKeyForbidden();
      return { userId: actor.userId, binding };
    });
  }

  rotateSelf(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireSession(operation.auth);
    this.policy.requireSelfService();
    return this.rotateInTransaction(operation, keyId, input, 'self', (actor, record) => {
      const binding = this.options.authority.bindingFromActor(actor);
      if (!binding || !sameBinding(record, actor.userId, binding)) throw apiKeyNotFound();
      return { userId: actor.userId, binding };
    });
  }

  revokeSelf(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    this.policy.requireSession(operation.auth);
    this.policy.requireSelfService();
    return this.revokeInTransaction(operation, keyId, (actor, record) => {
      const binding = this.options.authority.bindingFromActor(actor);
      if (!binding || !sameBinding(record, actor.userId, binding)) throw apiKeyNotFound();
      return binding;
    });
  }

  listForAdministrator(
    auth: AuthContext,
    target: { userId?: string; membershipId?: string },
    query: AuthApiKeyListQuery = {},
  ): AuthApiKeyPage {
    const binding = this.policy.requireAdministratorTarget(auth, target, false);
    const userId = binding.membership?.userId ?? target.userId;
    if (!userId) throw apiKeyNotFound();
    return this.directory.listUserBinding(
      userId,
      binding,
      query,
      this.policy.administratorCapabilities(auth, userId, binding),
    );
  }

  issueForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    target: { userId?: string; membershipId?: string },
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireAdministratorIssuance();
    return this.issueInTransaction(operation, input, 'administrator', (actor) => {
      const binding = this.policy.requireAdministratorTarget(actor, target, true);
      const userId = binding.membership?.userId ?? target.userId;
      if (!userId) throw apiKeyNotFound();
      return { userId, binding };
    });
  }

  rotateForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireAdministratorIssuance();
    return this.rotateInTransaction(
      operation,
      keyId,
      input,
      'administrator',
      (actor, record) => {
        const binding = this.policy.requireAdministratorRecord(actor, record, true);
        return { userId: record.userId, binding };
      },
    );
  }

  revokeForAdministrator(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    return this.revokeInTransaction(operation, keyId, (actor, record) => (
      this.policy.requireAdministratorRecord(actor, record, false)
    ));
  }

  listPlatform(
    auth: AuthContext,
    query: AuthApiKeyListQuery = {},
    tenantId?: string,
  ): AuthApiKeyPage {
    this.policy.requirePlatformAdministrator(auth, false);
    return this.directory.listPlatform(
      query,
      this.policy.platformCapabilities(auth),
      tenantId,
    );
  }

  listForPlatformTarget(
    auth: AuthContext,
    target: AuthApiKeyTenantTarget,
    query: AuthApiKeyListQuery = {},
  ): AuthApiKeyPage {
    this.policy.requirePlatformAdministrator(auth, false);
    const binding = this.policy.requirePlatformTarget(target, false);
    const userId = binding.membership!.userId;
    return this.directory.listUserBinding(
      userId,
      binding,
      query,
      this.policy.platformCapabilities(auth, { userId, binding }),
    );
  }

  issueForPlatform(
    operation: AuthApiKeyMutationAuthority,
    target: AuthApiKeyTenantTarget,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireAdministratorIssuance();
    return this.issueInTransaction(operation, input, 'administrator', (actor) => {
      this.policy.requirePlatformAdministrator(actor, true);
      const binding = this.policy.requirePlatformTarget(target, true);
      return { userId: binding.membership!.userId, binding };
    });
  }

  rotateForPlatform(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
  ): IssuedAuthApiKey {
    this.policy.requireAdministratorIssuance();
    return this.rotateInTransaction(
      operation,
      keyId,
      input,
      'administrator',
      (actor, record) => {
        this.policy.requirePlatformAdministrator(actor, true);
        const binding = this.options.authority.bindingFromRecord(record, true);
        if (!binding || binding.scopeKind !== 'tenant') throw apiKeyNotFound();
        return { userId: record.userId, binding };
      },
    );
  }

  revokeForPlatform(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
  ): AuthApiKeySummary {
    return this.revokeInTransaction(operation, keyId, (actor, record) => {
      this.policy.requirePlatformAdministrator(actor, true);
      const binding = this.options.authority.bindingFromRecord(record, false);
      if (!binding || binding.scopeKind !== 'tenant') throw apiKeyNotFound();
      return binding;
    });
  }

  private issueInTransaction(
    operation: AuthApiKeyMutationAuthority,
    input: AuthApiKeyIssueInput,
    createdVia: AuthApiKeyCreatedVia,
    resolveTarget: (actor: AuthContext) => { userId: string; binding: AuthApiKeyBinding },
  ): IssuedAuthApiKey {
    this.policy.requireEnabled();
    const label = this.policy.normalizeLabel(input.label);
    const ttl = this.policy.resolveTTL(input.ttl);
    const credential = createAuthApiKeyCredential();
    return this.options.store.transaction(() => {
      this.options.assertCurrentProfile();
      const actor = this.policy.assertMutationActor(
        operation.auth,
        operation.assertCurrent,
      );
      const target = resolveTarget(actor);
      return this.persistIssue({
        actor,
        auditRequest: operation.auditRequest,
        target,
        input: { label, ttl },
        credential,
        createdVia,
      });
    });
  }

  private rotateInTransaction(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    input: AuthApiKeyIssueInput,
    createdVia: AuthApiKeyCreatedVia,
    resolveTarget: (
      actor: AuthContext,
      record: AuthApiKeyRecord,
    ) => { userId: string; binding: AuthApiKeyBinding },
  ): IssuedAuthApiKey {
    this.policy.requireEnabled();
    const label = this.policy.normalizeLabel(input.label);
    const ttl = this.policy.resolveTTL(input.ttl);
    const credential = createAuthApiKeyCredential();
    const now = this.options.now();
    return this.options.store.transaction(() => {
      this.options.assertCurrentProfile();
      const actor = this.policy.assertMutationActor(
        operation.auth,
        operation.assertCurrent,
      );
      const current = this.options.store.getById(keyId);
      if (!current || current.revokedAt !== null || current.expiresAt <= now) {
        throw apiKeyNotFound();
      }
      const target = resolveTarget(actor, current);
      if (!this.options.store.revoke(
        current.keyId,
        current.keyGeneration,
        actor.userId,
        now,
      )) throw apiKeyConflict();
      return this.persistIssue({
        actor,
        auditRequest: operation.auditRequest,
        target,
        input: { label, ttl },
        credential,
        createdVia,
        rotatedFromKeyId: current.keyId,
        now,
      });
    });
  }

  private revokeInTransaction(
    operation: AuthApiKeyMutationAuthority,
    keyId: string,
    authorize: (actor: AuthContext, record: AuthApiKeyRecord) => AuthApiKeyBinding,
  ): AuthApiKeySummary {
    this.policy.requireEnabled();
    const now = this.options.now();
    return this.options.store.transaction(() => {
      this.options.assertCurrentProfile();
      const actor = this.policy.assertMutationActor(
        operation.auth,
        operation.assertCurrent,
      );
      const current = this.options.store.getById(keyId);
      if (!current) throw apiKeyNotFound();
      const binding = authorize(actor, current);
      if (!this.options.store.revoke(
        current.keyId,
        current.keyGeneration,
        actor.userId,
        now,
      )) throw apiKeyConflict();
      const revoked = this.options.store.getById(current.keyId)!;
      this.options.audit.append({
        action: 'api-key.revoked',
        outcome: 'succeeded',
        scope: auditScope(binding),
        actor: authAuditActorFromContext(actor),
        request: operation.auditRequest,
        target: { type: 'api-key', id: revoked.keyId },
      });
      this.options.store.afterCommit(() => this.options.emitCode(
        OBS_CODES.AUTH_API_KEY_REVOKED,
        { metadata: { scopeKind: binding.scopeKind } },
      ));
      return this.directory.summarize(revoked, now);
    });
  }

  private persistIssue(input: {
    actor: AuthContext;
    auditRequest: AuthApiKeyMutationAuthority['auditRequest'];
    target: { userId: string; binding: AuthApiKeyBinding };
    input: { label: string; ttl: number };
    credential: ReturnType<typeof createAuthApiKeyCredential>;
    createdVia: AuthApiKeyCreatedVia;
    rotatedFromKeyId?: string;
    now?: number;
  }): IssuedAuthApiKey {
    const now = input.now ?? this.options.now();
    const expiresAt = resolveAuthApiKeyExpiry(now, input.input.ttl);
    if (expiresAt === null) {
      throw apiKeyValidation('API key expiry exceeds the supported timestamp range');
    }
    const user = this.options.authority.requireEligibleUser(
      input.target.userId,
      input.target.binding,
    );
    if (!user) throw apiKeySubjectIneligible();
    const authGeneration = this.options.users.getAuthGeneration(user.userId);
    if (this.options.store.countActiveForUserScope(
      user.userId,
      input.target.binding.scopeKind,
      input.target.binding.scopeId,
      authGeneration,
      now,
    ) >= this.options.config.maxActivePerUser) {
      throw apiKeyLimitReached();
    }
    const record = this.options.store.insert({
      keyId: input.credential.keyId,
      userId: user.userId,
      label: input.input.label,
      secretHash: input.credential.secretHash,
      secretHint: input.credential.secretHint,
      scopeKind: input.target.binding.scopeKind,
      scopeId: input.target.binding.scopeId,
      tenantId: input.target.binding.tenantId,
      membershipId: input.target.binding.membershipId,
      issuedAuthGeneration: authGeneration,
      createdByUserId: input.actor.userId,
      createdVia: input.createdVia,
      createdAt: now,
      expiresAt,
      rotatedFromKeyId: input.rotatedFromKeyId,
    });
    const rotated = Boolean(input.rotatedFromKeyId);
    this.options.audit.append({
      action: rotated ? 'api-key.rotated' : 'api-key.issued',
      outcome: 'succeeded',
      scope: auditScope(input.target.binding),
      actor: authAuditActorFromContext(input.actor),
      request: input.auditRequest,
      target: { type: 'api-key', id: record.keyId },
    });
    this.options.store.afterCommit(() => this.options.emitCode(
      rotated ? OBS_CODES.AUTH_API_KEY_ROTATED : OBS_CODES.AUTH_API_KEY_ISSUED,
      { metadata: { scopeKind: input.target.binding.scopeKind } },
    ));
    return Object.freeze({
      apiKey: this.directory.summarize(record, now),
      secret: input.credential.secret,
    });
  }

}

function sameBinding(
  record: AuthApiKeyRecord,
  userId: string,
  binding: AuthApiKeyBinding,
): boolean {
  return record.userId === userId
    && record.scopeKind === binding.scopeKind
    && record.scopeId === binding.scopeId;
}

function auditScope(binding: AuthApiKeyBinding): {
  kind: 'application' | 'tenant';
  tenantId?: string;
} {
  return binding.scopeKind === 'tenant'
    ? { kind: 'tenant', tenantId: binding.tenantId! }
    : { kind: 'application' };
}
