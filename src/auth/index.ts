// ─── Auth Plugin ──────────────────────────────────────────────────────────
export {
  createAuthPlugin,
  getAuthApiKeyService,
  getAuthRequestCredentialResolver,
  getAuthAuditService,
  getAuthorizationKernel,
  getAuthorizationRoleService,
  getAuthSessionService,
  getAuthStore,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getTokenService,
} from './auth.plugin';
export {
  createAuthMiddleware,
  createProtectedMultipartRequestGuard,
  resolveRequestAuthContext,
  resolveRequestAuthorizationAccess,
} from './auth.middleware';
export type {
  AuthMiddlewareAuthorizationOptions,
  ProtectedMultipartPathMatcher,
  ProtectedMultipartRequestGuardOptions,
  ZeroElysiaAuthRequirement,
} from './auth.middleware';
export { authContextAuthorityFingerprint } from './auth-context-authority';
export { createAuthAuthorizationSnapshot } from './auth-authorization-snapshot';
export type {
  AuthAuthorizationIdentitySnapshot,
  AuthAuthorizationScopeSnapshot,
  AuthAuthorizationSnapshot,
} from './auth-authorization-snapshot';
export { installAuthStopBarrier } from './auth-stop-lifecycle';
export { AuthRuntime, createAuthRuntime } from './auth-runtime';
export type { AuthRuntimeDependencies } from './auth-runtime';
export {
  AuthorizationKernel,
  compileAccessRequirement,
  createAuthorizationKernel,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  validateAuthorizationRegistry,
  validatePermissionKey,
  validateRoleKey,
} from './authorization-kernel';
export {
  applicationServiceDataScope,
  requireRequestServiceDataScope,
  serviceDataScopeFromIdentity,
  serviceDataScopeKey,
  serviceDataScopeMatchesTenant,
  serviceDataTenantId,
  trustedSystemServiceDataScope,
} from './service-data-scope';
export type {
  ServiceDataScope,
  ServiceDataScopeIdentity,
} from './service-data-scope';
export {
  createAuthorizationSubjectSnapshot,
  createRequestAuthorizationAccess,
} from './authorization-access';
export type {
  AuthorizationPropertyStore,
  AuthorizationRoleAssignmentResolver,
  CreateRequestAuthorizationAccessOptions,
  RequestAuthorizationAccess,
  TenantAuthorizationScope,
} from './authorization-access';
export { captureAuthApplicationMutationAuthority } from './auth-application-mutation-authority';
export type {
  AssertAuthApplicationMutationAuthority,
  AuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';
export { captureAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
export type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
export {
  ADMINISTRATION_TENANT_ROLE_KEYS,
  FRAMEWORK_APPLICATION_AUTHORIZATION_PERMISSIONS,
  FRAMEWORK_APPLICATION_AUTHORIZATION_ROLES,
  FRAMEWORK_PLATFORM_ADMINISTRATION_PERMISSIONS,
  FRAMEWORK_TENANT_AUTHORIZATION_PERMISSIONS,
  FRAMEWORK_TENANT_AUTHORIZATION_ROLES,
  isAdministrationOnlyRole,
  isAdministrationTenantRoleKey,
  isRoleAssignableToTenantKind,
} from './authorization-registry';
export { AuthorizationRoleService } from './authorization-role-service';
export {
  AuthorizationRoleAssignmentError,
} from './authorization-role-types';
export type {
  ApplicationOwnershipTransferResult,
  AssignApplicationRoleInput,
  AssignTenantRoleInput,
  AuthorizationAssignmentScopeKind,
  AuthorizationAssignmentSource,
  AuthorizationRoleAssignmentErrorCode,
  AuthorizationRoleAssignmentRecord,
  AuthorizationRegistrySnapshot,
  AuthorizationRoleSet,
  ExpandedAuthorizationRoleSet,
  RemoveApplicationRoleInput,
  RemoveTenantRoleInput,
  RegistrationProvisioningAuthorityInput,
  ReplaceApplicationRolesInput,
  RollbackProvisionalApplicationOwnerInput,
  TransferApplicationOwnershipInput,
} from './authorization-role-types';
export type {
  AccessRequirement,
  AccessRequirementCompileOptions,
  AuthorizationCredentialKind,
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationKernelConfig,
  AuthorizationScopeKind,
  AuthorizationScopeSnapshot,
  AuthorizationSubjectSnapshot,
  CompiledAccessRequirement,
  LegacyAccessRequirement,
  SingleSimpleScopeInput,
  StructuredAccessRequirement,
  TrustedPropertyRequirement,
  TrustedPropertyScalar,
} from './authorization-kernel';

// ─── Services ─────────────────────────────────────────────────────────────
export {
  AuthAuditService,
  authAuditActorFromContext,
  authAuditRequestFromRequest,
} from './auth-audit-service';
export { resolveAuthAuditConfig } from './auth-audit-config';
export { resolveAuthApiKeyConfig } from './auth-api-key-config';
export { AuthApiKeyService } from './auth-api-key-service';
export type { AuthApiKeyServiceOptions } from './auth-api-key-service';
export { AuthApiKeyStore } from './auth-api-key-store';
export type {
  AuthApiKeyStoreCursor,
  AuthApiKeyStorePageInput,
  InsertAuthApiKeyInput,
} from './auth-api-key-store';
export type {
  AuthApiKeyAuthorityReference,
  AuthApiKeyCreatedVia,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyManagementCapabilities,
  AuthApiKeyMutationAuthority,
  AuthApiKeyPage,
  AuthApiKeyRecord,
  AuthApiKeyScopeKind,
  AuthApiKeyStatus,
  AuthApiKeySummary,
  AuthApiKeyTenantTarget,
  AuthRequestAuthorityReference,
  AuthRequestCredentialResolver,
  IssuedAuthApiKey,
} from './auth-api-key-types';
export { defineAuthAuditTables } from './auth-audit-schema';
export type {
  AppendAuthAuditEventInput,
  AuthAuditActor,
  AuthAuditActorProvenance,
  AuthAuditConfig,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditQuery,
  AuthAuditRequestContext,
  AuthAuditScopeKind,
  AuthAuditTarget,
  ResolvedAuthAuditConfig,
} from './auth-audit-types';
export { UserStore } from './user-store';
export { createDataRealmReadinessPlugin } from './data-realm-readiness.plugin';
export type {
  DataRealmReadinessPluginConfig,
  DataRealmReadinessRequest,
  DataRealmReadinessService,
} from './data-realm-readiness.plugin';
export {
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  parseDataRealmReadinessSnapshot,
} from './data-realm-readiness-types';
export type {
  DataRealmReadinessScope,
  DataRealmReadinessSdkSurface,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
} from './data-realm-readiness-types';
export { IdentityAnchorStore } from './identity-anchor-store';
export type { IdentityAnchorStoreOptions } from './identity-anchor-store';
export {
  IDENTITY_PROJECTION_ERROR_CODES,
  IdentityProjectionError,
  identityProjectionError,
} from './identity-projection-error';
export type { IdentityProjectionErrorCode } from './identity-projection-error';
export { createIdentityProjectionLifecycleHook } from './identity-projection-lifecycle';
export { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
export {
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
} from './identity-projection-schema';
export { IdentityProjectionService } from './identity-projection-service';
export type {
  IdentityProjectionLifecycleRoute,
  IdentityProjectionLifecycleRoutes,
} from './identity-projection-lifecycle';
export type {
  IdentityProjectionEnqueueResult,
  IdentityProjectionOutboxStoreOptions,
} from './identity-projection-outbox-store';
export type {
  IdentityProjectionServiceOptions,
} from './identity-projection-service';
export type {
  EnsureIdentityAnchorResult,
  IdentityAnchor,
  IdentityAnchorState,
  IdentityProjectionDelivery,
  IdentityProjectionDeliveryStatus,
  IdentityProjectionLifecycleHook,
  IdentityProjectionReceipt,
  IdentityProjectionTarget,
  IdentityProjectionTargetScope,
  IdentityProjectionTargetState,
  IdentityProjectionTargetStatus,
  MembershipIdentityAnchor,
  SynchronousIdentityProjectionTarget,
  UserIdentityAnchor,
} from './identity-projection-types';
export type {
  AtomicRegistrationPolicy,
  AuthGenerationReceipt,
  AuthSecurityAuditContext,
  CreateUserInput,
  PasswordAuthenticationProof,
  PasswordChangeAuthenticationAdmission,
  PasswordChangeAuthenticationReceipt,
  UserListOptions,
  UserStoreOptions,
} from './user-store';
export { TokenService } from './token-service';
export type { IssuedPageSession, WebRefreshProof } from './token-service';
export type { AuthPlatformCodeEmitter } from './auth-observability';
export { AuthSessionService } from './auth-session-service';
export { AuthRequestAdmissionService } from './auth-request-admission-service';
export { resolveAuthRequestAdmissionConfig } from './auth-request-admission-config';
export type {
  AuthRequestAdmissionConfig,
  AuthRequestAdmissionFlow,
  AuthRequestAdmissionFlowConfig,
  AuthRequestSourceContext,
  AuthRequestSourceResolver,
  ResolvedAuthRequestAdmissionConfig,
  ResolvedAuthRequestAdmissionFlowConfig,
} from './auth-request-admission-types';
export { AuthSessionStore } from './auth-session-store';
export { defineAuthSessionTables } from './auth-session-schema';
export { AuthTenantSessionService } from './auth-tenant-session-service';
export { AuthApplicationAdministrationService } from './auth-application-administration-service';
export { AuthTenantAdministrationService } from './auth-tenant-administration-service';
export {
  AuthPlatformTenantAdministrationService,
} from './auth-platform-tenant-administration-service';
export { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
export { VerifiedDomainOnboardingService } from './verified-domain-service';
export { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
export { defineAuthTenantOnboardingTables } from './auth-tenant-onboarding-schema';
export type {
  AcceptedTenantInvitation,
} from './auth-tenant-onboarding-service';
export type {
  AuthTenantInvitation,
  AuthTenantInvitationCreated,
  AuthTenantInvitationDeliveryMode,
  AuthTenantInvitationEmailTemplate,
  AuthTenantInvitationEmailTemplateContext,
  AuthTenantInvitationInspection,
  AuthTenantInvitationRecord,
  AuthTenantInvitationStatus,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRecord,
  AuthTenantJoinRequestRoleSelection,
  AuthTenantJoinRequestStatus,
  AuthTenantOnboardingConfig,
  AuthTenantRoleGrantCeiling,
  AuthVerifiedDomainOnboardingConfig,
  AuthVerifiedDomainTxtResolver,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
export type {
  AuthDomainOnboardingCompletion,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaimProjection,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainReleaseResult,
  DomainAdmissionIdentityBinding,
  DomainMailboxJobBinding,
} from './verified-domain-service';
export type {
  AuthApplicationAdministrationConfig,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleDescriptor,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserIdentity,
  AuthApplicationUserListInput,
  AuthApplicationUserPage,
} from './auth-application-administration-types';
export type {
  AuthPlatformTenant,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListInput,
  AuthPlatformTenantPage,
  AuthPlatformTenantUpdateResult,
} from './auth-platform-administration-types';
export type {
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberIdentity,
  AuthTenantMemberListInput,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  TenantRoleGrantCeiling,
} from './auth-tenant-administration-types';
export {
  AuthSessionContinuationStore,
} from './auth-session-continuation-store';
export {
  defineAuthSessionContinuationTables,
} from './auth-session-continuation-schema';
export type {
  AuthSessionKind,
  AuthSessionProvenance,
  AuthSessionRecord,
  AuthSessionScopeKind,
  AuthSessionStatus,
  PreparedWebSessionBinding,
  WebSessionBinding,
  WebSessionIssueOptions,
} from './auth-session-types';
export type {
  AuthSessionContinuationPurpose,
  AuthSessionContinuationRecord,
  AuthSessionContinuationStoreOptions,
  CreatedAuthSessionContinuation,
} from './auth-session-continuation-store';
export type {
  AuthTenantListResult,
  AuthTenantCreateInput,
  AuthTenantSessionCompletion,
  AuthTenantSummary,
  BoundAuthSessionCompletion,
  TenantOnboardingCompletion,
  TenantSelectionCompletion,
} from './auth-tenant-session-types';
export { AuthActionTokenService } from './action-token-service';
export { AccountEmailService } from './account-email-service';
export { MfaMethodStore } from './mfa-method-store';
export { MfaService } from './mfa-service';
export { MfaChallengeStore } from './mfa-challenge-store';
export { MfaChallengeService } from './mfa-challenge-service';
export type {
  MfaEnrollmentRollbackReceipt,
  MfaEnrollmentStart,
  MfaLoginChallengeRollbackReceipt,
  MfaLoginChallengeStart,
  MfaRequirementSource,
  PublicMfaChallenge,
  PublicMfaMethod,
} from './mfa-challenge-service';
export type {
  AdminMfaConfig,
  MfaReadiness,
  MfaReadinessInput,
  PublicMfaConfig,
} from './mfa-service';
export {
  defineAuthConfig,
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from './auth-config';
export {
  defineAuthEmailTemplates,
  resolveAuthEmailBranding,
} from './auth-email-templates';
export { UserPropertyService } from './user-property-service';
export {
  TenantStore,
  TenancyService,
  TENANT_OWNER_ROLE_KEY,
  TenancyError,
  defineTenancyTables,
} from './tenancy';
export type {
  CreateTenantMembershipInput,
  CreateTenantWithOwnerInput,
  TenantCreationResult,
  TenantKind,
  TenantOwnershipTransferResult,
  TenantMembershipRecord,
  TenantMembershipStatus,
  TenantRecord,
  TenantStatus,
  TenancyErrorCode,
} from './tenancy';

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  AuthEmailBrandingConfig,
  AuthEmailTemplate,
  AuthEmailTemplateContext,
  AuthEmailTemplateKey,
  AuthEmailTemplateResult,
  AuthEmailTemplates,
  ResolvedAuthEmailBranding,
} from './auth-email-templates';

export type {
  AuthContext,
  AuthContextAuthorityReference,
  UserRecord,
  TokenPair,
  AccessTokenPayload,
  AuthTransitionPurpose,
  AuthTransitionTokenPayload,
  RefreshTokenRecord,
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthMfaChallengeRecord,
  AuthMfaConfig,
  AuthMfaMethodRecord,
  AuthMfaMethodStatus,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  UserStatus,
  AuthPluginConfig,
  TokenServiceConfig,
  AuthAccountConfig,
  AuthAccountEmailConfig,
  AuthAdministrationTenantConfig,
  AuthAuthorizationConfig,
  AuthAuthorizationMode,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthAuthorizationOptions,
  AuthPermissionConfig,
  AuthPermissionScope,
  AuthRoleTemplateConfig,
  AuthBehaviorConfig,
  AuthBootstrapConfig,
  AuthBootstrapMode,
  AuthBootstrapOptions,
  AuthMfaTotpConfig,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  AuthApiKeyConfig,
  AuthApiKeyOptions,
  AuthTenancyConfig,
  AuthTenancyMode,
  AuthTenancyOptions,
  AuthTenantCreationConfig,
  AuthTenantCreationMode,
  AuthTenantTerminologyConfig,
  NormalizedAuthBehaviorConfig,
  ResolvedAuthAccountConfig,
  ResolvedAuthApiKeyConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthPermissionConfig,
  ResolvedAuthRoleTemplateConfig,
  ResolvedAuthBootstrapConfig,
  ResolvedAuthMfaConfig,
  ResolvedAuthMfaTotpConfig,
  ResolvedAuthTenancyConfig,
  ResolvedAuthRegistrationConfig,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
  UserPropertyEditableBy,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
  PermissionKey,
} from './types';

export { AuthError, AUTH_DEFAULTS } from './types';
export {
  defineNativeAuthConfig,
  resolveNativeAuthConfig,
} from './native';
export type {
  NativeAuthClientConfig,
  NativeAuthConfig,
  NativeAuthorizationRequestPolicyConfig,
  NativeAuthorizationSourceContext,
  NativeAuthorizationSourceResolver,
  NativeIdentityScope,
  NativeRefreshRotationPolicyConfig,
  NativeRedirectKind,
  ResolvedNativeAuthClientConfig,
  ResolvedNativeAuthConfig,
  ResolvedNativeAuthorizationRequestPolicy,
  ResolvedNativeRefreshRotationPolicy,
} from './native';
export type * from './auth-user-profile-types';
export type * from './auth-presence-types';
export type * from './auth-user-contact-types';
export type * from './auth-user-avatar-types';
export type * from './auth-user-profile-completion-types';
