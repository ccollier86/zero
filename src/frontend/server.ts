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
  AppConfig,
  AppTableInput,
  AutoLazyAction,
  ResolvedConfig,
  ResolvedSyncDefaults,
  ResolvedTableSyncDefault,
  SyncDefaultsConfig,
  TableSyncDefaultConfig,
} from './server/types';
export {
  createServerRoute,
} from './server/server-route';
export type { ServerRouteOptions } from './server/server-route';
export {
  createLazyServerRouteServices,
  getServerRouteServices,
} from './server/server-services';
export type {
  ServerAuthServices,
  ServerObservabilityServices,
  ServerRouteServices,
} from './server/server-services';
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
  ResourceLoaderError,
  ResourceRegistry,
  ResourceRegistryError,
  ZERO_RESOURCE_DEFINITION_KIND,
  adminOnly,
  allowsPublicAction,
  allOf,
  anyOf,
  authenticatedOnly,
  collectResourceFiles,
  configureResourceRegistry,
  createResourceCrudPlugin,
  createResourcePolicyUser,
  customPolicy,
  defineResource,
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
  requiresAuthenticatedUser,
  ResourceCrudService,
  sanitizeResourceCreateInput,
  sanitizeResourceUpdateInput,
  tableHasColumn,
  validateResourceDefinitions,
  validateResourcePolicy,
} from '../resources';
export type {
  ConfigureResourceRegistryOptions,
  CustomResourcePolicyCallback,
  CustomResourcePolicyOptions,
  OwnerPolicyCreateMode,
  OwnerPolicyOptions,
  RegisteredResourceDefinition,
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
  ResourceFieldConstraint,
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
  ResourcePolicyValidationCode,
  ResourcePolicyValidationContext,
  ResourcePolicyValidationIssue,
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

// ─── Platform Doctor ───────────────────────────────────────────────────
export { runPlatformDoctor } from '../doctor/platform-doctor';
export type {
  PlatformDoctorFinding,
  PlatformDoctorOptions,
  PlatformDoctorReport,
  PlatformDoctorSeverity,
} from '../doctor/platform-doctor';

// ─── Route Config ───────────────────────────────────────────────────────
export type { RouteConfig, LoaderContext, PageMeta } from './router/types';

// ─── Auth ───────────────────────────────────────────────────────────────
export { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
export { createAuthMiddleware } from '../auth/auth.middleware';
export { AccountEmailService } from '../auth/account-email-service';
export { AuthActionTokenService } from '../auth/action-token-service';
export {
  defineAuthConfig,
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from '../auth/auth-config';
export { UserPropertyService } from '../auth/user-property-service';
export { AuthError, AUTH_DEFAULTS } from '../auth/types';
export type {
  AuthAccountEmailConfig,
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthBehaviorConfig,
  AuthContext,
  AuthPluginConfig,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
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
export { createRoomPlugin, getRoomService } from '../rooms';
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
export { createWorkflowPlugin, getWorkflowService, getWorkflowRegistry } from '../workflows';
export { WORKFLOW_TABLES } from '../workflows';
export type {
  WorkflowPluginConfig,
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
