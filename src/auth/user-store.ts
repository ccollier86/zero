/**
 * user-store.ts
 *
 * Public persistence facade for auth users, user properties, tokens, password
 * credentials, registration provisioning, and auth config. Cohesive internal
 * stores own credential, token, and provisioning SQL/lifecycle details; this
 * facade coordinates them without making HTTP or request-token decisions.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthTenancyMode,
  RefreshTokenRecord,
  UserRecord,
  UserStatus,
} from './types';
import { AuthError } from './types';
import { AuthGenerationStore } from './auth-generation-store';
import { defineAuthSessionTables } from './auth-session-schema';
import { defineRegistrationProvisioningTable } from './registration-provisioning-schema';
import { defineAdminUserProvisioningTable } from './admin-user-provisioning-schema';
import {
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
  type AuthAuditService,
} from './auth-audit-service';
import { OBS_CODES } from '../observability/codes';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type {
  AppendAuthAuditEventInput,
  AuthAuditActor,
  AuthAuditRequestContext,
} from './auth-audit-types';
import {
  UserTokenStore,
  type AuthSessionRevoker,
  type RefreshTokenReplacement,
  type RefreshTokenRotationResult,
} from './user-token-store';
import {
  prepareRegistrationProvisioning,
  RegistrationProvisioningStore,
  type AuthAuthorizationBootstrapper,
  type RegistrationProvisioningReceipt,
  type RegistrationProvisioningResources,
} from './registration-provisioning-store';
import {
  AdminUserProvisioningStore,
  prepareAdminUserProvisioning,
  type AdminUserProvisioningReceipt,
} from './admin-user-provisioning-store';
import {
  UserCredentialStore,
  type AuthSecurityAuditContext,
  type PasswordAuthenticationProof,
  type PasswordChangeAuthenticationAdmission,
  type PasswordChangeAuthenticationReceipt,
} from './user-credential-store';
import {
  USER_IDENTITY_LIST_DEFAULT_LIMIT,
  USER_IDENTITY_LIST_MAX_LIMIT,
  UserIdentityStore,
} from './user-identity-store';
import { UserPropertyConfigStore } from './user-property-config-store';
import type { IdentityProjectionLifecycleHook } from './identity-projection-types';
import { UserStoreIdentityProjectionLifecycle } from './user-store-identity-projection-lifecycle';

export type {
  AuthSessionRevoker,
  RefreshTokenReplacement,
  RefreshTokenRotationResult,
} from './user-token-store';
export type {
  AuthAuthorizationBootstrapper,
  RegistrationProvisioningReceipt,
  RegistrationProvisioningResources,
} from './registration-provisioning-store';
export { REGISTRATION_PROVISIONING_LEASE_MS } from './registration-provisioning-store';
export type { AdminUserProvisioningReceipt } from './admin-user-provisioning-store';
export { ADMIN_USER_PROVISIONING_LEASE_MS } from './admin-user-provisioning-store';
export type {
  AuthSecurityAuditContext,
  PasswordAuthenticationProof,
  PasswordChangeAuthenticationAdmission,
  PasswordChangeAuthenticationReceipt,
} from './user-credential-store';

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: UserStatus;
  passwordChangeRequired?: boolean;
  emailVerifiedAt?: number | null;
  emailVerificationRequired?: boolean;
  mfaRequired?: boolean;
  properties?: Record<string, string>;
}

export interface AtomicRegistrationPolicy {
  role: 'admin' | 'user';
  requireEmailVerification: boolean;
  mfaRequired: boolean;
}

/**
 * Exact security generation committed by an identity ceremony.
 *
 * Session issuance must carry this receipt across every asynchronous boundary
 * instead of looking up whatever generation happens to be current later.
 */
export interface AuthGenerationReceipt {
  readonly user: UserRecord;
  readonly authGeneration: number;
}

const REGISTRATION_PROVISIONING_WAIT_MS = 30_000;

export interface UserStoreOptions {
  /** Defaults to single mode for direct/legacy store consumers. */
  tenancyMode?: AuthTenancyMode;
  /** Official AuthRuntime audit boundary; omitted by isolated legacy stores. */
  auditService?: AuthAuditService;
  /** App-bound runtime emitter for operator-visible invariant failures. */
  emitCode?: AuthPlatformCodeEmitter;
  /** Synchronous system-plane hook for durable ID-only anchor enqueue. */
  identityProjection?: Pick<IdentityProjectionLifecycleHook, 'userCreated'>
    & Partial<Pick<IdentityProjectionLifecycleHook, 'membershipCreated'>>;
}

interface PreparedUserCreate {
  params: CreateUserInput;
  email: string;
  userId: string;
  now: number;
  passwordHash: string;
}

/** Detach every caller-owned identity field before password hashing yields. */
function captureCreateUserInput(input: CreateUserInput): CreateUserInput {
  const properties = input.properties;
  return Object.freeze({
    username: input.username,
    email: input.email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    status: input.status,
    passwordChangeRequired: input.passwordChangeRequired,
    emailVerifiedAt: input.emailVerifiedAt,
    emailVerificationRequired: input.emailVerificationRequired,
    mfaRequired: input.mfaRequired,
    ...(properties === undefined
      ? {}
      : { properties: Object.freeze({ ...properties }) }),
  });
}

/** Filter and pagination options for admin user listing. */
export interface UserListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: UserStatus;
}

export const USER_LIST_DEFAULT_LIMIT = USER_IDENTITY_LIST_DEFAULT_LIMIT;
export const USER_LIST_MAX_LIMIT = USER_IDENTITY_LIST_MAX_LIMIT;

// ─── UserStore ─────────────────────────────────────────────────────────────

/**
 * Stable application-facing facade for SQLite-backed auth data.
 *
 * Three storage write patterns:
 * - Private users table → through ReactiveDB for consistent change tracking
 * - User properties table → direct SQL because it has a composite primary key
 * - Internal auth tables → cohesive private stores or direct config statements
 *
 * All statements prepared once in constructor, reused per call.
 */
export class UserStore {
  private userProfilePolicyGuard: (() => void) | null = null;
  private profileCompletionEnrollment: ((userId: string, origin: 'signup' | 'invitation') => void) | null = null;
  private authorizationBootstrapper: AuthAuthorizationBootstrapper | null = null;
  private readonly authGenerations: AuthGenerationStore;
  private readonly identity: UserIdentityStore;
  private readonly propertyConfig: UserPropertyConfigStore;
  private readonly tokenStore: UserTokenStore;
  private readonly credentials: UserCredentialStore;
  private readonly registrationProvisioning: RegistrationProvisioningStore;
  private readonly adminUserProvisioning: AdminUserProvisioningStore;
  private authSessionRevoker: AuthSessionRevoker | null = null;
  private runtimeProfileGuard: (() => void) | null = null;
  private readonly tenancyMode: AuthTenancyMode;
  private readonly auditService: AuthAuditService | null;
  private readonly emitCode: AuthPlatformCodeEmitter | null;
  private readonly identityProjection: UserStoreIdentityProjectionLifecycle;

  constructor(private db: ReactiveDB, options: UserStoreOptions = {}) {
    this.tenancyMode = options.tenancyMode ?? 'single';
    this.auditService = options.auditService ?? null;
    this.emitCode = options.emitCode ?? null;
    this.identityProjection = new UserStoreIdentityProjectionLifecycle(db, {
      tenancyMode: this.tenancyMode,
      hook: options.identityProjection,
      emitCode: this.emitCode ?? undefined,
    });
    // Direct UserStore consumers may define legacy refresh tables themselves.
    // Ensure additive private lifecycle tables exist before preparing SQL.
    defineAuthSessionTables(db);
    defineRegistrationProvisioningTable(db);
    defineAdminUserProvisioningTable(db);
    this.authGenerations = new AuthGenerationStore(db);
    this.propertyConfig = new UserPropertyConfigStore(db, {
      mutation: (operation) => this.mutation(operation),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
    });
    this.identity = new UserIdentityStore(db, this.propertyConfig, {
      tenancyMode: this.tenancyMode,
      mutation: (operation) => this.mutation(operation),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      getUserById: (userId) => this.getUserById(userId),
      getUserByUsername: (username) => this.getUserByUsername(username),
    });
    this.tokenStore = new UserTokenStore(db, this.authGenerations, {
      mutation: (operation) => this.mutation(operation),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      getUserById: (userId) => this.getUserById(userId),
      getSessionRevoker: () => this.authSessionRevoker,
      emitCode: this.emitCode ?? undefined,
    });
    this.credentials = new UserCredentialStore(db, {
      mutation: (operation) => this.mutation(operation),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      identityExists: (userId) => this.getUserById(userId) !== null,
      setPasswordChangeRequired: (userId, required) => (
        this.updateUser(userId, { passwordChangeRequired: required }) !== null
      ),
      revokeAllUserTokens: (userId) => this.revokeAllUserTokens(userId),
      getAuthGeneration: (userId) => this.getAuthGeneration(userId),
      recordSecurityAudit: (action, userId, context, fallbackActor) => {
        this.recordSecurityAudit(action, userId, context, fallbackActor);
      },
      invariant: (component, invariant, message) => (
        this.invariant(component, invariant, message)
      ),
    });
    this.registrationProvisioning = new RegistrationProvisioningStore(db, {
      mutation: (operation) => this.mutation(operation),
      afterCommit: (callback) => this.afterCommit(callback),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      getConfig: (key) => this.getConfig(key),
      setConfig: (key, value) => this.setConfig(key, value),
      countUsers: () => this.countUsers(),
      getUserById: (userId) => this.getUserById(userId),
      getAuthorizationBootstrapper: () => this.authorizationBootstrapper,
      activateIdentityProjection: (userId) => (
        this.identityProjection.activateFinalizedUser(userId)
      ),
      auditService: this.auditService,
      emitCode: this.emitCode ?? undefined,
    });
    this.adminUserProvisioning = new AdminUserProvisioningStore(db, {
      mutation: (operation) => this.mutation(operation),
      afterCommit: (callback) => this.afterCommit(callback),
      assertCurrentProfile: () => this.assertRuntimeProfileCurrent(),
      getUserById: (userId) => this.getUserById(userId),
      getAuthGeneration: (userId) => this.getAuthGeneration(userId),
      activateIdentityProjection: (userId) => (
        this.identityProjection.activateFinalizedUser(userId)
      ),
      auditService: this.auditService,
      emitCode: this.emitCode ?? undefined,
    });

  }

  /** Attach this app's durable parent-session invalidation boundary. */
  setAuthSessionRevoker(revoker: AuthSessionRevoker): void {
    this.authSessionRevoker = revoker;
  }

  /** Attach the app-local advanced authorization bootstrap boundary. */
  setAuthorizationBootstrapper(bootstrapper: AuthAuthorizationBootstrapper): void {
    this.authorizationBootstrapper = bootstrapper;
  }

  /** Fence in-flight identity/session writes against a committed profile change. */
  setRuntimeProfileGuard(guard: () => void): void {
    this.runtimeProfileGuard = guard;
  }

  /** Internal configured first-use enrollment, captured inside the original identity writer transaction. */
  setProfileCompletionEnrollment(callback: (userId: string, origin: 'signup' | 'invitation') => void): void {
    this.profileCompletionEnrollment = callback;
  }
  enrollProfileCompletion(userId: string, origin: 'signup' | 'invitation'): void {
    if (this.profileCompletionEnrollment) invokeSynchronousAuthCallback(() => this.profileCompletionEnrollment!(userId, origin), {
      component: 'user-store', invariant: 'profile-completion-enrollment-async',
      message: '[auth] Profile completion enrollment must be synchronous.', emitCode: this.emitCode ?? undefined });
  }

  /** Recheck the exact committed profile for cached/direct store consumers. */
  assertCurrentProfile(): void {
    this.assertRuntimeProfileCurrent();
  }

  /** Bootstrap-owned optional profile policy. Unrelated identity/session operations do not call this guard. */
  setUserProfilePolicyGuard(guard: () => void): void {
    this.userProfilePolicyGuard = guard;
  }
  assertCurrentUserProfilePolicy(): void {
    this.assertRuntimeProfileCurrent();
    if (this.userProfilePolicyGuard) invokeSynchronousAuthCallback(this.userProfilePolicyGuard, {
      component: 'user-store', invariant: 'user-profile-policy-guard-async',
      message: '[auth] User profile policy admission must be synchronous.', emitCode: this.emitCode ?? undefined });
  }

  /** Share this store's SQLite transaction with a coordinating auth service. */
  transaction<T>(operation: () => T): T {
    return this.mutation(operation);
  }

  /** Opaque identity for services that must share this exact transaction domain. */
  getTransactionDomain(): object {
    return this.db.getTransactionDomain();
  }

  /** Publish a best-effort notification only after the outer transaction commits. */
  afterCommit(callback: () => unknown): void {
    this.db.afterCommit(callback);
  }

  /** Append through the app-local audit owner, inheriting any active transaction. */
  appendControlPlaneAudit(input: AppendAuthAuditEventInput): void {
    this.mutation(() => this.auditService?.append(input));
  }

  // ─── User CRUD ───────────────────────────────────────────────────────

  /**
   * Canonical alias for createUser().
   *
   * Use this from app-owned backend code when `zero.auth.store` already makes
   * the user domain obvious.
   */
  async create(params: Parameters<UserStore['createUser']>[0]): Promise<UserRecord> {
    return this.createUser(params);
  }

  /**
   * Create a new user with hashed password.
   * Writes the user row through ReactiveDB change tracking and the credential
   * through server-only SQL. Client delivery remains a separate Sync-policy
   * decision and is denied by default createApp policy.
   * Atomic — if credential insert fails, user row is rolled back.
   */
  async createUser(
    params: CreateUserInput,
    provisioning?: AuthSecurityAuditContext & { setupRequested?: boolean },
    beforeInsert?: () => void,
  ): Promise<UserRecord> {
    const capturedProvisioning = provisioning
      ? Object.freeze({
        actor: captureAuthAuditActor(provisioning.actor)!,
        request: captureAuthAuditRequestContext(provisioning.request),
        setupRequested: provisioning.setupRequested === true,
      })
      : undefined;
    const prepared = await this.prepareUserCreate(params);
    return this.mutation(() => {
      this.registrationProvisioning.lockWrites();
      if (beforeInsert) {
        invokeSynchronousAuthCallback(beforeInsert, {
          component: 'user-store',
          invariant: 'user-create-before-insert-async',
          message: '[auth] User creation beforeInsert must be synchronous.',
          emitCode: this.emitCode ?? undefined,
        });
      }
      this.registrationProvisioning.assertNoPendingBootstrap();
      const establishesInstallation = this.isBootstrapRequired();
      if (establishesInstallation && this.tenancyMode === 'multi') {
        throw multiTenantBootstrapOrganizationRequired();
      }
      const user = this.insertPreparedUser(prepared);
      if (establishesInstallation) {
        this.establishBootstrapOwner(user.userId);
        this.registrationProvisioning.markBootstrapCompleted();
        this.registrationProvisioning.recordAudit(user.userId, null, true);
      }
      if (capturedProvisioning) {
        this.auditService?.append({
          action: 'identity.provisioned-by-admin',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: capturedProvisioning.actor,
          request: capturedProvisioning.request,
          target: { type: 'user', id: user.userId },
          metadata: { 'setup-requested': capturedProvisioning.setupRequested },
        });
      }
      return user;
    });
  }

  /**
   * Create an administrator-managed identity with a durable provisional
   * receipt. The caller must finalize after setup delivery or roll back using
   * the exact receipt; recovery can safely finish an abandoned lease.
   */
  async createAdminProvisionedUser(
    params: CreateUserInput,
    provisioning: AuthSecurityAuditContext & { setupRequested?: boolean },
    beforeInsert: () => void,
  ): Promise<{
    user: UserRecord;
    provisioning: AdminUserProvisioningReceipt;
  }> {
    const capturedProvisioning = Object.freeze({
      actor: captureAuthAuditActor(provisioning.actor)!,
      request: captureAuthAuditRequestContext(provisioning.request),
      setupRequested: provisioning.setupRequested === true,
    });
    const prepared = await this.prepareUserCreate(params);
    const provisional = prepareAdminUserProvisioning();
    return this.mutation(() => {
      this.registrationProvisioning.lockWrites();
      invokeSynchronousAuthCallback(beforeInsert, {
        component: 'user-store',
        invariant: 'admin-user-create-before-insert-async',
        message: '[auth] Administrator user creation authority must be synchronous.',
        emitCode: this.emitCode ?? undefined,
      });
      this.registrationProvisioning.assertNoPendingBootstrap();
      if (this.isBootstrapRequired()) {
        throw new AuthError(
          'Application bootstrap must be completed before administrator provisioning',
          'AUTH_NOT_READY',
          503,
        );
      }
      const user = this.insertPreparedUser(prepared, true, 'invitation');
      const authGeneration = this.getAuthGeneration(user.userId);
      const receipt = this.adminUserProvisioning.insert({
        ...provisional,
        user,
        authGeneration,
        createdAt: Date.now(),
      });
      this.auditService?.append({
        action: 'identity.provisioned-by-admin',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: capturedProvisioning.actor,
        request: capturedProvisioning.request,
        target: { type: 'user', id: user.userId },
        metadata: { 'setup-requested': capturedProvisioning.setupRequested },
      });
      return {
        user,
        provisioning: receipt,
      };
    });
  }

  /**
   * Create a self-registered user after resolving bootstrap policy atomically.
   * The lock write is the first statement in the transaction, so every
   * registration observes users committed by the preceding registration.
   */
  async createRegistrationUser<TPolicy extends AtomicRegistrationPolicy>(
    params: Omit<CreateUserInput,
      'role' | 'emailVerifiedAt' | 'emailVerificationRequired' | 'mfaRequired'>,
    resolvePolicy: (isBootstrap: boolean) => TPolicy,
    afterInsert?: (
      user: UserRecord,
      policy: TPolicy,
    ) => RegistrationProvisioningResources | void,
    options: {
      provisional?: boolean;
      auditRequest?: AuthAuditRequestContext;
    } = {},
  ): Promise<{
    user: UserRecord;
    authGeneration: number;
    policy: TPolicy;
    provisioning: RegistrationProvisioningReceipt | null;
  }> {
    const provisionalRequested = options.provisional === true;
    const auditRequest = captureAuthAuditRequestContext(options.auditRequest);
    const prepared = await this.prepareUserCreate(params);
    const provisional = provisionalRequested
      ? prepareRegistrationProvisioning()
      : null;
    const registrationId = provisional?.registrationId ?? null;
    const waitDeadline = Date.now() + REGISTRATION_PROVISIONING_WAIT_MS;
    while (true) {
      try {
        return this.mutation(() => {
          this.registrationProvisioning.lockWrites();
          this.registrationProvisioning.assertNoPendingBootstrap();
          const isBootstrap = this.isBootstrapRequired();
          const policy = invokeSynchronousAuthCallback(
            () => resolvePolicy(isBootstrap),
            {
              component: 'user-store',
              invariant: 'registration-policy-resolver-async',
              message: '[auth] Registration policy resolution must be synchronous.',
              emitCode: this.emitCode ?? undefined,
            },
          );
          const user = this.insertPreparedUser({
            ...prepared,
            params: {
              ...prepared.params,
              role: policy.role,
              emailVerifiedAt: policy.requireEmailVerification ? null : Date.now(),
              emailVerificationRequired: policy.requireEmailVerification,
              mfaRequired: policy.mfaRequired,
            },
          }, provisional !== null);
          if (provisional) {
            const createdAt = Date.now();
            const authGeneration = this.getAuthGeneration(user.userId);
            this.registrationProvisioning.insert({
              ...provisional,
              userId: user.userId,
              isBootstrap,
              createdAt,
            });
          }
          const resources = afterInsert
            ? invokeSynchronousAuthCallback(
              () => afterInsert(user, policy),
              {
                component: 'user-store',
                invariant: 'registration-after-insert-async',
                message: '[auth] Registration afterInsert must be synchronous.',
                emitCode: this.emitCode ?? undefined,
              },
            )
            : undefined;
          const tenantId = resources?.tenantId ?? null;
          if (isBootstrap && this.tenancyMode === 'multi' && !tenantId) {
            throw multiTenantBootstrapOrganizationRequired();
          }
          if (tenantId) {
            if (!registrationId) {
              throw this.invariant(
                'registration-provisioning',
                'tenant-binding-missing',
                '[auth] Failed to bind registration provisioning to its tenant.',
              );
            }
            this.registrationProvisioning.bindTenant(tenantId, registrationId, user.userId);
          }
          if (isBootstrap) {
            this.establishBootstrapOwner(
              user.userId,
              registrationId ?? undefined,
            );
            if (!registrationId) this.registrationProvisioning.markBootstrapCompleted();
          }
          if (!registrationId) {
            this.registrationProvisioning.recordAudit(
              user.userId,
              tenantId,
              isBootstrap,
              auditRequest,
            );
          }
          return {
            user,
            authGeneration: this.getAuthGeneration(user.userId),
            policy,
            provisioning: registrationId ? Object.freeze({
              registrationId,
              userId: user.userId,
              tenantId,
              isBootstrap,
              leaseToken: provisional!.leaseToken,
            }) : null,
          };
        });
      } catch (error) {
        if (!(error instanceof AuthError)
          || error.code !== 'BOOTSTRAP_PROVISIONING_IN_PROGRESS') throw error;
        // A process which died while holding bootstrap cannot strand the
        // installation forever. Only an expired/unowned receipt is recovered;
        // a live lease owned by another process remains authoritative.
        if (this.recoverPendingRegistrationProvisioning() > 0) continue;
        if (Date.now() >= waitDeadline) throw error;
        // The durable marker coordinates other processes; this short async
        // wait lets the winning request finalize or roll back without holding
        // a SQLite transaction across external token/email work.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  private establishBootstrapOwner(userId: string, registrationId?: string): void {
    const bootstrapper = this.authorizationBootstrapper;
    if (!bootstrapper) return;
    invokeSynchronousAuthCallback(
      () => bootstrapper.establishBootstrapOwner(userId, registrationId),
      {
        component: 'user-store',
        invariant: 'authorization-bootstrapper-async',
        message: '[auth] Authorization bootstrap owner callback must be synchronous.',
        emitCode: this.emitCode ?? undefined,
      },
    );
  }

  /** Whether the installation still permits its one bootstrap administrator. */
  isBootstrapRequired(): boolean {
    return this.registrationProvisioning.isBootstrapRequired();
  }

  /** Internal proof that this identity belongs to one unfinished registration. */
  hasPendingRegistrationProvisioning(userId: string): boolean {
    return this.registrationProvisioning.hasPendingForUser(userId);
  }

  /** Close bootstrap for legacy databases which already contain users. */
  reconcileBootstrapState(): void {
    this.registrationProvisioning.reconcileBootstrapState();
  }

  renewRegistrationProvisioningLease(
    receipt: RegistrationProvisioningReceipt,
  ): number {
    return this.registrationProvisioning.renewLease(receipt);
  }

  finalizeRegistrationProvisioning(
    receipt: RegistrationProvisioningReceipt,
    auditRequest?: AuthAuditRequestContext,
  ): void {
    this.registrationProvisioning.finalize(receipt, auditRequest);
  }

  rollbackRegistrationProvisioning(
    receipt: RegistrationProvisioningReceipt,
  ): boolean {
    return this.registrationProvisioning.rollback(receipt);
  }

  /** Renew an administrator-created account receipt before external delivery. */
  renewAdminUserProvisioningLease(receipt: AdminUserProvisioningReceipt): number {
    return this.adminUserProvisioning.renewLease(receipt);
  }

  /** Bind the exact setup token in the token-creation transaction. */
  bindAdminUserProvisioningSetupToken(
    receipt: AdminUserProvisioningReceipt,
    setupTokenId: string,
  ): void {
    this.adminUserProvisioning.bindSetupToken(receipt, setupTokenId);
  }

  /** Fence the final setup commit against changes to the provisional account. */
  assertAdminUserProvisioningCommitReady(
    receipt: AdminUserProvisioningReceipt,
  ): void {
    this.adminUserProvisioning.assertCommitReady(receipt);
  }

  /** Close a successful administrator-created setup receipt. */
  finalizeAdminUserProvisioning(receipt: AdminUserProvisioningReceipt): void {
    this.adminUserProvisioning.finalize(receipt);
  }

  /** Delete only the exact untouched administrator-created identity graph. */
  rollbackAdminUserProvisioning(receipt: AdminUserProvisioningReceipt): boolean {
    return this.adminUserProvisioning.rollback(receipt);
  }

  recoverPendingRegistrationProvisioning(): number {
    return this.registrationProvisioning.recoverPending();
  }

  recoverPendingAdminUserProvisioning(): number {
    return this.adminUserProvisioning.recoverPending();
  }

  private async prepareUserCreate(params: CreateUserInput): Promise<PreparedUserCreate> {
    const captured = captureCreateUserInput(params);
    const email = this.identity.requireCanonicalEmail(captured.email);
    this.identity.assertNewIdentityAvailable(captured.username, email);
    return {
      params: captured,
      email,
      userId: `u_${crypto.randomUUID()}`,
      now: Date.now(),
      passwordHash: await this.credentials.hashPassword(captured.password),
    };
  }

  private insertPreparedUser(
    prepared: PreparedUserCreate,
    deferIdentityProjection = false,
    completionOrigin: 'signup' | 'invitation' = 'signup',
  ): UserRecord {
    const { params, email, userId, now, passwordHash } = prepared;
    // Password hashing yields. Recheck inside the write transaction so a
    // concurrent identity cannot be replaced by ReactiveDB's upsert primitive.
    this.identity.insertRowInCurrentTransaction({
      userId,
      now,
      user: { ...params, email },
    });
    this.credentials.insertCredential(userId, passwordHash);
    this.propertyConfig.insertPropertiesInCurrentTransaction(
      userId,
      params.properties ?? {},
    );
    this.enrollProfileCompletion(userId, completionOrigin);
    if (!deferIdentityProjection) this.identityProjection.userCreated(userId);
    return this.identity.getByIdInCurrentProfile(userId)!;
  }

  /**
   * Get user by ID. Returns null if not found.
   */
  getUserById(userId: string): UserRecord | null {
    return this.identity.getById(userId);
  }

  /** Canonical alias for getUserById(). */
  get(userId: string): UserRecord | null {
    return this.getUserById(userId);
  }

  /**
   * Get user by username. Returns null if not found.
   */
  getUserByUsername(username: string): UserRecord | null {
    return this.identity.getByUsername(username);
  }

  /**
   * Get user by email. Returns null if not found.
   */
  getUserByEmail(email: string): UserRecord | null {
    return this.identity.getByEmail(email);
  }

  /**
   * List users for admin screens.
   *
   * When options are omitted this preserves the historical all-users response.
   * Filtered calls use parameterized SQL and capped pagination.
   */
  listUsers(options: UserListOptions = {}): UserRecord[] {
    return this.identity.list(options);
  }

  /** Canonical alias for listUsers(). */
  list(options: UserListOptions = {}): UserRecord[] {
    return this.listUsers(options);
  }

  /**
   * Count user rows, optionally matching the same filters as listUsers().
   */
  countUsers(options: Omit<UserListOptions, 'limit' | 'offset'> = {}): number {
    return this.identity.count(options);
  }

  /**
   * Count users by role.
   */
  countUsersByRole(role: string): number {
    return this.identity.countByRole(role);
  }

  /** Count administrators that can currently complete a normal sign-in. */
  countActiveAdmins(): number {
    return this.identity.countActiveAdmins();
  }

  /**
   * Update user fields through ReactiveDB change tracking. Client delivery, if
   * any, is decided separately by the composed Sync policy.
   * Returns updated UserRecord or null if user not found.
   */
  updateUser(
    userId: string,
    partial: Partial<{
      username: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      status: UserStatus;
      passwordChangeRequired: boolean;
      emailVerifiedAt: number | null;
      emailVerificationRequired: boolean;
      mfaRequired: boolean;
    }>
  ): UserRecord | null {
    return this.identity.update(userId, partial);
  }

  /** Canonical alias for updateUser(). */
  update(
    userId: string,
    partial: Parameters<UserStore['updateUser']>[1]
  ): UserRecord | null {
    return this.updateUser(userId, partial);
  }

  /**
   * Delete a user. Cascades identity-owned private auth state. In multi-tenant
   * mode, durable organization history is retained and blocks hard deletion;
   * callers should suspend that identity instead.
   * Returns true if deleted, false if not found.
   */
  deleteUser(userId: string): boolean {
    return this.identity.delete(userId);
  }

  /** Canonical alias for deleteUser(). */
  delete(userId: string): boolean {
    return this.deleteUser(userId);
  }

  // ─── Password ────────────────────────────────────────────────────────

  /**
   * Verify a password against the stored hash.
   * Returns false if user not found or password wrong.
   */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    return this.credentials.verifyPassword(userId, password);
  }

  /** Bind successful password verification to its exact security generation. */
  verifyPasswordForAuthentication(
    userId: string,
    password: string,
  ): Promise<PasswordAuthenticationProof | null> {
    return this.credentials.verifyPasswordForAuthentication(userId, password);
  }

  /**
   * Change password. Verifies current password, hashes new one, revokes all refresh tokens.
   * Returns true if changed, false if current password wrong.
   */
  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    return this.credentials.updatePassword(
      userId,
      currentPassword,
      newPassword,
      auditContext,
    );
  }

  /** Change a password and bind replacement-session issuance to that commit. */
  updatePasswordForAuthentication(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
    admission?: PasswordChangeAuthenticationAdmission,
  ): Promise<PasswordChangeAuthenticationReceipt | null> {
    return this.credentials.updatePasswordForAuthentication(
      userId,
      currentPassword,
      newPassword,
      auditContext,
      admission,
    );
  }

  /**
   * Set a user's password without requiring the current password.
   *
   * Intended for admin reset flows. Revokes all refresh tokens so existing
   * sessions cannot continue with the old credential state.
   */
  async resetPassword(
    userId: string,
    newPassword: string,
    options: {
      passwordChangeRequired?: boolean;
      audit?: AuthSecurityAuditContext;
      beforeCommit?: () => void;
    } = {},
  ): Promise<boolean> {
    return this.credentials.resetPassword(userId, newPassword, options);
  }

  /**
   * Commit a one-time password action and credential replacement atomically.
   *
   * Password hashing completes before the transaction begins. The supplied
   * token consumer then shares the same SQLite transaction as the credential,
   * eligibility, and session-generation writes, so a storage failure cannot
   * burn an otherwise reusable recovery link.
   */
  async completePasswordAction(
    userId: string,
    newPassword: string,
    consumeActionToken: () => void,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    return this.credentials.completePasswordAction(
      userId,
      newPassword,
      consumeActionToken,
      auditContext,
    );
  }

  /**
   * Mark an account as requiring a password change and revoke refresh tokens.
   */
  requirePasswordChange(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.credentials.requirePasswordChange(userId, auditContext);
  }

  /**
   * Clear the forced password-change flag and invalidate every prior token.
   */
  clearPasswordChangeRequired(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.credentials.clearPasswordChangeRequired(userId, auditContext);
  }

  private recordSecurityAudit(
    action: string,
    userId: string,
    context?: AuthSecurityAuditContext,
    fallbackActor: AuthAuditActor = { provenance: 'system' },
  ): void {
    this.auditService?.append({
      action,
      outcome: 'succeeded',
      scope: { kind: 'application' },
      actor: context?.actor ?? fallbackActor,
      request: context?.request,
      target: { type: 'user', id: userId },
    });
  }

  /**
   * Mark a user's email verified and clear the verification gate.
   */
  markEmailVerified(userId: string, verifiedAt = Date.now()): UserRecord | null {
    return this.updateUser(userId, {
      emailVerifiedAt: verifiedAt,
      emailVerificationRequired: false,
    });
  }

  /** Atomically verify an address and consume the one-time verification link. */
  completeEmailVerification(
    userId: string,
    consumeActionToken: () => void,
    verifiedAt = Date.now(),
    afterVerify?: (user: UserRecord, verifiedAt: number) => void,
    auditContext?: AuthSecurityAuditContext,
  ): UserRecord | null {
    return this.completeEmailVerificationForAuthentication(
      userId,
      consumeActionToken,
      verifiedAt,
      afterVerify,
      auditContext,
    )?.user ?? null;
  }

  /**
   * Atomically verify an address and return the exact post-revocation security
   * generation authorized to continue into MFA or parent-session issuance.
   */
  completeEmailVerificationForAuthentication(
    userId: string,
    consumeActionToken: () => void,
    verifiedAt = Date.now(),
    afterVerify?: (user: UserRecord, verifiedAt: number) => void,
    auditContext?: AuthSecurityAuditContext,
  ): AuthGenerationReceipt | null {
    return this.mutation(() => {
      const current = this.getUserById(userId);
      if (!current) return null;
      if (!current.emailVerificationRequired || current.emailVerifiedAt !== null) {
        throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
      }
      invokeSynchronousAuthCallback(consumeActionToken, {
        component: 'user-store',
        invariant: 'email-verification-token-consumer-async',
        message: '[auth] Email verification token consumption must be synchronous.',
        emitCode: this.emitCode ?? undefined,
      });
      const user = this.markEmailVerified(userId, verifiedAt);
      if (!user) return null;
      if (afterVerify) {
        invokeSynchronousAuthCallback(() => afterVerify(user, verifiedAt), {
          component: 'user-store',
          invariant: 'email-verification-after-verify-async',
          message: '[auth] Email verification afterVerify must be synchronous.',
          emitCode: this.emitCode ?? undefined,
        });
      }
      // Verification links complete authentication, so invalidate every
      // sibling link and pre-verification session before issuing a new one.
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.email-verified',
        userId,
        auditContext,
        { userId, provenance: 'registration' },
      );
      return Object.freeze({
        user,
        authGeneration: this.getAuthGeneration(userId),
      });
    });
  }

  /** Current primary-email generation. Migration 017 initializes existing rows at 1. */
  getEmailGeneration(userId: string): number {
    return this.identity.getEmailGeneration(userId);
  }

  /** Record explicit email-link provenance; administrative verification never calls this. */
  recordEmailLinkMailboxProof(input: {
    proofId?: string;
    applicationId: string;
    userId: string;
    email: string;
    emailGeneration: number;
    provedAt: number;
    expiresAt: number;
  }): string | null {
    return this.identity.recordEmailLinkMailboxProof(input);
  }

  // ─── Properties KV ───────────────────────────────────────────────────

  /**
   * Set a user property. INSERT OR REPLACE semantics.
   * Uses prepared statement (composite PK — not managed by ReactiveDB defineTable).
   */
  setProperty(userId: string, key: string, value: string): void {
    this.propertyConfig.setProperty(userId, key, value);
  }

  /**
   * Set multiple user properties.
   */
  setProperties(userId: string, properties: Record<string, string>): void {
    this.propertyConfig.setProperties(userId, properties);
  }

  /**
   * Get a single property value. Returns null if not found.
   */
  getProperty(userId: string, key: string): string | null {
    return this.propertyConfig.getProperty(userId, key);
  }

  /**
   * Get all properties for a user as a key-value map.
   */
  getProperties(userId: string): Record<string, string> {
    return this.propertyConfig.getProperties(userId);
  }

  /**
   * Delete a single property. Uses prepared statement (composite PK).
   */
  deleteProperty(userId: string, key: string): void {
    this.propertyConfig.deleteProperty(userId, key);
  }

  // ─── Refresh Tokens ──────────────────────────────────────────────────

  /** Atomically consume a live refresh token and persist its replacement. */
  rotateRefreshTokenAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    expectedAuthGeneration: number,
    now = Date.now()
  ): RefreshTokenRotationResult {
    return this.tokenStore.rotateRefreshTokenAtomically(
      current,
      replacement,
      expectedAuthGeneration,
      now,
    );
  }

  /**
   * Consume a live refresh credential while atomically replacing its durable
   * parent. `replaceParent` runs inside this same transaction before the new
   * refresh row is inserted, preserving its foreign-key boundary.
   */
  replaceRefreshSessionAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    replacementSessionId: string,
    expectedAuthGeneration: number,
    replaceParent: () => boolean,
    now = Date.now(),
  ): RefreshTokenRotationResult {
    return this.tokenStore.replaceRefreshSessionAtomically(
      current,
      replacement,
      replacementSessionId,
      expectedAuthGeneration,
      replaceParent,
      now,
    );
  }

  /** Apply family invalidation when a presented refresh token was already used. */
  invalidateRefreshTokenReplay(userId: string, now = Date.now()): void {
    this.tokenStore.invalidateRefreshTokenReplay(userId, now);
  }

  /** Store a hashed refresh token. Internal table — no broadcast. */
  storeRefreshToken(
    tokenId: string,
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): void {
    this.tokenStore.storeRefreshToken(tokenId, userId, tokenHash, expiresAt);
  }

  /** Insert a refresh session only while its signed user state is still current. */
  storeRefreshTokenIfCurrent(
    tokenId: string,
    user: Pick<UserRecord, 'userId' | 'email' | 'role'>,
    tokenHash: string,
    expiresAt: number,
    createdAt: number,
    expectedAuthGeneration: number,
    sessionId: string | null = null,
  ): boolean {
    return this.tokenStore.storeRefreshTokenIfCurrent(
      tokenId,
      user,
      tokenHash,
      expiresAt,
      createdAt,
      expectedAuthGeneration,
      sessionId,
    );
  }

  /**
   * Look up a refresh token by its server-generated session id.
   * Returns revoked and expired records so the caller can fail closed using
   * the same lifecycle rules as refresh-token rotation.
   */
  getRefreshTokenById(tokenId: string): RefreshTokenRecord | null {
    return this.tokenStore.getRefreshTokenById(tokenId);
  }

  /**
   * Look up a refresh token by its hash.
   * Returns the record EVEN IF REVOKED — caller handles revocation logic.
   * This is deliberate for replay detection.
   */
  getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    return this.tokenStore.getRefreshTokenByHash(tokenHash);
  }

  /**
   * Revoke a single refresh token (set revoked_at).
   */
  revokeRefreshToken(tokenId: string): void {
    this.tokenStore.revokeRefreshToken(tokenId);
  }

  /**
   * Revoke ALL non-revoked refresh tokens for a user (family rotation / password change).
   */
  revokeAllUserTokens(userId: string): void {
    this.tokenStore.revokeAllUserTokens(userId);
  }

  /** Return the security generation embedded in newly issued auth tokens. */
  getAuthGeneration(userId: string): number {
    return this.tokenStore.getAuthGeneration(userId);
  }

  /**
   * Delete expired and revoked tokens. Cleanup operation.
   * Returns number of deleted rows.
   */
  deleteExpiredTokens(): number {
    return this.tokenStore.deleteExpiredTokens();
  }

  // ─── Action Tokens ─────────────────────────────────────────────────

  /**
   * Store a hashed one-time auth action token.
   */
  storeActionToken(params: {
    tokenId: string;
    userId: string;
    type: AuthActionTokenType;
    tokenHash: string;
    expiresAt: number;
    createdAt: number;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  }): AuthActionTokenRecord {
    return this.tokenStore.storeActionToken(params);
  }

  /**
   * Look up a one-time auth action token by hash.
   */
  getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null {
    return this.tokenStore.getActionTokenByHash(tokenHash);
  }

  /**
   * Mark an action token consumed. Returns false if it was already consumed.
   */
  consumeActionToken(tokenId: string): boolean {
    return this.tokenStore.consumeActionToken(tokenId);
  }

  /** Delete an action token that failed before delivery completed. */
  deleteActionToken(tokenId: string): boolean {
    return this.tokenStore.deleteActionToken(tokenId);
  }

  /**
   * Count active action tokens created after a cutoff for cooldown checks.
   */
  countRecentActionTokens(params: {
    userId: string;
    type: AuthActionTokenType;
    createdAfter: number;
    now?: number;
  }): number {
    return this.tokenStore.countRecentActionTokens(params);
  }

  /**
   * Delete expired and consumed action tokens. Cleanup operation.
   */
  deleteExpiredActionTokens(): number {
    return this.tokenStore.deleteExpiredActionTokens();
  }

  // ─── Auth Config ─────────────────────────────────────────────────────

  /**
   * Get a config value from _auth_config. Returns null if not found.
   */
  getConfig(key: string): string | null {
    return this.propertyConfig.getConfig(key);
  }

  /**
   * Set a config value in _auth_config. INSERT OR REPLACE.
   */
  setConfig(key: string, value: string): void {
    this.propertyConfig.setConfig(key, value);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────

  private mutation<T>(operation: () => T): T {
    return this.db.transaction(() => {
      this.assertRuntimeProfileCurrent();
      return operation();
    });
  }

  private assertRuntimeProfileCurrent(): void {
    if (!this.runtimeProfileGuard) return;
    invokeSynchronousAuthCallback(this.runtimeProfileGuard, {
      component: 'user-store',
      invariant: 'runtime-profile-guard-async',
      message: '[auth] User runtime profile guard must be synchronous.',
      emitCode: this.emitCode ?? undefined,
    });
  }

  private invariant(component: string, invariant: string, message: string): AuthError {
    this.emitCode?.(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      metadata: { component, invariant },
    });
    return new AuthError(message, 'AUTH_STATE_INVARIANT_FAILED', 500);
  }
}

function multiTenantBootstrapOrganizationRequired(): AuthError {
  return new AuthError(
    'Multi-tenant bootstrap requires atomic organization provisioning',
    'MULTI_TENANT_BOOTSTRAP_ORGANIZATION_REQUIRED',
    409,
  );
}
