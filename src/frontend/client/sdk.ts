import type {
  Row,
  ClientTableDef,
  JsonValue,
  SyncDataPlaneName,
  SyncMutationRejection,
} from '../../sync/types';
import type { PrimaryKeyOf } from '../../schema/infer';
import { createSyncClient } from '../../sync/client/sync-client';
import type { SyncClient } from '../../sync/client/sync-client';
import { StateClient } from '../../sync/client/state-client';
import { createStateStore, routeStateMessage, type StateStore } from '../../sync/client/state-store';
import { EphemeralClient } from '../../sync/client/ephemeral-client';
import { createEphemeralStore, routeEphemeralMessage } from '../../sync/client/ephemeral-store';
import type { EphemeralErrorMessage } from '../../sync/ephemeral-policy';
import { AuthClient, createAuthDisabledError } from './auth-client';
import type { AuthApiKeySdkSurface } from './auth-api-key-types';
import type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaimResult,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
} from './auth-domain-types';
import type {
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleDescriptor,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserIdentity,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
  AuthApplicationUserStatus,
} from './auth-application-administration-types';
import type { AuthAuditSdkSurface } from './auth-audit-types';
import type { AuthPlatformAdminSdkSurface } from './auth-platform-administration-types';
import type {
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
  AuthActionTokenInfo,
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthRegistrationResult,
  AuthSessionResult,
  AuthSessionTransitionState,
  AuthTenantListResult,
  AuthTenantCreateParams,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
  AuthTenantSummary,
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberIdentity,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantMembershipStatus,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantUpdateMemberParams,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitation,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRoleSelection,
  AuthTenantJoinRequestStatus,
  AuthTenantReviewJoinRequestParams,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
} from './auth-client';
import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaResetResult,
  AuthAdminSdkSurface,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
} from './auth-admin-types';
import { createApi } from './api';
import type { Api } from './api';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { ROOM_TABLES } from '../../rooms/types';
import { WORKFLOW_TABLES } from '../../workflows/types';
import { STORAGE_TABLES } from '../../storage/types';
import { createCollection, type Collection } from './collection';
import {
  createResourceClient,
  type ResourceClient,
  type ResourceClientOptions,
} from './resource-client';
import { createDataRealmReadinessSdkSurface } from './data-realm-readiness-transport';
import type { DataRealmReadinessSdkSurface } from '../../auth/data-realm-readiness-types';

/**
 * All platform-internal tables that hooks depend on.
 * Auto-merged into every client — apps never need to import or spread these.
 */
const PLATFORM_TABLES: Record<string, ClientTableDef> = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};

export type { SyncClient };
export type { SyncMutationRejection } from '../../sync/types';

export type {
  AuthApiKeyApplicationAdminSdkSurface,
  AuthApiKeyCreatedVia,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyManagementCapabilities,
  AuthApiKeyPage,
  AuthApiKeyPlatformAdminSdkSurface,
  AuthApiKeyScopeKind,
  AuthApiKeySdkSurface,
  AuthApiKeySelfSdkSurface,
  AuthApiKeyStatus,
  AuthApiKeySummary,
  AuthApiKeyTenantAdminSdkSurface,
  AuthPlatformApiKeyListQuery,
  IssuedAuthApiKey,
} from './auth-api-key-types';

export type {
  AuthAuthorizationIdentitySnapshot,
  AuthAuthorizationScopeSnapshot,
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
  AuthAuthorizationStatus,
} from './auth-authorization-types';

export type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthDomainOnboardingPendingRequest,
  AuthDomainOnboardingStatus,
  AuthDomainOnboardingTenantSummary,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaim,
  AuthTenantDomainClaimResult,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainDnsChallenge,
  AuthTenantDomainPolicy,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
  AuthTenantDomainRequestRole,
} from './auth-domain-types';

export type {
  AuthPlatformAddMemberParams,
  AuthPlatformAdministrationConfig,
  AuthPlatformAdminSdkSurface,
  AuthPlatformIssueInvitationParams,
  AuthPlatformRoleSelection,
  AuthPlatformTenant,
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListParams,
  AuthPlatformTenantOwnershipTransferResult,
  AuthPlatformMutableTenantStatus,
  AuthPlatformTenantPage,
  AuthPlatformTenantStatus,
  AuthPlatformTenantUpdateParams,
  AuthPlatformTenantUpdateResult,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
} from './auth-platform-administration-types';

export type { Collection } from './collection';

export type {
  ResourceClient,
  ResourceClientOptions,
  ResourceDeleteResult,
  ResourceListOptions,
  ResourceListResult,
  ResourceMutationOptions,
  ResourceRowResult,
} from './resource-client';
export { ResourceMutationError } from './resource-client';

export type {
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleDescriptor,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserIdentity,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
  AuthApplicationUserStatus,
  AuthActionTokenInfo,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaResetResult,
  AuthAdminSdkSurface,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthSessionResult,
  AuthSessionTransitionState,
  AuthTenantListResult,
  AuthTenantCreateParams,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
  AuthTenantSummary,
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberIdentity,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantMembershipStatus,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantUpdateMemberParams,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitation,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRoleSelection,
  AuthTenantJoinRequestStatus,
  AuthTenantReviewJoinRequestParams,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
};

export type {
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditPruneResult,
  AuthAuditQuery,
  AuthAuditReadScope,
  AuthAuditScopeKind,
  AuthAuditSdkSurface,
} from './auth-audit-types';

// ─── FetchError ─────────────────────────────────────────────────────────────

/**
 * Thrown by `client.fetch()` and its shortcuts on non-2xx responses.
 * Carries the HTTP status and parsed response body for programmatic handling.
 */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

// ─── Fetch Types ────────────────────────────────────────────────────────────

export interface FetchInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Abort signal passed through to fetch. */
  signal?: AbortSignal;
  /** If false, returns the raw Response instead of auto-parsing JSON. */
  json?: boolean;
}

// ─── Configuration ─────────────────────────────────────────────────────────

/**
 * Accepted table definition formats:
 * - `ClientTableDef` — raw `{ _pk: 'id', title: 'text', ... }`
 * - `TableDefinition` — output of `defineTable()` (has `.clientTable`)
 */
type TableInput = ClientTableDef | { clientTable: ClientTableDef };

export interface ClientConfig {
  /** Server URL (HTTP or HTTPS). WebSocket URL derived automatically. */
  url: string;

  /**
   * Table definitions — pass `defineTable()` output directly.
   * Auto-detects format and extracts `.clientTable` when needed.
   *
   * @example
   * ```ts
   * import { tables } from './lib/schemas';
   * createClient({ url: '...', tables });
   * ```
   */
  tables?: Record<string, TableInput>;

  /**
   * Exact server-authored data plane for each configured application table.
   * Framework-owned tables stay on the default plane automatically. Omit for
   * the legacy single/default-database protocol.
   */
  tableSyncPlanes?: Readonly<Record<string, SyncDataPlaneName>>;

  /** Enable auth. Default: false, matching createApp(). */
  auth?: boolean;

  /** Revalidate observed authorization hints in milliseconds. Default: 30000; 0 disables polling. */
  authorizationRevalidationIntervalMs?: number;

  /** Enable per-user state sync. Requires auth: true. Default: false */
  stateSync?: boolean;

  /** Connect WebSocket immediately. Default: true */
  autoConnect?: boolean;

  /** Max reconnect attempts. Default: Infinity */
  maxReconnectAttempts?: number;

  /** Generated resource route prefix. Default: `/api/resources`. */
  resourcePrefix?: string;

  /** Called on unrecoverable connection error. */
  onError?: (error: string) => void;

  /** Called after successful reconnect. */
  onReconnect?: () => void;

  /** Called after a rejected realtime mutation has been rolled back locally. */
  onMutationRejected?: (rejection: SyncMutationRejection) => void;
}

// ─── Client Interface ──────────────────────────────────────────────────────

export interface Client extends AuthAdminSdkSurface {
  /** Server URL this client connects to. */
  readonly url: string;

  /** Namespaced single/advanced application-role administration. */
  readonly applicationAdmin: AuthApplicationAdminSdkSurface;

  /** Guardian API-key management, partitioned by authorization control plane. */
  readonly apiKeys: AuthApiKeySdkSurface;

  /** Authorized durable auth/control-plane audit access. */
  readonly audit: AuthAuditSdkSurface;

  /** Protected administration-organization and customer-tenant control plane. */
  readonly platformAdmin: AuthPlatformAdminSdkSurface;

  /** Readiness of the authenticated request's server-derived application realm. */
  readonly dataRealm: DataRealmReadinessSdkSurface;

  // ─── Auth (top-level shortcuts) ──────────────────────────────────

  /** Current authenticated user, or null. */
  readonly user: AuthUser | null;

  /** Last live browser authorization hint; never authoritative for server access. */
  readonly authorization: AuthAuthorizationSnapshot | null;

  /** Load/error/revocation state for the authorization hint cache. */
  readonly authorizationState: AuthAuthorizationState;

  /** Load the current hint if absent. */
  getAuthorization(): Promise<AuthAuthorizationSnapshot | null>;

  /** Force a live server authorization read. */
  refreshAuthorization(): Promise<AuthAuthorizationSnapshot | null>;

  /** Subscribe to authorization hint state. */
  subscribeAuthorization(callback: () => void): () => void;

  /** Current live tenant binding in multi-tenant mode, or null. */
  readonly activeTenant: AuthTenantSummary | null;

  /** Whether the user is authenticated. */
  readonly isAuthenticated: boolean;

  /** Scope replacement phase, including committed-but-recoverable Sync state. */
  readonly sessionTransition: AuthSessionTransitionState;

  /** Log in. Returns a session or an MFA continuation payload. */
  login(username: string, password: string): Promise<AuthCompletionResult>;

  /** Register a new account. Returns a session or account/MFA continuation payload. */
  register(params: RegisterParams): Promise<AuthRegistrationResult>;

  /** Load public auth config for registration/bootstrap UI decisions. */
  getAuthConfig(): Promise<AuthPublicConfig>;

  /** Request a password reset email. Always generic on success. */
  forgotPassword(email: string, nativeContinuation?: string): Promise<void>;

  /** Request another email verification link. Always generic on success. */
  resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void>;

  /** Verify an email address from an emailed verification token. */
  verifyEmail(token: string): Promise<AuthCompletionResult>;

  /** Inspect a reset/setup token without consuming it. */
  inspectActionToken(token: string): Promise<AuthActionTokenInfo>;

  /** Complete a password reset from an emailed reset token. */
  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;

  /** Complete first-password setup from an emailed setup token. */
  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult>;

  /** Load current-user MFA methods. */
  listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }>;

  /** Start MFA setup from a session or auth transition token. */
  startMfaSetup(params: {
    setupToken?: string;
    method: AuthMfaMethodType;
    label?: string;
  }): Promise<AuthMfaSetupStartResult>;

  /** Verify MFA setup. Auth-flow setup returns a full session. */
  verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult>;

  /** Verify an MFA login challenge and receive the next auth completion result. */
  verifyMfaChallenge(params: {
    challengeToken: string;
    code: string;
  }): Promise<AuthCompletionResult>;

  /** Exchange a short-lived identity continuation for one tenant-bound session. */
  selectTenant(continuation: string, tenantId: string): Promise<AuthSessionResult>;

  /** List live organizations using proof from the current refresh family. */
  listTenants(): Promise<AuthTenantListResult>;

  /** Create and activate an owned tenant using onboarding or current-session proof. */
  createTenant(params: AuthTenantCreateParams): Promise<AuthSessionResult>;

  /** Atomically replace the current browser session with another tenant binding. */
  switchTenant(tenantId: string): Promise<AuthSessionResult>;

  /** Load capabilities and role metadata for the active tenant. */
  getTenantAdministrationConfig(): Promise<AuthTenantAdministrationConfig>;

  /** List safe member projections from the active tenant only. */
  listTenantMembers(params?: AuthTenantMemberListParams): Promise<AuthTenantMemberPage>;

  /** Add an already-existing exact-email account to the active tenant. */
  addTenantMember(params: AuthTenantAddMemberParams): Promise<AuthTenantMemberMutationResult>;

  /** Update active-tenant membership status or assignable roles. */
  updateTenantMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult>;

  /** Permanently remove authority while retaining the membership audit row. */
  removeTenantMember(membershipId: string): Promise<AuthTenantMemberMutationResult>;

  /** Transfer the caller's protected ownership to another active member. */
  transferTenantOwnership(
    membershipId: string,
  ): Promise<AuthTenantOwnershipTransferResult>;

  /** Inspect an invitation without revealing whether arbitrary identities exist. */
  inspectTenantInvitation(token: string): Promise<AuthTenantInvitationInspection>;

  /** Accept with a completed session/onboarding proof, or create the exact invited account. */
  acceptTenantInvitation(
    params: AuthTenantAcceptInvitationParams,
  ): Promise<AuthTenantInvitationAcceptanceResult>;

  /** Submit a retained, reviewer-safe request for organization access. */
  submitTenantJoinRequest(
    tenantSlug: string,
    continuation?: string,
  ): Promise<{ submitted: true }>;

  /** List invitation audit records for the active tenant. */
  listTenantInvitations(
    params?: AuthTenantInvitationListParams,
  ): Promise<AuthTenantInvitationPage>;

  /** Issue by email or explicitly request the one-time manual token contract. */
  issueTenantInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult>;

  revokeTenantInvitation(invitationId: string): Promise<{
    invitation: AuthTenantInvitation;
  }>;

  listTenantJoinRequests(
    params?: AuthTenantJoinRequestListParams,
  ): Promise<AuthTenantJoinRequestPage>;

  approveTenantJoinRequest(
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ): Promise<{ request: AuthTenantJoinRequest }>;

  denyTenantJoinRequest(
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ): Promise<{ request: AuthTenantJoinRequest }>;

  /** Load verified-domain controls for the bearer-bound active tenant. */
  getTenantDomainAdministration(signal?: AbortSignal): Promise<AuthTenantDomainAdministration>;

  /** Create an exact-domain claim and receive its one-time DNS challenge. */
  createTenantDomainClaim(domain: string): Promise<AuthTenantDomainChallengeResult>;

  /** Rotate the one-time DNS challenge for one loaded claim revision. */
  issueTenantDomainChallenge(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainChallengeResult>;

  verifyTenantDomainClaim(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainClaimResult>;

  updateTenantDomainPolicy(
    claimId: string,
    update: AuthTenantDomainPolicyUpdate,
  ): Promise<AuthTenantDomainClaimResult>;

  /** Release one claim into quarantine after exact typed confirmation. */
  releaseTenantDomainClaim(
    claimId: string,
    input: AuthTenantDomainReleaseInput,
  ): Promise<AuthTenantDomainReleaseResult>;

  /** Begin generic mailbox proof using current Bearer or a pre-session identity proof. */
  startDomainOnboarding(identityContinuation?: string): Promise<{ accepted: true }>;

  /** Resolve only server-derived post-proof onboarding options; never logs in. */
  completeDomainOnboarding(proofToken: string): Promise<AuthDomainOnboardingCompletion>;

  /** Submit request-to-join using proof only; no tenant/domain/role input. */
  admitDomainOnboarding(
    continuation: string,
    identityContinuation?: string,
  ): Promise<AuthDomainOnboardingAdmissionResult>;

  /** Log out and clear tokens. */
  logout(): Promise<void>;

  /** Current auth token (for passing to WS or other services). */
  readonly token: string | null;

  /** Change the current user's password. Issues fresh tokens on success. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  /** Refresh the access token. Deduplicates concurrent calls. */
  refresh(): Promise<void>;

  /** Retry local reconciliation after a committed scope transition timed out. */
  reconcileAuthSession(): Promise<void>;

  /** Set a user property (key-value). */
  setProperty(key: string, value: unknown): Promise<void>;

  /** Get a user property by key. Returns null if not found. */
  getProperty(key: string): Promise<string | null>;

  /** Get all user properties. */
  getProperties(): Promise<Record<string, string>>;

  /** Delete a user property by key. */
  deleteProperty(key: string): Promise<void>;

  // ─── HTTP (authenticated JSON fetch) ─────────────────────────────

  /**
   * Authenticated fetch with auto-JSON handling.
   * - Prepends server URL to relative paths (e.g., '/api/users' → 'http://localhost:3000/api/users')
   * - Rejects absolute URLs on any origin other than the configured Zero server
   * - Auto-sets Content-Type and JSON.stringifies body objects
   * - Auto-parses JSON response
   * - Throws FetchError on non-2xx responses
   * - Auto-refreshes token on 401
   *
   * @example
   * ```ts
   * const { users } = await client.fetch<{ users: User[] }>('/api/users');
   * ```
   */
  fetch<T = unknown>(path: string, init?: FetchInit): Promise<T>;

  /** GET shortcut. `await client.get('/api/users')` */
  get<T = unknown>(path: string): Promise<T>;

  /** POST shortcut. `await client.post('/api/users', { name: 'Alice' })` */
  post<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** PUT shortcut. `await client.put('/api/users/1', { name: 'Bob' })` */
  put<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** PATCH shortcut. `await client.patch('/api/users/1', { role: 'admin' })` */
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** DELETE shortcut. `await client.delete('/api/users/1')` */
  delete<T = unknown>(path: string): Promise<T>;

  // ─── Typed API (Eden Treaty) ─────────────────────────────────────

  /**
   * Fully typed API client — auto-completed from server route definitions.
   * Uses Eden Treaty. Auth headers injected automatically with 401 auto-refresh.
   *
   * @example
   * ```ts
   * // Rooms
   * const { data } = await client.api.rooms.post({ name: 'Game Room' });
   * const { data: { rooms } } = await client.api.rooms.get();
   * await client.api.rooms[roomId].join.post();
   *
   * // Workflows
   * const { data } = await client.api.workflows.post({ name: 'onboarding', input: {} });
   * await client.api.workflows[id].cancel.post();
   *
   * // Auth
   * const { data: me } = await client.api.auth.me.get();
   * ```
   */
  readonly api: Api;

  // ─── Data ────────────────────────────────────────────────────────

  /** Get a typed collection for a table. */
  collection<
    T extends Row = Row,
    TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
  >(name: string): Collection<T, TPrimaryKey>;

  /** Get a generated-resource CRUD client. */
  resource<T extends Row = Row>(name: string, options?: ResourceClientOptions): ResourceClient<T>;

  // ─── Connection ──────────────────────────────────────────────────

  /** Connect the WebSocket when autoConnect was disabled. */
  connect(): void;

  /** Whether the WebSocket is currently connected. */
  readonly connected: boolean;

  /** Subscribe to connection state changes. Returns unsubscribe. */
  onConnectionChange(callback: (connected: boolean) => void): () => void;

  /** Observe rejected optimistic mutations after their local rollback. */
  onMutationRejected(
    callback: (rejection: SyncMutationRejection) => void,
  ): () => void;

  /** Disconnect everything — WS, auth, state. */
  disconnect(): void;
}

/**
 * @internal Full client type — includes internal properties not in the public Client interface.
 * Used by SDK-internal code (AppProvider, hooks, room-hooks) that needs access to
 * the underlying auth, state, ephemeral, and sync clients.
 */
export interface InternalClient extends Client {
  /** @internal */
  readonly auth: AuthClient | null;
  /** @internal */
  readonly state: StateClient | null;
  /** @internal */
  readonly ephemeral: EphemeralClient;
  /** @internal */
  readonly _syncClient: SyncClient;
}

// ─── Singleton Guard ───────────────────────────────────────────────────────

let _instance: Client | null = null;

const AUTHORIZATION_DISABLED_STATE: AuthAuthorizationState = Object.freeze({
  status: 'disabled',
  snapshot: null,
  error: null,
});

/**
 * Read the opaque parent-session id only to decide whether local client data
 * crosses an authorization boundary. This is cache hygiene, never trust or
 * authorization; malformed/opaque tokens conservatively become unique scopes.
 */
function readAuthorizationScope(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload || typeof globalThis.atob !== 'function') return `opaque:${token}`;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const claims = JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
    if (typeof claims.sid !== 'string' || typeof claims.sub !== 'string') {
      return `opaque:${token}`;
    }
    return `${claims.sub}:${claims.sid}`;
  } catch {
    return `opaque:${token}`;
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create the SDK client. One client per app.
 *
 * Wires together:
 * - **SyncClient** — WebSocket connection, optimistic mutations, @xstate/store
 * - **AuthClient** — login/register/logout, token lifecycle, auto-refresh
 * - **StateClient** — per-user persistent KV (optional)
 * - **Collection<T>** — typed per-table API
 *
 * @example
 * ```ts
 * import { createClient, defineTable, field, type InferRow } from '@zero/framework/react';
 *
 * const todos = defineTable('todos', {
 *   title: field.text({ required: true }),
 *   done: field.boolean(),
 * });
 * const client = createClient({
 *   url: 'http://localhost:3000',
 *   tables: { todos },
 * });
 *
 * // Auth — top-level
 * await client.login('alice', 'password123');
 * console.log(client.user?.username);
 *
 * // HTTP — one-liner authenticated requests
 * const { todos } = await client.get('/api/todos');
 * const { todo } = await client.post('/api/todos', { title: 'Buy milk' });
 * await client.patch('/api/todos/1', { done: true });
 * await client.delete('/api/todos/1');
 *
 * // Collections — real-time sync
 * const col = client.collection<InferRow<typeof todos>>('todos');
 * col.insert({ title: 'Buy milk', done: true });
 * ```
 */
export function createClient(config: ClientConfig): Client {
  if (_instance) {
    throw new Error(
      'createClient() called twice. Only one client per app. ' +
      'Call client.disconnect() first if you need to recreate.'
    );
  }

  const {
    url,
    tables: rawTables,
    tableSyncPlanes,
    auth: authEnabled = false,
    authorizationRevalidationIntervalMs,
    stateSync = false,
    autoConnect = true,
    maxReconnectAttempts,
    resourcePrefix = '/api/resources',
    onError,
    onReconnect,
    onMutationRejected,
  } = config;

  if (stateSync && !authEnabled) {
    throw new Error('[client] stateSync requires auth: true because server state is keyed by authenticated user.');
  }

  // Normalize app tables — accept raw ClientTableDef or defineTable() output.
  // defineTable() returns { clientTable: ClientTableDef, ... } — extract .clientTable.
  const appTables: Record<string, ClientTableDef> = {};
  for (const [name, def] of Object.entries(rawTables ?? {})) {
    appTables[name] = 'clientTable' in def ? (def as { clientTable: ClientTableDef }).clientTable : def as ClientTableDef;
  }

  // Auth-backed platform services live exclusively on the system plane. Do
  // not register their tables for auth-disabled apps, whose server has no
  // system Sync bridge and therefore cannot complete a system baseline.
  // App tables spread last so they can override if needed.
  const tables: Record<string, ClientTableDef> = {
    ...(authEnabled ? PLATFORM_TABLES : {}),
    ...appTables,
  };
  const resolvedTableSyncPlanes = resolveSdkTableSyncPlanes(
    appTables,
    tableSyncPlanes,
    authEnabled,
  );

  // ─── Auth ─────────────────────────────────────────────────────────
  // Authorization-scope lifecycle callbacks are installed into AuthClient
  // before the concrete sync clients are constructed. They are only invoked
  // by user actions after createClient() has returned.
  let authorizationScopeEpoch = 0;
  let authorizationScopeTransition = false;
  const authorizationScopeRequestCancellations = new Map<number, Set<() => void>>();
  let syncClient!: SyncClient;
  let stateClient: StateClient | null = null;
  let ephemeralClient!: EphemeralClient;
  let syncStarted = autoConnect;

  function cancelAuthorizationScopeRequests(): void {
    const cancellations = [...authorizationScopeRequestCancellations.values()]
      .flatMap((callbacks) => [...callbacks]);
    authorizationScopeRequestCancellations.clear();
    for (const cancel of cancellations) {
      try {
        cancel();
      } catch {
        // Scope invalidation must continue even if one transport cleanup fails.
      }
    }
  }

  function beginAuthorizationScopeTransition(): void {
    if (authorizationScopeTransition) {
      throw new Error('[client] An authorization scope transition is already in progress.');
    }
    authorizationScopeTransition = true;
    authorizationScopeEpoch += 1;
    cancelAuthorizationScopeRequests();
    syncClient.beginAuthorizationScopeTransition();
    stateClient?.beginAuthorizationScopeTransition();
    ephemeralClient.beginAuthorizationScopeTransition();
  }

  async function completeAuthorizationScopeTransition(): Promise<void> {
    const shouldConnect = syncStarted && Boolean(authClient?.accessToken);
    syncClient.completeAuthorizationScopeTransition(shouldConnect);
    try {
      if (shouldConnect) await syncClient.waitForAuthorizationBaseline();
    } finally {
      // A baseline timeout is recoverable and must not strand every HTTP,
      // state, and ephemeral operation behind a permanently closed barrier.
      stateClient?.completeAuthorizationScopeTransition();
      ephemeralClient.completeAuthorizationScopeTransition();
      authorizationScopeTransition = false;
    }
  }

  function abortAuthorizationScopeTransition(): void {
    const shouldConnect = syncStarted && Boolean(authClient?.accessToken);
    syncClient.completeAuthorizationScopeTransition(shouldConnect);
    stateClient?.completeAuthorizationScopeTransition();
    ephemeralClient.completeAuthorizationScopeTransition();
    authorizationScopeTransition = false;
  }

  function beginAuthorizationScopeRequest(): number {
    if (authorizationScopeTransition) {
      throw new Error('[client] Requests are unavailable during an authorization scope transition.');
    }
    return authorizationScopeEpoch;
  }

  function assertAuthorizationScopeRequestCurrent(epoch: number): void {
    if (authorizationScopeTransition || epoch !== authorizationScopeEpoch) {
      throw new Error('[client] Discarded a response from a previous authorization scope.');
    }
  }

  function registerAuthorizationScopeRequestCancellation(
    epoch: number,
    cancel: () => void,
  ): () => void {
    assertAuthorizationScopeRequestCurrent(epoch);
    let callbacks = authorizationScopeRequestCancellations.get(epoch);
    if (!callbacks) {
      callbacks = new Set();
      authorizationScopeRequestCancellations.set(epoch, callbacks);
    }
    callbacks.add(cancel);
    return () => {
      callbacks?.delete(cancel);
      if (callbacks?.size === 0) authorizationScopeRequestCancellations.delete(epoch);
    };
  }

  async function reconcileAuthorizationScopeTransition(): Promise<void> {
    if (!syncStarted || !authClient?.accessToken) return;
    if (!syncClient.connected) syncClient.connect();
    await syncClient.waitForAuthorizationBaseline();
  }

  const authClient = authEnabled ? new AuthClient(url, {
    authorizationRevalidationIntervalMs,
    authorizationScopeLifecycle: {
      beginTransition: beginAuthorizationScopeTransition,
      completeTransition: completeAuthorizationScopeTransition,
      abortTransition: abortAuthorizationScopeTransition,
      reconcileTransition: reconcileAuthorizationScopeTransition,
      beginRequest: beginAuthorizationScopeRequest,
      assertRequestCurrent: assertAuthorizationScopeRequestCurrent,
      registerRequestCancellation: registerAuthorizationScopeRequestCancellation,
    },
  }) : null;

  function requireAuthClient(): AuthClient {
    if (!authClient) throw createAuthDisabledError();
    return authClient;
  }

  // ─── Derive WS URL ────────────────────────────────────────────────
  function getWsUrl(): string {
    const u = new URL(url);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/sync';
    return u.toString();
  }

  // ─── Sync Client (always created — owns the WebSocket) ────────────
  const currentAuthToken = () => authClient?.accessToken || null;
  let syncAuthRefresh: Promise<void> | null = null;
  let stateStore: StateStore | null = null;

  function resetClientSessionState(): void {
    syncClient.reset();
    stateStore?.send({ type: 'state.reset' } as any);
  }

  function handleSyncAuthFailure(error: string): void {
    if (!authClient) {
      onError?.(error);
      return;
    }
    if (syncAuthRefresh) return;

    const refreshScope = authClient.authorizationScopeKey;
    syncAuthRefresh = (async () => {
      const refreshed = await authClient.refresh();
      if (refreshed && currentAuthToken()) {
        syncClient.connect();
        return;
      }

      // A rejected refresh already commits expiry through AuthSession's scope
      // purge barrier. Only transports that returned false without expiring
      // an established scope still need the revision-fenced fallback.
      if (authClient.authorizationScopeKey || authClient.isAuthenticated) {
        authClient.expireSession();
      }
      resetClientSessionState();
      onError?.(error);
    })()
      .catch(() => {
        // Scope replacement intentionally cancels refresh work retained by
        // the rejected socket. Its replacement lifecycle owns reconnect and
        // cache state, so cancellation is neither an app error nor a reason
        // to expire the newly committed session.
        if (authClient.authorizationScopeKey !== refreshScope
          || authClient.sessionTransition.phase !== 'idle') return;
        onError?.(error);
      })
      .finally(() => {
        syncAuthRefresh = null;
      });
  }

  syncClient = createSyncClient({
    url: getWsUrl(),
    tables,
    ...(resolvedTableSyncPlanes
      ? { tableSyncPlanes: resolvedTableSyncPlanes }
      : {}),
    getToken: currentAuthToken,
    stateSync,
    autoConnect,
    onError,
    onAuthFailure: handleSyncAuthFailure,
    onReconnect,
    onMutationRejected,
    maxReconnectAttempts,
  });

  // ─── State Client (optional) ──────────────────────────────────────
  if (stateSync) {
    stateStore = createStateStore();
    stateClient = new StateClient(
      (msg) => syncClient.sendRaw(msg),
      stateStore
    );

    // Route incoming state messages from WS to state store + client
    syncClient.onMessage((msg) => {
      const handled = routeStateMessage(stateStore!, msg);
      if (handled) {
        // Notify StateClient subscribers for remote changes
        if (msg.type === 'state.snapshot') {
          stateClient!.handleSnapshot();
        } else if (msg.type === 'state.change') {
          stateClient!.handleRemoteChange(
            msg.op as 'set' | 'delete' | 'clear',
            msg.key as string | null,
            msg.value as JsonValue | undefined,
          );
        }
      }
    });
  }

  // ─── Ephemeral Client (always created) ───────────────────────────
  const ephemeralStore = createEphemeralStore();
  ephemeralClient = new EphemeralClient(
    (msg) => syncClient.sendRaw(msg),
    ephemeralStore
  );

  // Route incoming ephemeral messages from WS to ephemeral store
  syncClient.onMessage((msg) => {
    routeEphemeralMessage(ephemeralStore, msg);
    if (msg.type === 'ephemeral.error') {
      ephemeralClient.handleError(msg as unknown as EphemeralErrorMessage);
    }
  });

  // ─── Collection Cache ─────────────────────────────────────────────
  const collections = new Map<string, Collection<any, any>>();
  const resourceClients = new Map<string, ResourceClient<any>>();

  let previousAuthToken = currentAuthToken();
  let previousAuthorizationScope = readAuthorizationScope(previousAuthToken);
  const unsubscribeAuth = authClient?.subscribe(() => {
    const nextAuthToken = currentAuthToken();
    if (nextAuthToken === previousAuthToken) return;

    const nextAuthorizationScope = readAuthorizationScope(nextAuthToken);
    const scopeChanged = nextAuthorizationScope !== previousAuthorizationScope;
    previousAuthToken = nextAuthToken;
    previousAuthorizationScope = nextAuthorizationScope;

    // Tenant selection/switch owns its reconnect barrier. The token store
    // notification occurs while that barrier is deliberately still closed.
    if (authorizationScopeTransition) return;

    if (scopeChanged) {
      authorizationScopeEpoch += 1;
      cancelAuthorizationScopeRequests();
      syncClient.beginAuthorizationScopeTransition();
      stateClient?.beginAuthorizationScopeTransition();
      ephemeralClient.beginAuthorizationScopeTransition();
      syncClient.completeAuthorizationScopeTransition(false);
      stateClient?.completeAuthorizationScopeTransition();
      ephemeralClient.completeAuthorizationScopeTransition();
      if (nextAuthToken && syncStarted) syncClient.connect();
    } else if (nextAuthToken && syncStarted) {
      syncClient.reconnect();
    } else {
      resetClientSessionState();
    }
  }) ?? null;

  function getCollection<
    T extends Row,
    TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
  >(name: string): Collection<T, TPrimaryKey> {
    if (!tables[name]) throw new Error(`Unknown table: ${name}`);

    let col = collections.get(name);
    if (col) return col as Collection<T, TPrimaryKey>;

    col = createCollection<T, TPrimaryKey>(name, syncClient, tables[name]);
    collections.set(name, col);
    return col as Collection<T, TPrimaryKey>;
  }

  function getResource<T extends Row>(
    name: string,
    options: ResourceClientOptions = {}
  ): ResourceClient<T> {
    const prefix = options.prefix ?? resourcePrefix;
    const cacheKey = `${prefix}:${name}`;
    const existing = resourceClients.get(cacheKey);
    if (existing) return existing as ResourceClient<T>;

    const next = createResourceClient<T>(name, { fetch: clientFetch }, { prefix });
    resourceClients.set(cacheKey, next);
    return next;
  }

  // ─── Authenticated Fetch ────────────────────────────────────────
  async function clientFetch<T = unknown>(path: string, init?: FetchInit): Promise<T> {
    const fullUrl = path.startsWith('http') ? path : `${url}${path}`;
    const hasBody = init?.body !== undefined && init?.body !== null;

    const requestInit: RequestInit = {
      method: init?.method ?? (hasBody ? 'POST' : 'GET'),
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: init?.signal,
      ...(hasBody ? { body: JSON.stringify(init!.body) } : {}),
    };

    const res = authClient
      ? await authClient.fetchWithAuth(fullUrl, requestInit)
      : await fetch(fullUrl, requestInit);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const message = (body as Record<string, unknown>)?.error ?? res.statusText;
      throw new FetchError(String(message), res.status, body);
    }

    if (init?.json === false) return res as unknown as T;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const dataRealm = createDataRealmReadinessSdkSurface(clientFetch);

  // ─── Eden Treaty API ────────────────────────────────────────────
  const api = createApi(url, authClient);
  const applicationAdmin: AuthApplicationAdminSdkSurface = Object.freeze({
    getConfig: async () => requireAuthClient().applicationAdmin.getConfig(),
    listUsers: async (params?: AuthApplicationUserListParams) => (
      requireAuthClient().applicationAdmin.listUsers(params)
    ),
    replaceUserRoles: async (
      userId: string,
      roles: readonly string[],
      expectedRevision: string,
    ) => (
      requireAuthClient().applicationAdmin.replaceUserRoles(
        userId,
        roles,
        expectedRevision,
      )
    ),
    transferOwnership: async (userId: string) => (
      requireAuthClient().applicationAdmin.transferOwnership(userId)
    ),
  });

  // ─── Client Instance ──────────────────────────────────────────────
  const client = {
    get url() { return url; },
    get applicationAdmin() { return applicationAdmin; },
    get apiKeys() { return requireAuthClient().apiKeys; },
    get audit() { return requireAuthClient().audit; },
    get platformAdmin() { return requireAuthClient().platformAdmin; },
    get dataRealm() { return dataRealm; },
    /** @internal */
    get auth() { return authClient; },
    get state() { return stateClient; },
    get ephemeral() { return ephemeralClient; },

    /** The underlying SyncClient — exposed for SyncProvider wiring. */
    get _syncClient() { return syncClient; },

    // ─── Typed API ─────────────────────────────────────────────────
    get api() { return api; },

    // ─── Auth (top-level) ──────────────────────────────────────────
    get user() { return authClient?.user ?? null; },
    get authorization() { return authClient?.authorization ?? null; },
    get authorizationState(): AuthAuthorizationState {
      return authClient?.authorizationState ?? AUTHORIZATION_DISABLED_STATE;
    },
    getAuthorization: async () => requireAuthClient().getAuthorization(),
    refreshAuthorization: async () => requireAuthClient().refreshAuthorization(),
    subscribeAuthorization: (callback: () => void) => (
      authClient ? authClient.subscribeAuthorization(callback) : () => {}
    ),
    get activeTenant() { return authClient?.activeTenant ?? null; },
    get isAuthenticated() { return authClient?.isAuthenticated ?? false; },
    get sessionTransition() {
      return authClient?.sessionTransition ?? {
        phase: 'idle' as const,
        operation: null,
        revision: 0,
        recoverable: false,
        error: null,
      };
    },
    get token() { return authClient?.accessToken ?? null; },
    login: async (username: string, password: string) => requireAuthClient().login(username, password),
    register: async (params: RegisterParams) => requireAuthClient().register(params),
    getAuthConfig: async () => requireAuthClient().getConfig(),
    forgotPassword: async (email: string, nativeContinuation?: string) =>
      requireAuthClient().forgotPassword(email, nativeContinuation),
    resendVerificationEmail: async (email: string, nativeContinuation?: string) =>
      requireAuthClient().resendVerificationEmail(email, nativeContinuation),
    verifyEmail: async (token: string) => requireAuthClient().verifyEmail(token),
    inspectActionToken: async (token: string) => requireAuthClient().inspectActionToken(token),
    resetPassword: async (token: string, newPassword: string) => requireAuthClient().resetPassword(token, newPassword),
    setupPassword: async (token: string, newPassword: string) => requireAuthClient().setupPassword(token, newPassword),
    listMfaMethods: async () => requireAuthClient().listMfaMethods(),
    startMfaSetup: async (params: {
      setupToken?: string;
      method: AuthMfaMethodType;
      label?: string;
    }) => requireAuthClient().startMfaSetup(params),
    verifyMfaSetup: async (params: {
      verificationToken: string;
      code: string;
    }) => requireAuthClient().verifyMfaSetup(params),
    verifyMfaChallenge: async (params: {
      challengeToken: string;
      code: string;
    }) => requireAuthClient().verifyMfaChallenge(params),
    selectTenant: async (continuation: string, tenantId: string) =>
      requireAuthClient().selectTenant(continuation, tenantId),
    listTenants: async () => requireAuthClient().listTenants(),
    createTenant: async (params: AuthTenantCreateParams) =>
      requireAuthClient().createTenant(params),
    switchTenant: async (tenantId: string) => requireAuthClient().switchTenant(tenantId),
    getTenantAdministrationConfig: async () => (
      requireAuthClient().getTenantAdministrationConfig()
    ),
    listTenantMembers: async (params?: AuthTenantMemberListParams) => (
      requireAuthClient().listTenantMembers(params)
    ),
    addTenantMember: async (params: AuthTenantAddMemberParams) => (
      requireAuthClient().addTenantMember(params)
    ),
    updateTenantMember: async (
      membershipId: string,
      params: AuthTenantUpdateMemberParams,
    ) => requireAuthClient().updateTenantMember(membershipId, params),
    removeTenantMember: async (membershipId: string) => (
      requireAuthClient().removeTenantMember(membershipId)
    ),
    transferTenantOwnership: async (membershipId: string) => (
      requireAuthClient().transferTenantOwnership(membershipId)
    ),
    inspectTenantInvitation: async (token: string) => (
      requireAuthClient().inspectTenantInvitation(token)
    ),
    acceptTenantInvitation: async (params: AuthTenantAcceptInvitationParams) => (
      requireAuthClient().acceptTenantInvitation(params)
    ),
    submitTenantJoinRequest: async (tenantSlug: string, continuation?: string) => (
      requireAuthClient().submitTenantJoinRequest(tenantSlug, continuation)
    ),
    listTenantInvitations: async (params?: AuthTenantInvitationListParams) => (
      requireAuthClient().listTenantInvitations(params)
    ),
    issueTenantInvitation: async (params: AuthTenantIssueInvitationParams) => (
      requireAuthClient().issueTenantInvitation(params)
    ),
    revokeTenantInvitation: async (invitationId: string) => (
      requireAuthClient().revokeTenantInvitation(invitationId)
    ),
    listTenantJoinRequests: async (params?: AuthTenantJoinRequestListParams) => (
      requireAuthClient().listTenantJoinRequests(params)
    ),
    approveTenantJoinRequest: async (
      joinRequestId: string,
      params: AuthTenantReviewJoinRequestParams,
    ) => requireAuthClient().approveTenantJoinRequest(joinRequestId, params),
    denyTenantJoinRequest: async (
      joinRequestId: string,
      params: AuthTenantDenyJoinRequestParams,
    ) => (
      requireAuthClient().denyTenantJoinRequest(joinRequestId, params)
    ),
    getTenantDomainAdministration: async (signal?: AbortSignal) => (
      requireAuthClient().getTenantDomainAdministration(signal)
    ),
    createTenantDomainClaim: async (domain: string) => (
      requireAuthClient().createTenantDomainClaim(domain)
    ),
    issueTenantDomainChallenge: async (claimId: string, expectedRevision: string) => (
      requireAuthClient().issueTenantDomainChallenge(claimId, expectedRevision)
    ),
    verifyTenantDomainClaim: async (claimId: string, expectedRevision: string) => (
      requireAuthClient().verifyTenantDomainClaim(claimId, expectedRevision)
    ),
    updateTenantDomainPolicy: async (
      claimId: string,
      update: AuthTenantDomainPolicyUpdate,
    ) => requireAuthClient().updateTenantDomainPolicy(claimId, update),
    releaseTenantDomainClaim: async (
      claimId: string,
      input: AuthTenantDomainReleaseInput,
    ) => requireAuthClient().releaseTenantDomainClaim(claimId, input),
    startDomainOnboarding: async (identityContinuation?: string) => (
      requireAuthClient().startDomainOnboarding(identityContinuation)
    ),
    completeDomainOnboarding: async (proofToken: string) => (
      requireAuthClient().completeDomainOnboarding(proofToken)
    ),
    admitDomainOnboarding: async (
      continuation: string,
      identityContinuation?: string,
    ) => requireAuthClient().admitDomainOnboarding(continuation, identityContinuation),
    logout: async () => requireAuthClient().logout(),
    changePassword: async (currentPassword: string, newPassword: string) => requireAuthClient().changePassword(currentPassword, newPassword),
    refresh: async () => { await requireAuthClient().refresh(); },
    reconcileAuthSession: async () => requireAuthClient().reconcileSession(),
    setProperty: async (key: string, value: unknown) => requireAuthClient().setProperty(key, value),
    getProperty: async (key: string) => requireAuthClient().getProperty(key),
    getProperties: async () => requireAuthClient().getProperties(),
    deleteProperty: async (key: string) => requireAuthClient().deleteProperty(key),
    getAuthAdminConfig: async () => requireAuthClient().getAdminConfig(),
    listAuthAdminUsers: async (params?: AuthAdminUserListParams) => requireAuthClient().listAdminUsers(params),
    getAuthAdminUser: async (userId: string) => requireAuthClient().getAdminUser(userId),
    createAuthAdminUser: async (params: AuthAdminCreateUserParams) => requireAuthClient().createAdminUser(params),
    updateAuthAdminUser: async (userId: string, params: AuthAdminUpdateUserParams) => requireAuthClient().updateAdminUser(userId, params),
    setAuthAdminUserProperty: async (userId: string, key: string, value: unknown) => requireAuthClient().setAdminUserProperty(userId, key, value),
    deleteAuthAdminUserProperty: async (userId: string, key: string) => requireAuthClient().deleteAdminUserProperty(userId, key),
    deleteAuthAdminUser: async (userId: string) => requireAuthClient().deleteAdminUser(userId),
    sendAuthAdminSetupEmail: async (userId: string) => requireAuthClient().sendAdminSetupEmail(userId),
    sendAuthAdminPasswordReset: async (userId: string) => requireAuthClient().sendAdminPasswordReset(userId),
    clearAuthAdminPasswordChangeRequirement: async (userId: string) => requireAuthClient().clearAdminPasswordChangeRequirement(userId),
    resetAuthAdminPassword: async (userId: string, password: string) => requireAuthClient().resetAdminPassword(userId, password),
    suspendAuthAdminUser: async (userId: string) => requireAuthClient().suspendAdminUser(userId),
    activateAuthAdminUser: async (userId: string) => requireAuthClient().activateAdminUser(userId),
    revokeAuthAdminUserSessions: async (userId: string) => requireAuthClient().revokeAdminUserSessions(userId),
    getAuthAdminUserMfa: async (userId: string) => requireAuthClient().getAdminUserMfa(userId),
    requireAuthAdminUserMfa: async (userId: string) => requireAuthClient().requireAdminUserMfa(userId),
    clearAuthAdminUserMfaRequirement: async (userId: string) => requireAuthClient().clearAdminUserMfaRequirement(userId),
    resetAuthAdminUserMfa: async (userId: string) => requireAuthClient().resetAdminUserMfa(userId),
    sendAuthAdminVerificationEmail: async (userId: string) => requireAuthClient().sendAdminVerificationEmail(userId),
    verifyAuthAdminUserEmail: async (userId: string) => requireAuthClient().verifyAdminUserEmail(userId),

    // ─── HTTP ──────────────────────────────────────────────────────
    fetch: clientFetch,
    get: <T = unknown>(path: string) => clientFetch<T>(path, { method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'POST', body }),
    put: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'PUT', body }),
    patch: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'PATCH', body }),
    delete: <T = unknown>(path: string) => clientFetch<T>(path, { method: 'DELETE' }),

    // ─── Data ──────────────────────────────────────────────────────
    collection<
      T extends Row,
      TPrimaryKey extends keyof T & string = PrimaryKeyOf<T>,
    >(name: string): Collection<T, TPrimaryKey> {
      return getCollection<T, TPrimaryKey>(name);
    },

    resource<T extends Row>(name: string, options?: ResourceClientOptions): ResourceClient<T> {
      return getResource<T>(name, options);
    },

    get connected() {
      return syncClient.connected;
    },

    connect() {
      syncStarted = true;
      syncClient.connect();
    },

    onConnectionChange(callback: (connected: boolean) => void): () => void {
      let prev = syncClient.connected;
      const sub = syncClient.store.subscribe(() => {
        const next = syncClient.connected;
        if (next !== prev) {
          prev = next;
          callback(next);
        }
      });
      return () => sub.unsubscribe();
    },

    onMutationRejected(
      callback: (rejection: SyncMutationRejection) => void,
    ) {
      return syncClient.onMutationRejected(callback);
    },

    disconnect() {
      authorizationScopeEpoch += 1;
      cancelAuthorizationScopeRequests();
      syncClient.disconnect();
      unsubscribeAuth?.();
      authClient?.dispose();
      stateClient?.dispose();
      ephemeralClient.dispose();
      collections.clear();
      resourceClients.clear();
      _instance = null;
    },
  };

  _instance = client;
  return client;
}

/**
 * Turn the app-only server catalog into the exact low-level Sync catalog.
 * Platform tables are SDK-owned and therefore never burden app configuration.
 */
function resolveSdkTableSyncPlanes(
  appTables: Readonly<Record<string, ClientTableDef>>,
  configured: Readonly<Record<string, SyncDataPlaneName>> | undefined,
  authEnabled: boolean,
): Readonly<Record<string, SyncDataPlaneName>> {
  const appPlanes = configured ?? Object.fromEntries(
    Object.keys(appTables).map((table) => [table, 'default' as const]),
  );

  const platform = Object.keys(appPlanes)
    .filter((table) => Object.hasOwn(PLATFORM_TABLES, table));
  if (platform.length > 0) {
    throw new Error(
      `[client] tableSyncPlanes cannot configure SDK-owned platform table${platform.length === 1 ? '' : 's'}: ${platform.join(', ')}`,
    );
  }

  const unknown = Object.keys(appPlanes)
    .filter((table) => !Object.hasOwn(appTables, table));
  if (unknown.length > 0) {
    throw new Error(
      `[client] tableSyncPlanes contains unknown table${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    );
  }

  const missing = Object.keys(appTables)
    .filter((table) => !Object.hasOwn(appPlanes, table));
  if (missing.length > 0) {
    throw new Error(
      `[client] tableSyncPlanes is missing application table${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }

  const resolved = Object.fromEntries(
    authEnabled
      ? Object.keys(PLATFORM_TABLES).map((table) => [table, 'system' as const])
      : [],
  ) as Record<string, SyncDataPlaneName>;
  for (const [table, plane] of Object.entries(appPlanes)) {
    resolved[table] = plane;
  }
  return Object.freeze(resolved);
}

/**
 * Get the current client instance, or null if not created.
 * Useful for accessing the client outside React (e.g., in route loaders).
 */
export function getClient(): Client | null {
  return _instance;
}
