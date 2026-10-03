/**
 * Platform Frontend — SERVER-ONLY exports.
 *
 * These require bun:sqlite and must only be imported in server code
 * (app.ts entry point, server plugins, API routes).
 *
 * NEVER import from this file in client/browser code — it will crash the bundler.
 *
 * @example
 * // In app server entry (app.ts):
 * import { createApp } from '../src/frontend/server';
 * import { createSchedulerPlugin } from '../src/frontend/server';
 */

// ─── App Factory ────────────────────────────────────────────────────────
export { createApp } from './server/app-factory';
export type { App } from './server/app-factory';
export { defineZeroConfig, resolveConfig } from './server/types';
export type {
  AppDatabaseActorConfig,
  AppDatabaseHotPlacementConfig,
  AppDatabasePlacementConfig,
  AppDatabasePlacementPolicyConfig,
  AppDatabaseTopologyConfig,
  AppMultipleDatabaseTopologyConfig,
  AppSingleDatabaseTopologyConfig,
  AppConfig,
  AppDoctorConfig,
  AppStorageConfig,
  AppWorkflowsConfig,
  AppTableInput,
  AppTenantDataIsolation,
  AutoLazyAction,
  ResolvedConfig,
  ResolvedAppDatabaseTopologyConfig,
  ResolvedAppMultipleDatabaseTopologyConfig,
  ResolvedAppSingleDatabaseTopologyConfig,
  ResolvedAppStorageConfig,
  ResolvedSitemapConfig,
  ResolvedSyncDefaults,
  ResolvedTableSyncDefault,
  SitemapChangeFrequency,
  SitemapConfig,
  SitemapEntry,
  SyncAuthMode,
  SyncDefaultsConfig,
  SystemDatabaseConfig,
  TableSyncDefaultConfig,
} from './server/types';

// ─── Actor-backed Databases ─────────────────────────────────────────────
export {
  DATABASE_ACTOR_CHILD_FLAG,
  DATABASE_HOT_DEFAULT_DURABILITY,
  DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_SHORTHAND_MAX_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SOURCE_ROW_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_NODES,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_ROWS,
  DATABASE_TENANT_SYNC_SNAPSHOT_PAGE_MAX_SOURCE_BYTES,
  DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  DATABASE_WRITER_MAX_RECEIPT_KEYS,
  DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES,
  DATABASE_WRITER_MAX_RECEIPTS,
  DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES,
  databaseRealmContribution,
  defaultDatabaseHotSnapshotTimeoutMs,
  DatabaseError,
  createDatabaseRef,
  createNamedDatabaseRef,
  createTenantDatabaseRef,
  composeDatabaseRealm,
  defineDatabaseRealm,
  defineDatabaseRealmContribution,
  runDatabaseActorIfRequested,
} from '../databases';

// ─── Data Studio ───────────────────────────────────────────────────────
export {
  createDataStudioFeature,
  createDataStudioRouter,
  createDataStudioService,
  DATA_STUDIO_COMMAND_NAMES,
  DATA_STUDIO_DEFAULT_PAGE_SIZE,
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_ROWS_PER_TABLE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
  DATA_STUDIO_MAX_SCHEMA_VERSIONS,
  DATA_STUDIO_MAX_TABLES,
  DATA_STUDIO_QUERY_NAMES,
  DATA_STUDIO_REALM_CONTRIBUTION,
  DATA_STUDIO_RESOURCES,
  DataStudioService,
} from '../data-studio/server';
export type {
  DataStudioFeature,
  DataStudioMutationOptions,
  DataStudioMutationReceipt,
  DataStudioRowsRequest,
  DataStudioServiceActor,
  DataStudioServiceOptions,
  DataStudioServiceRowFilter,
  DataStudioTableCreateRequest,
  DataStudioTableUpdateRequest,
} from '../data-studio/server';
export type {
  AsyncDatabaseClient,
  DatabaseActorBundleLaunch,
  DatabaseActorCommandPrefixLaunch,
  DatabaseActorExecutorPolicy,
  DatabaseActorLaunch,
  DatabaseActorSourceLaunch,
  DatabaseActorSQLiteConfig,
  DatabaseAssertion,
  DatabaseBatchInput,
  DatabaseCommitResult,
  DatabaseCoordinatorRestartPolicy,
  DatabaseErrorCode,
  DatabaseFindFieldFilter,
  DatabaseFindFilter,
  DatabaseFindFilterGroup,
  DatabaseFindFilterOperator,
  DatabaseFindInput,
  DatabaseFindOrder,
  DatabaseFindRows,
  DatabaseHotDurability,
  DatabaseHotPlacementConfig,
  DatabaseListPage,
  DatabaseListPageOptions,
  DatabaseMutation,
  DatabaseMutationOptions,
  NormalizedDatabaseCoordinatorRestartPolicy,
  DatabaseOperationRow,
  DatabasePlacement,
  DatabasePlacementPolicy,
  DatabasePlacementSelector,
  DatabasePlacementSelectorContext,
  DatabaseReadOptions,
  DatabaseReadConsistency,
  DatabaseReadQueryConnection,
  DatabaseReadQueryContext,
  DatabaseReadQueryHandler,
  DatabaseReadQueryRegistry,
  DatabaseReadQueryStatement,
  DatabaseReadResult,
  DatabaseRef,
  DatabaseRealm,
  DatabaseRealmCompositionDefinition,
  DatabaseRealmContribution,
  DatabaseRealmContributionDefinition,
  DatabaseRealmDefinition,
  DatabaseSequenceToken,
  DatabaseSerializableValue,
  DatabaseTenantSyncSnapshotPage,
  DatabaseTenantSyncSnapshotSession,
  DatabaseWriteCommandCapability,
  DatabaseWriteCommandContext,
  DatabaseWriteCommandHandler,
  DatabaseWriteCommandRegistry,
  RunDatabaseActorIfRequestedOptions,
} from '../databases';
export {
  PdfError,
  PdfService,
  PlaywrightPdfRenderer,
  createPdfPlugin,
  getPdfService,
  requirePdfService,
  resolvePdfConfig,
} from '../pdf';
export type {
  PdfBrowserConfig,
  PdfConfig,
  PdfLimitsConfig,
  PdfPrintOptions,
  PdfRenderInput,
  PdfRenderer,
  PdfRenderResult,
  PdfResourcePolicyConfig,
  PdfServiceStatus,
  PdfStorageTarget,
  PdfStoredResult,
  ResolvedPdfConfig,
} from '../pdf';
export type {
  EffectiveRouteAuthRequirement,
  RouteAuthMode,
  RouteAuthRequirement,
} from './router/auth-policy';
export {
  isPublicPath,
  mergeRouteAuthRequirements,
  normalizeRouteAuthRequirement,
  resolveRouteAuthMode,
  shouldRequireAuthForRoute,
} from './router/auth-policy';
export {
  createServerRoute,
  UnsafeServerServiceAccessError,
} from './server/server-route';
export type {
  ServerRequestServices,
  ServerRouteOptions,
} from './server/server-route';
export type {
  ScopedWorkflowInstanceListFilter,
  ScopedWorkflowService,
} from './server/server-request-services';
export {
  createLazyServerRouteServices,
  getServerRouteServices,
} from './server/server-services';
export type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
  ServerSystemDatabaseServices,
} from './server/server-services';
export { createWorkflowExecutionServiceProvider } from './server/workflow-execution-services';
export type {
  CreateWorkflowExecutionServiceProviderOptions,
  WorkflowExecutionAuthServices,
  WorkflowExecutionObservabilityServices,
  WorkflowExecutionServerServices,
} from './server/workflow-execution-services';
export {
  ZERO_SERVER_EXTENSION_KIND,
  applyServerExtension,
  createServerExtensionApp,
  createServerExtensionBundle,
  defineEndpoint,
  defineMiddleware,
  defineRouter,
  defineZeroPlugin,
  isServerRoutePlugin,
  isZeroServerExtension,
} from './server/server-extensions';
export type {
  AnyZeroEndpointDefinition,
  AnyZeroMiddlewareDefinition,
  InferValidationSchema,
  ZeroEndpointDefinition,
  ZeroEndpointOptions,
  ZeroExtensionAuthRequirement,
  ZeroLifecycleContext,
  ZeroLifecycleHook,
  ZeroLifecycleUser,
  ZeroMiddlewareDefinition,
  ZeroMiddlewareOptions,
  ZeroPluginDefinition,
  ZeroPluginOptions,
  ZeroPluginSetupContext,
  ZeroRouterChild,
  ZeroRouterDefinition,
  ZeroRouterOptions,
  ZeroServerExtension,
  ZeroServerExtensionKind,
  ZeroServerExtensionMountable,
} from './server/server-extensions';
export {
  evaluateMiddlewareApplicability,
  inheritMatcherAuth,
  normalizeHttpMethod,
  normalizeMiddlewareMatcher,
} from './server/server-matcher';
export type {
  MaybePromise as ZeroMaybePromise,
  ZeroAuthRequirement,
  ZeroHttpMethod,
  ZeroHttpMethodInput,
  ZeroMatcherContext,
  ZeroMatcherEvaluation,
  ZeroMiddlewareMatcher,
  ZeroPathMatcher,
  ZeroPolicyScalar,
  ZeroPropertyRequirement,
  ZeroRouteMatcher,
} from './server/server-matcher';
export {
  enforceServerPolicy,
  evaluateServerPolicy,
  getEffectiveAuthRequirement,
} from './server/server-policy';
export type {
  ZeroPolicyContext,
  ZeroPolicyDenyReason,
  ZeroPolicyEvaluation,
  ZeroPolicyEvaluationOptions,
  ZeroPolicyUserPropertyRegistry,
  ZeroPolicyUserPropertyStore,
} from './server/server-policy';
export {
  ServerRouteLoaderError,
  collectServerRouteFiles,
  loadServerRoutePlugins,
} from './server/server-route-loader';
export type { ServerRouteLoaderOptions, ServerRoutePlugin } from './server/server-route-loader';

// ─── Resources: Server ─────────────────────────────────────────────────
export {
  RESOURCE_ACTIONS,
  RESOURCE_EXPOSURES,
  ResourceLoaderError,
  ResourceRegistry,
  ResourceRegistryError,
  ZERO_RESOURCE_DEFINITION_KIND,
  adminOnly,
  allowsPublicAction,
  allOf,
  anyOf,
  authorizationPolicy,
  authenticatedOnly,
  collectResourceFiles,
  configureResourceRegistry,
  createResourceCrudPlugin,
  createResourcePolicyUser,
  customPolicy,
  defineResource,
  defineResourceFields,
  globalRealm,
  guardianActorPolicy,
  evaluateResourcePolicy,
  getPolicyMetadataKeys,
  getPolicyOwnerFields,
  getResourceTableColumns,
  getResourceRegistry,
  hasCustomPolicyBranch,
  inferTablePrimaryKey,
  isResourceDefinition,
  isResourceInputError,
  isResourcePolicy,
  loadResourceDefinitions,
  metadataPolicy,
  ownerPolicy,
  publicReadUserWrite,
  quoteResourceIdentifier,
  readOnly,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
  requiresAuthenticatedUser,
  ResourceCrudService,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
  tableHasColumn,
  tenantKindPolicy,
  tenantRealm,
  validateResourceDefinitions,
  validateResourcePolicy,
  validateAuthorizationPolicy,
  validateGuardianActorPolicy,
} from '../resources';
export type {
  ConfigureResourceRegistryOptions,
  CustomResourcePolicyCallback,
  CustomResourcePolicyOptions,
  GuardianActorPolicyOptions,
  OwnerPolicyCreateMode,
  OwnerPolicyOptions,
  RegisteredResourceDefinition,
  RegisteredResourceExposure,
  RegisteredResourceStorage,
  ResourceAction,
  ResourceCrudFailure,
  ResourceCrudPluginConfig,
  ResourceCrudRequestContext,
  ResourceCrudResult,
  ResourceCrudRoutesConfig,
  ResourceCrudServiceOptions,
  ResourceCrudSuccess,
  ResourceDataConstraint,
  ResourceDefinition,
  ResourceDefinitionOptions,
  ResourceExposure,
  ResourceRealm,
  ResourceRealmInput,
  ResourceTableInput,
  GlobalResourceRealm,
  TenantResourceRealm,
  ResourceFieldConstraint,
  ResourceFieldAccess,
  ResourceFieldAccessInput,
  ResourceFieldWriteError,
  ResourceInputError,
  ResourceInputValue,
  ResourceListQueryInput,
  ResourceListQueryPlan,
  ResourceListQueryPlanOptions,
  ResourceLoaderOptions,
  ResourceMetadataRequirement,
  ResourceMetadataRequirementOperators,
  ResourceMetadataRequirements,
  ResourceMaybePromise,
  ResourcePolicy,
  ResourcePolicyAuthConfig,
  ResourcePolicyAuthorizationContext,
  ResourcePolicyContext,
  ResourcePolicyDecision,
  ResourcePolicyDecisionInput,
  ResourcePolicyDiagnostics,
  ResourcePolicyDenyReason,
  ResourcePolicyInput,
  ResourcePolicyKind,
  ResourcePolicyResource,
  ResourcePolicyScalar,
  ResourcePolicyStaticDecision,
  ResourcePolicyUser,
  ResourceQueryError,
  ResourceRegistryIssue,
  ResourceRegistryIssueCode,
  ResourceRegistryValidationContext,
  ResourceTenantIsolation,
  ResourcePolicyValidationCode,
  ResourcePolicyValidationContext,
  ResourcePolicyValidationIssue,
  ResourceAuthorizationRequirement,
} from '../resources';

// ─── Sync / ReactiveDB: Server ─────────────────────────────────────────
export {
  ReactiveDB,
  allowAllSyncPolicy,
  combineSyncPolicies,
  createDefaultSyncPolicy,
  createReactiveDB,
  evaluateSyncMutationPolicy,
  evaluateSyncReadPolicy,
  getEphemeralManager,
  getReadableSyncTables,
  getSyncDB,
} from '../sync';
export type {
  Change,
  ChangeListener,
  ChangeOp,
  DeclaredSyncMode,
  DefaultSyncPolicyConfig,
  EphemeralErrorCode,
  EphemeralErrorMessage,
  EphemeralKeyOwnership,
  EphemeralTopicDecision,
  EphemeralTopicOperation,
  EphemeralTopicPolicy,
  EphemeralTopicPolicyContext,
  ReactiveDBConfig,
  Row,
  SyncMutationPolicyContext,
  SyncPolicy,
  SyncPolicyDecision,
  SyncPolicyEvaluation,
  SyncReadPolicyContext,
  TableSchema,
} from '../sync';

// ─── Persistence: Server ────────────────────────────────────────────────
export {
  createPlatformSQLiteService,
  getPlatformSQLiteService,
  requirePlatformSQLiteService,
} from '../persistence';
export type {
  PlatformSQLiteDiagnostics,
  PlatformSQLiteService,
  SQLiteStorageConfig,
  SQLiteStorageMode,
} from '../persistence';

// ─── KV / Cache: Server ─────────────────────────────────────────────────
export {
  KvCheckpointStore,
  KvCounterService,
  KvError,
  KvFileJournal,
  KvLimiterService,
  KvMemoryEngine,
  KvNamespace,
  KvService,
  KvTtlIndex,
  clearKvService,
  createKvPlugin,
  getKvService,
  recoverKvMemoryEngine,
} from '../kv';
export type {
  KvClock,
  KvCompareAndSetResult,
  KvCounterOptions,
  KvEvictionPolicy,
  KvFixedWindowOptions,
  KvJournalDurability,
  KvLimiterResult,
  KvMemoryEngineOptions,
  KvMemoryEngineStats,
  KvPluginConfig,
  KvRecoveryCorruptRecordPolicy,
  KvRecoveryResult,
  KvServiceConfig,
  KvServiceStatus,
  KvSetOptions,
  KvSlidingWindowOptions,
  KvTokenBucketOptions,
  ZeroKvEntry,
  ZeroKvKind,
} from '../kv';

// ─── Platform Doctor ───────────────────────────────────────────────────
export { runPlatformDoctor } from '../doctor/platform-doctor';
export type {
  PlatformDoctorFinding,
  PlatformDoctorOptions,
  PlatformDoctorReport,
  PlatformDoctorSeverity,
} from '../doctor/platform-doctor';
export {
  runUsageAudit,
} from '../doctor/usage-audit';
export type {
  UsageAuditAllowEntry,
  UsageAuditOptions,
  UsageAuditRuleSeverity,
} from '../doctor/usage-audit';

// ─── Route Config ───────────────────────────────────────────────────────
export type { RouteConfig, LoaderContext, PageMeta } from './router/types';

// ─── Auth ───────────────────────────────────────────────────────────────
export {
  createAuthPlugin,
  getAuthApiKeyService,
  getAuthRequestCredentialResolver,
  getAuthorizationKernel,
  getAuthStore,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getTokenService,
} from '../auth/auth.plugin';
export {
  createAuthMiddleware,
  createProtectedMultipartRequestGuard,
  resolveRequestAuthContext,
  resolveRequestAuthorizationAccess,
} from '../auth/auth.middleware';
export type {
  AuthMiddlewareAuthorizationOptions,
  ProtectedMultipartPathMatcher,
  ProtectedMultipartRequestGuardOptions,
  ZeroElysiaAuthRequirement,
} from '../auth/auth.middleware';
export { installAuthStopBarrier } from '../auth/auth-stop-lifecycle';
export { AuthRuntime, createAuthRuntime } from '../auth/auth-runtime';
export type { AuthRuntimeDependencies } from '../auth/auth-runtime';
export {
  AuthorizationKernel,
  compileAccessRequirement,
  createAuthorizationKernel,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  validateAuthorizationRegistry,
  validatePermissionKey,
  validateRoleKey,
} from '../auth/authorization-kernel';
export {
  createAuthorizationSubjectSnapshot,
  createRequestAuthorizationAccess,
} from '../auth/authorization-access';
export type {
  AuthorizationPropertyStore,
  CreateRequestAuthorizationAccessOptions,
  RequestAuthorizationAccess,
  TenantAuthorizationScope,
} from '../auth/authorization-access';
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
} from '../auth/authorization-kernel';
export { AccountEmailService } from '../auth/account-email-service';
export { AuthActionTokenService } from '../auth/action-token-service';
export { MfaChallengeStore } from '../auth/mfa-challenge-store';
export { MfaChallengeService } from '../auth/mfa-challenge-service';
export { MfaMethodStore } from '../auth/mfa-method-store';
export { MfaService } from '../auth/mfa-service';
export type {
  AdminMfaConfig,
  MfaReadiness,
  MfaReadinessInput,
  PublicMfaConfig,
} from '../auth/mfa-service';
export {
  defineAuthConfig,
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from '../auth/auth-config';
export {
  defineNativeAuthConfig,
  resolveNativeAuthConfig,
} from '../auth/native';
export type {
  NativeAuthClientConfig,
  NativeAuthConfig,
  NativeAuthorizationRequestPolicyConfig,
  NativeAuthorizationSourceContext,
  NativeAuthorizationSourceResolver,
  NativeRefreshRotationPolicyConfig,
  ResolvedNativeAuthConfig,
} from '../auth/native';
export {
  defineAuthEmailTemplates,
  resolveAuthEmailBranding,
} from '../auth/auth-email-templates';
export { UserPropertyService } from '../auth/user-property-service';
export { AuthError, AUTH_DEFAULTS } from '../auth/types';
export { createDataRealmReadinessPlugin } from '../auth/data-realm-readiness.plugin';
export type {
  DataRealmReadinessPluginConfig,
  DataRealmReadinessRequest,
  DataRealmReadinessService,
} from '../auth/data-realm-readiness.plugin';
export type {
  DataRealmReadinessScope,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
} from '../auth/data-realm-readiness-types';
export { AuthApiKeyService } from '../auth/auth-api-key-service';
export type { AuthApiKeyServiceOptions } from '../auth/auth-api-key-service';
export { AuthApiKeyStore } from '../auth/auth-api-key-store';
export type {
  AuthApiKeyStoreCursor,
  AuthApiKeyStorePageInput,
  InsertAuthApiKeyInput,
} from '../auth/auth-api-key-store';
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
} from '../auth/auth-api-key-types';
export type {
  AuthEmailBrandingConfig,
  AuthEmailTemplate,
  AuthEmailTemplateContext,
  AuthEmailTemplateKey,
  AuthEmailTemplateResult,
  AuthEmailTemplates,
  ResolvedAuthEmailBranding,
} from '../auth/auth-email-templates';
export type {
  AuthAccountConfig,
  AuthAccountEmailConfig,
  AuthAdministrationTenantConfig,
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthAuthorizationConfig,
  AuthAuthorizationMode,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthAuthorizationOptions,
  AuthPermissionConfig,
  AuthRoleTemplateConfig,
  AuthBehaviorConfig,
  AuthBootstrapConfig,
  AuthBootstrapMode,
  AuthBootstrapOptions,
  AuthContext,
  AuthMfaChallengeRecord,
  AuthMfaConfig,
  AuthMfaMethodRecord,
  AuthMfaMethodStatus,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  AuthMfaTotpConfig,
  AuthPermissionScope,
  AuthPluginConfig,
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
  AuthTransitionPurpose,
  AuthTransitionTokenPayload,
  NormalizedAuthBehaviorConfig,
  ResolvedAuthAccountConfig,
  ResolvedAuthApiKeyConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthPermissionConfig,
  ResolvedAuthRoleTemplateConfig,
  ResolvedAuthBehaviorConfig,
  ResolvedAuthBootstrapConfig,
  ResolvedAuthMfaConfig,
  ResolvedAuthMfaTotpConfig,
  ResolvedAuthRegistrationConfig,
  ResolvedAuthTenancyConfig,
  ResolvedUserPropertyFieldConfig,
  PermissionKey,
  UserStatus,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
  UserRecord,
} from '../auth/types';

// ─── Platform Tokens: Server ────────────────────────────────────────────
export {
  PLATFORM_TOKEN_DEFAULTS,
  PlatformTokenError,
  PlatformTokenService,
  PlatformTokenStore,
  configurePlatformTokens,
  createPlatformTokenPlugin,
  definePlatformTokenTables,
  getPlatformTokenService,
  getPlatformTokenStore,
  resetPlatformTokens,
} from '../tokens';
export type {
  CreatePlatformActionTokenOptions,
  CreatePlatformResumeTokenOptions,
  CreatedPlatformActionToken,
  CreatedPlatformResumeToken,
  PlatformActionTokenLookupOptions,
  PlatformActionTokenRecord,
  PlatformResumeResource,
  PlatformResumeTokenLookupOptions,
  PlatformResumeTokenRecord,
  PlatformTokenCreateBase,
  PlatformTokenPluginConfig,
  PlatformTokenServiceConfig,
  PlatformTokenSubject,
  RotatePlatformResumeTokenOptions,
} from '../tokens';

// ─── Schema ─────────────────────────────────────────────────────────────
export { defineSchema, defineTable, schema, field } from '../schema';
export type {
  SchemaDescriptor,
  TableDefinition,
  SchemaConfig,
  Schema,
  FieldType,
  FieldMeta,
  FieldDef,
  InferSchemaType,
  InferSchemaInput,
  Register,
  TableNames,
  TableRow as InferTableRow,
} from '../schema';

// ─── Rooms: Server ──────────────────────────────────────────────────────
export {
  RoomOwnerCannotLeaveError,
  createRoomPlugin,
  getRoomService,
} from '../rooms';
export { PresenceService } from '../rooms';
export type { PresenceStatus, PresenceData } from '../rooms';
export { ROOM_TABLES } from '../rooms/types';

// ─── Notifications: Server ──────────────────────────────────────────────
export { createNotificationPlugin, getNotificationService } from '../notifications';
export type { NotificationPluginConfig } from '../notifications';
export { NOTIFICATION_TABLES } from '../notifications/types';

// ─── Scheduler ──────────────────────────────────────────────────────────
export { createSchedulerPlugin, getScheduler } from '../scheduler';
export type { JobDefinition, JobStatus, SchedulerPluginConfig } from '../scheduler';

// ─── Workflows: Server ──────────────────────────────────────────────────
export {
  createWorkflowPlugin,
  getWorkflowService,
  getWorkflowRegistry,
  stopWorkflowRuntime,
} from '../workflows';
export { WORKFLOW_TABLES } from '../workflows';
export type {
  WorkflowPluginConfig,
  WorkflowExecutionIdentity,
  WorkflowExecutionServiceProvider,
  WorkflowResolvedExecutionAuthority,
  WorkflowServiceOptions,
  WorkflowSystemExecutionOptions,
} from '../workflows';

// ─── Storage: Server ────────────────────────────────────────────────────
export { createStoragePlugin, getStorageService } from '../storage';
export { StorageService, StorageError, defineStorageTables, LocalStorageAdapter } from '../storage';
export {
  createPresignedToken,
  createUploadGrantToken,
  detectMimeType,
  verifyPresignedToken,
  verifyUploadGrantToken,
} from '../storage';
export { STORAGE_TABLES } from '../storage';
export type {
  StorageAdapter,
  StoragePluginConfig,
  DriveRecord,
  FileInfo,
  CreateDriveParams,
  UploadOptions,
  CreateUploadGrantParams,
  StorageUploadGrant,
  StorageUploadGrantResource,
  ListResult,
  DriveUsage,
  PermissionLevel,
  GrantPermissionParams,
  StorageDriveApi,
  StorageDriveUpdates,
  StorageObjectApi,
  StoragePermissionApi,
  StorageServiceOptions,
  StorageUploadGrantApi,
  CreateUploadGrantTokenOptions,
  VerifiedUploadGrant,
} from '../storage';

// ─── Email: Server ──────────────────────────────────────────────────────
export {
  ConsoleEmailProvider,
  EmailError,
  EmailService,
  MemoryEmailProvider,
  NoopEmailProvider,
  ResendEmailProvider,
  configureEmail,
  getEmailRuntime,
  getEmailService,
} from '../email';
export type {
  AppIdentityConfig,
  BuiltInEmailProvider,
  EmailConfig,
  EmailMessage,
  EmailProvider,
  EmailRuntime,
  EmailSendResult,
  ResendEmailProviderConfig,
} from '../email';

// ─── AI: Server ───────────────────────────────────────────────────────────
export {
  AIConversationBuilder,
  AIConversationSessionBuilder,
  AIError,
  AIService,
  aiTool,
  createAIWorkflowHandler,
  createAIPlugin,
  createAIRegistry,
  createMetaLlama,
  defineAITools,
  getAI,
  isAIModelActive,
  metaLlama,
  parseAIModelReference,
  resolveAIConfig,
  toModelMessages,
} from '../ai';
export type {
  AIConfig,
  AIConversation,
  AIConversationOptions,
  AIConversationSession,
  AIConversationSessionOptions,
  AICapability,
  AIGenerateConversationRequest,
  AIGenerateSpeechRequest,
  AIGenerateTextRequest,
  AIEmbedRequest,
  AIEmbedResult,
  AIImageResult,
  AIMessage,
  AIMessageContent,
  AIProviderCapabilities,
  AIProviderConfig,
  AIProviderStatus,
  AIProviderType,
  AIRequestOptions,
  AISpeechResult,
  AIStatus,
  AIStatusEndpointConfig,
  AIStreamResult,
  AITextResult,
  AITranscriptionResult,
  AITranscribeRequest,
  AIWorkflowHandlerOptions,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from '../ai';

// ─── Vector Store: Server ─────────────────────────────────────────────────
export {
  VectorError,
  VectorRegistry,
  VectorScope,
  VectorService,
  ZvecAdapter,
  buildZvecFilter,
  createAIVectorBridge,
  createVectorPlugin,
  extractSimpleEqualityMetadata,
  getVectorFilterFields,
  getVectorStore,
  mergeVectorFilters,
  recordMatchesVectorFilter,
  resolveVectorConfig,
} from '../vector';
export type {
  AIVectorBridge,
  AIVectorBridgeOptions,
  AIVectorRecordInput,
  AIVectorTextQuery,
  ResolvedVectorConfig,
  ResolvedVectorIndexConfig,
  ResolvedVectorMetadataFieldConfig,
  ScopedAIVectorBridge,
  StoredVectorRecord,
  VectorConfig,
  VectorDeleteResult,
  VectorFetchOptions,
  VectorFilter,
  VectorFilterOperators,
  VectorFilterValue,
  VectorIndexConfig,
  VectorIndexStore,
  VectorIndexType,
  VectorMetadata,
  VectorMetadataFieldConfig,
  VectorMetadataFieldInput,
  VectorMetadataFieldType,
  VectorMetric,
  VectorOperationIssue,
  VectorQueryOptions,
  VectorQueryTuningConfig,
  VectorRecord,
  VectorScalar,
  VectorStats,
  VectorValue,
  VectorWriteResult,
} from '../vector';

// ─── Observability: Server ──────────────────────────────────────────────
export {
  CompositeSink,
  ConsoleSink,
  MemoryEventStore,
  OBS_CODES,
  configureObservability,
  createObservabilityPlugin,
  emitPlatformCode,
  emitPlatformEvent,
  errorPlatform,
  getObservabilityRuntime,
  getPlatformEventStore,
  getPlatformSink,
  logPlatformInfo,
  setPlatformSink,
  warnPlatform,
} from '../observability';
export type {
  ObservabilityConfig,
  ObservabilityEndpointAccess,
  ObservabilityEndpointConfig,
  ObservabilityEndpointReadMode,
  ObservabilityPluginConfig,
  ObservabilityTraceConfig,
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventLevel,
  PlatformEventPage,
  PlatformEventQuery,
  PlatformEventSource,
  PlatformEventStore,
  PlatformObservabilityRuntime,
  PlatformSink,
} from '../observability';
