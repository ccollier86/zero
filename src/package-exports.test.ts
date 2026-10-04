/**
 * package-exports.test.ts
 *
 * Verifies the package-mode import contract used by generated apps. This test
 * owns public export resolution only; feature behavior is tested in each
 * subsystem's dedicated tests.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'bun:test';

const smokeDir = join(process.cwd(), '.zero/package-export-smoke');

describe('package exports', () => {
  beforeEach(async () => {
    await rm(smokeDir, { recursive: true, force: true });
    await mkdir(smokeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(smokeDir, { recursive: true, force: true });
  });

  test('server-facing package subpaths build through the export map', async () => {
    await buildSmokeEntry('server.ts', serverSmokeSource, 'bun');
  }, 120_000);

  test('client-facing package subpaths build through the export map', async () => {
    await buildSmokeEntry('client.tsx', clientSmokeSource, 'browser');
  }, 120_000);

  test('native auth package subpath builds without React or server imports', async () => {
    await buildSmokeEntry('native.ts', nativeSmokeSource, 'browser');
  }, 120_000);
});

async function buildSmokeEntry(fileName: string, source: string, target: 'bun' | 'browser'): Promise<void> {
  const entrypoint = join(smokeDir, fileName);
  await writeFile(entrypoint, source);

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: join(smokeDir, `${fileName}-dist`),
    target,
  });

  if (!result.success) {
    const details = result.logs.map((log) => log.message).join('\n');
    throw new Error(details || `Failed to build ${fileName}`);
  }
}

const serverSmokeSource = `
import { Database } from 'bun:sqlite';
import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_TYPES,
  AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES,
  AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES,
  AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES,
  AI_DURABLE_AGENT_STATE_VERSION,
  AIAgentRunner,
  AIAgentService,
  AIDurableAgentService,
  AIDurableAgentWorkflowRuntime,
  AIOutput,
  AIService,
  createAIHostedFilesService,
  createAIModelExecutionPreparer,
  createAIVideoService,
  defineAIAgent,
  defineAIAgentTool,
  prepareDirectAIModelExecution,
  type AIAgentDefinition,
  type AIDurableAgentProgress,
  type AIDurableAgentRuntimeOptions,
  type AIAzureTokenProvider,
  type AIBedrockCredentialProvider,
  type AIEmbedManyRequest,
  type AIGenerateImageRequest,
  type AIGenerateVideoRequest,
  type AIFetchFunction,
  type AIHostedFileLocator,
  type AIProviderOptions,
  type AIProviderInstanceSettings,
  type AIModelExecutionRequest,
  type AIPrepareModelExecution,
  type AIServiceOptions,
  type AIRerankRequest,
  type RegisteredAIDurableAgent,
  type ResolvedAIProviderCapabilities,
} from '@zero/framework/ai';
import {
  ADMINISTRATION_TENANT_ROLE_KEYS,
  AuthApplicationAdministrationService,
  AuthApiKeyService,
  AuthApiKeyStore,
  AuthAuditService,
  AuthPlatformTenantAdministrationService,
  AuthTenantAdministrationService,
  AuthorizationKernel,
  FRAMEWORK_PLATFORM_ADMINISTRATION_PERMISSIONS,
  captureAuthApplicationMutationAuthority,
  captureAuthTenantMutationAuthority,
  compileAccessRequirement,
  createAuthAuthorizationSnapshot,
  createAuthPlugin,
  createAuthorizationKernel,
  createDataRealmReadinessPlugin,
  createIdentityProjectionLifecycleHook,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  getAuthAuditService,
  IDENTITY_PROJECTION_ERROR_CODES,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
  IdentityAnchorStore,
  IdentityProjectionError,
  IdentityProjectionOutboxStore,
  IdentityProjectionService,
  identityProjectionError,
  installAuthStopBarrier,
  isAdministrationOnlyRole,
  isAdministrationTenantRoleKey,
  isPolicyTrustedUserProperty,
  isRoleAssignableToTenantKind,
  parseDataRealmReadinessSnapshot,
  type NativeAuthorizationSourceResolver as AuthNativeSourceResolver,
} from '@zero/framework/auth';
import type {
  AccessRequirement,
  AuthAdministrationTenantConfig,
  AuthApiKeyManagementCapabilities,
  AuthApplicationAdministrationConfig,
  AuthApiKeyServiceOptions,
  AuthRequestCredentialResolver,
  AuthAuditEvent,
  AuthAuditQuery,
  AuthAuthorizationConfig,
  AuthAuthorizationSnapshot,
  AuthAuthorizationMode,
  AuthPermissionScope,
  AuthPlatformTenantPage,
  AssertAuthApplicationMutationAuthority,
  AssertAuthTenantMutationAuthority,
  AtomicRegistrationPolicy,
  AuthPlatformCodeEmitter,
  AuthSecurityAuditContext,
  NormalizedAuthBehaviorConfig,
  PermissionKey,
  AuthTenancyConfig,
  AuthTenancyMode,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthTenancyConfig,
  AuthTenantAdministrationConfig,
  AuthTenantInvitationDeliveryMode,
  AuthTenantInvitationEmailTemplate,
  AuthTenantInvitationEmailTemplateContext,
  AuthApplicationMutationAuthority,
  AuthTenantMutationAuthority,
  CreateUserInput,
  IdentityAnchorStoreOptions,
  IdentityProjectionErrorCode,
  IdentityProjectionLifecycleRoutes,
  SynchronousIdentityProjectionTarget,
  IssuedPageSession,
  TenantKind,
  UserListOptions,
  UserStoreOptions,
  WebRefreshProof,
} from '@zero/framework/auth';
import {
  defineDatabaseAutomations,
  defineDatabaseFunction,
  defineDatabaseTrigger,
} from '@zero/framework/database-automations';
import {
  checkDatabaseAutomations,
  runPlatformDoctor,
  runUsageAudit,
} from '@zero/framework/doctor';
import {
  createDataStudioFeature as createDataStudioFeatureSubpath,
  createDataStudioRouter as createDataStudioRouterSubpath,
  DataStudioService as DataStudioServiceSubpath,
} from '@zero/framework/data-studio/server';
import type {
  DataStudioFeature as DataStudioFeatureSubpath,
  DataStudioMutationReceipt as DataStudioMutationReceiptSubpath,
} from '@zero/framework/data-studio/server';
import { EmailService } from '@zero/framework/email';
import {
  createKvPlugin as createKvPluginSubpath,
  getKvService as getKvServiceSubpath,
  KvMemoryEngine as KvMemoryEngineSubpath,
  KvService as KvServiceSubpath,
} from '@zero/framework/kv';
import { Migrator } from '@zero/framework/migrations';
import { createNotificationPlugin } from '@zero/framework/notifications';
import { OBS_CODES } from '@zero/framework/observability';
import { OBS_CODES as PURE_OBS_CODES } from '@zero/framework/observability/codes';
import { createPlatformSQLiteService, SnapshotManager } from '@zero/framework/persistence';
import { PdfService, getPdfService as getPdfServiceSubpath } from '@zero/framework/pdf';
import {
  createResourceCrudPlugin as createSubpathResourceCrudPlugin,
  defineResource as defineSubpathResource,
  defineResourceFields as defineSubpathResourceFields,
  guardianActorPolicy as resourcesGuardianActorPolicy,
  ownerPolicy as resourcesOwnerPolicy,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS as subpathResourceReceiptMaxKeys,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES as subpathResourceReceiptMaxResultBytes,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES as subpathResourceReceiptMaxRetainedBytes,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT as subpathResourceReceiptRetainedLimit,
  tenantKindPolicy as resourcesTenantKindPolicy,
  tenantRealm as resourcesTenantRealm,
} from '@zero/framework/resources';
import {
  RoomOwnerCannotLeaveError,
  createRoomPlugin,
} from '@zero/framework/rooms';
import { createSchedulerPlugin } from '@zero/framework/scheduler';
import {
  defineTable,
  encodeFieldValue,
  field,
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  GUARDIAN_TABLE_REFERENCES,
  hasGuardianTableReferences,
} from '@zero/framework/schema';
import type {
  GuardianFieldReference,
  GuardianReferenceKind,
  GuardianTableReferenceMetadata,
} from '@zero/framework/schema';
import {
  adminOnly,
  AuthApiKeyService as ServerAuthApiKeyService,
  AuthApiKeyStore as ServerAuthApiKeyStore,
  createApp,
  AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES as SERVER_AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES as SERVER_AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES,
  createAIModelExecutionPreparer as createServerAIModelExecutionPreparer,
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
  defaultDatabaseHotSnapshotTimeoutMs,
  DatabaseError,
  databaseRealmContribution,
  composeDatabaseRealm,
  createDataRealmReadinessPlugin as createServerDataRealmReadinessPlugin,
  createDatabaseRef,
  createNamedDatabaseRef,
  createTenantDatabaseRef,
  createAuthorityScopedServerServices,
  createAuthorizationKernel as createServerAuthorizationKernel,
  createResourceCrudPlugin,
  createUploadGrantToken,
  defineAuthConfig,
  defineNativeAuthConfig,
  defineDatabaseRealm,
  defineDatabaseRealmContribution,
  defineResource,
  defineResourceFields as defineServerResourceFields,
  getAI,
  getEmailService,
  getKvService,
  getPlatformTokenService,
  getPlatformSQLiteService,
  getPdfService,
  getResourceRegistry,
  getVectorStore,
  getWorkflowService,
  installAuthStopBarrier as installServerAuthStopBarrier,
  createKvPlugin,
  KvMemoryEngine,
  KvService,
  metadataPolicy,
  ownerPolicy,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
  tenantKindPolicy,
  tenantRealm,
  runDatabaseActorIfRequested,
  verifyUploadGrantToken,
} from '@zero/framework/server';
import type {
  AppConfig,
  AppDatabasePlacementConfig,
  AppWorkflowRegistrationContext,
  AIServiceOptions as ServerAIServiceOptions,
  AIPrepareModelExecution as ServerAIPrepareModelExecution,
  AuthAdministrationTenantConfig as ServerAuthAdministrationTenantConfig,
  AuthApiKeyManagementCapabilities as ServerAuthApiKeyManagementCapabilities,
  AuthApiKeyServiceOptions as ServerAuthApiKeyServiceOptions,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthPermissionScope as ServerAuthPermissionScope,
  AuthTenantCreationConfig,
  AuthTenantCreationMode,
  AuthTenantTerminologyConfig,
  NativeAuthorizationSourceResolver,
  AsyncDatabaseClient,
  AuthorityScopedAuthServices,
  AuthorityScopedObservabilityServices,
  AuthorityScopedServerServices,
  CreateAuthorityScopedServerServicesOptions,
  ScopedNotificationService,
  ScopedPdfService,
  ScopedPdfStorageTarget,
  ScopedRoomService,
  ScopedStorageDriveApi,
  ScopedStorageObjectApi,
  ScopedStoragePermissionApi,
  ScopedStorageService,
  ScopedStorageUploadGrantApi,
  StorageAdapterOperationOptions as ServerStorageAdapterOperationOptions,
  StorageBlobWriteResult as ServerStorageBlobWriteResult,
  StoragePendingBlobPublication as ServerStoragePendingBlobPublication,
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
  DatabaseOperationRow,
  DatabasePlacement,
  DatabaseRef,
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
  NormalizedDatabaseCoordinatorRestartPolicy,
  RunDatabaseActorIfRequestedOptions,
  AuthRequestCredentialResolver as ServerAuthRequestCredentialResolver,
  ResolvedConfig,
  ScopedWorkflowInstanceListFilter,
  ScopedWorkflowService,
  ServerSystemDatabaseServices,
  SystemDatabaseConfig,
  WorkflowExecutionServerServices,
  ZeroPolicyUserPropertyRegistry,
} from '@zero/framework/server';
import {
  createStoragePlugin,
  createUploadGrantToken as createSubpathUploadGrantToken,
  verifyUploadGrantToken as verifySubpathUploadGrantToken,
} from '@zero/framework/storage';
import type {
  StorageAdapterOperationOptions,
  StorageBlobWriteResult,
  StoragePendingBlobPublication,
} from '@zero/framework/storage';
import {
  createSyncPlugin,
  SYNC_ACK_ERROR_CODES,
  SYNC_MUTATION_ERROR_CODES,
  SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
  SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS,
  SyncMutationError,
  isSyncMutationError,
  type SyncAckErrorCode,
  type SyncAckMessage,
  type SyncDataPlaneName,
  type SyncMutationErrorCode,
  type SyncMutationErrorDetails,
  type SyncMutationRejection,
  type SyncMutationWaitOptions,
  type SyncPluginConfig,
  type SyncSnapshotBeginMessage,
  type SyncSnapshotChunkMessage,
  type SyncSnapshotEndMessage,
} from '@zero/framework/sync';
import { PlatformTokenService } from '@zero/framework/tokens';
import { createVectorPlugin } from '@zero/framework/vector';
import {
  WorkflowActivityCatalog,
  WorkflowExecutor,
  WorkflowRegistry,
  WorkflowService,
  MAX_WORKFLOW_SYSTEM_EVENT_IDEMPOTENCY_KEY_LENGTH,
  createWorkflowObservability,
  expr,
  flow,
  normalizeWorkflowSchemaSnapshot,
  step,
  type ClaimedWorkflowEvent,
  type PublishWorkflowDefinitionVersionResult,
  type RegisteredWorkflowActivity,
  type ResolvedWorkflowDefinitionDraft,
  type ResolvedWorkflowDefinitionVersion,
  type WorkflowActivityDefinition,
  type WorkflowActorAuthorityFence,
  type WorkflowChooseOptions,
  type WorkflowClientInteractionRecord,
  type WorkflowClock,
  type WorkflowCodeEmitter,
  type WorkflowDefinitionCatalogRecord,
  type WorkflowDefinitionDraftRecord,
  type WorkflowDefinitionScope,
  type WorkflowDefinitionSummary,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionVersionStatus,
  type WorkflowExecutionResult,
  type WorkflowInstanceListFilter,
  type WorkflowInteractionRecord,
  type WorkflowMemoryContext,
  type WorkflowMutationOptions,
  type WorkflowObservability,
  type WorkflowPublicTopology,
  type WorkflowStartOptions,
  type WorkflowSystemEventDeliveryOptions,
  type WorkflowSystemEventDeliveryResult,
} from '@zero/framework/workflows';

const nativeSourceResolver: NativeAuthorizationSourceResolver = () => 'trusted-edge';
const resourceReceiptLimits = [
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
  subpathResourceReceiptMaxKeys,
  subpathResourceReceiptMaxResultBytes,
  subpathResourceReceiptMaxRetainedBytes,
  subpathResourceReceiptRetainedLimit,
] as const;
const policyPropertyRegistry: ZeroPolicyUserPropertyRegistry = {
  isPolicyTrusted: () => true,
};
const authNativeSourceResolver: AuthNativeSourceResolver = () => 'trusted-edge';
const authTenancy: AuthTenancyConfig = { mode: 'single' };
const authAdministration: AuthAdministrationTenantConfig = {};
const serverAuthAdministration: ServerAuthAdministrationTenantConfig = {};
const authTenancyMode: AuthTenancyMode = 'single';
const authAuthorization: AuthAuthorizationConfig = { mode: 'simple' };
const authAuthorizationMode: AuthAuthorizationMode = 'simple';
const authTenantCreationMode: AuthTenantCreationMode = 'authenticated';
const authTenantCreation: AuthTenantCreationConfig = { mode: authTenantCreationMode };
const authTenantTerminology: AuthTenantTerminologyConfig = {
  singular: 'workspace',
  plural: 'workspaces',
};
const authOwnerAdoption: AuthAuthorizationOwnerAdoptionConfig = {
  email: 'owner@example.com',
};
const selectedDatabaseRef: DatabaseRef = createDatabaseRef('tenant:hot');
const selectedNamedDatabaseRef: DatabaseRef = createNamedDatabaseRef('reporting');
const selectedTenantDatabaseRef: DatabaseRef = createTenantDatabaseRef('tenant:hot');
const emptyDatabaseRealm = defineDatabaseRealm({
  name: 'package-export-smoke',
  version: '1',
  tables: {},
  migrations: [],
  queries: {},
  commands: {},
});
const emptyDatabaseRealmContributionDefinition: DatabaseRealmContributionDefinition = {
  name: 'package-export-contribution',
  version: '1',
};
const emptyDatabaseRealmContribution: DatabaseRealmContribution =
  defineDatabaseRealmContribution(emptyDatabaseRealmContributionDefinition);
const adaptedDatabaseRealmContribution: DatabaseRealmContribution =
  databaseRealmContribution(emptyDatabaseRealm);
const emptyDatabaseRealmCompositionDefinition: DatabaseRealmCompositionDefinition = {
  name: 'package-export-composition',
  version: '1',
  contributions: [emptyDatabaseRealmContribution],
};
const composedDatabaseRealm = composeDatabaseRealm(
  emptyDatabaseRealmCompositionDefinition,
);
const databaseReadQueryHandler = null as unknown as DatabaseReadQueryHandler;
const databaseReadQueryRegistry = {} as DatabaseReadQueryRegistry;
const databaseWriteCommandCapability = {} as DatabaseWriteCommandCapability;
const databaseWriteCommandContext = {} as DatabaseWriteCommandContext;
const databaseWriteCommandHandler = null as unknown as DatabaseWriteCommandHandler;
const databaseWriteCommandRegistry = {} as DatabaseWriteCommandRegistry;
const publicDatabaseFind: DatabaseFindInput = {
  limit: 25,
  order: [{ field: 'created_at', direction: 'desc' }],
};
const publicDatabaseAssertions: readonly DatabaseAssertion[] = [{
  type: 'row-missing',
  table: 'documents',
  id: 'document_1',
}];
const publicDatabaseRestart: DatabaseCoordinatorRestartPolicy = {
  initialDelayMs: 25,
  maxDelayMs: 1_000,
  circuitFailureThreshold: 5,
  circuitCooldownMs: 5_000,
};
const normalizedDatabaseRestart = publicDatabaseRestart as
  NormalizedDatabaseCoordinatorRestartPolicy;
const legacySnapshotManager = new SnapshotManager(
  new Database(':memory:'),
  './data/legacy.snapshot.db',
  30_000,
  false,
);
const legacySnapshotPromise: Promise<boolean> = legacySnapshotManager.snapshot();
const legacySnapshotResult: boolean = legacySnapshotManager.snapshotSync();
const hotDatabaseRefs = new Set<DatabaseRef>([
  selectedNamedDatabaseRef,
  selectedTenantDatabaseRef,
  legacySnapshotManager,
  legacySnapshotPromise,
  legacySnapshotResult,
]);
const appDatabasePlacement: AppDatabasePlacementConfig = {
  default: 'file',
  select: ({ databaseRef }) => hotDatabaseRefs.has(databaseRef) ? 'hot' : 'file',
  hot: {
    maxBytes: DATABASE_HOT_SHORTHAND_MAX_BYTES,
  },
};
void publicDatabaseFind;
void publicDatabaseAssertions;
const resolvedDatabasePlacement = {} as DatabasePlacementPolicy;
const definedAuthConfig = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    terminology: authTenantTerminology,
    creation: authTenantCreation,
  },
  authorization: {
    mode: 'advanced',
    ownerAdoption: authOwnerAdoption,
  },
});
const resolvedAuthTenancy: ResolvedAuthTenancyConfig = { mode: authTenancyMode };
const resolvedAuthAuthorization: ResolvedAuthAuthorizationConfig = {
  mode: authAuthorizationMode,
  permissions: {},
  roles: {},
};
const normalizedAuth = {} as NormalizedAuthBehaviorConfig;
const accessRequirement: AccessRequirement = { permission: 'patients:read' };
const permissionKey: PermissionKey = 'patients:read';
const permissionScope: AuthPermissionScope = 'tenant';
const serverPermissionScope: ServerAuthPermissionScope = 'tenant';
const tenantKind: TenantKind = 'organization';
const platformTenantPage = {} as AuthPlatformTenantPage;
const applicationAdministrationConfig = {} as AuthApplicationAdministrationConfig;
const tenantAdministrationConfig = {} as AuthTenantAdministrationConfig;
const authAuditEvent = {} as AuthAuditEvent;
const authAuditQuery = {} as AuthAuditQuery;
const authApiKeyServiceOptions = {} as AuthApiKeyServiceOptions;
const authApiKeyManagementCapabilities = {} as AuthApiKeyManagementCapabilities;
const authRequestCredentialResolver = {} as AuthRequestCredentialResolver;
const serverAuthApiKeyServiceOptions = {} as ServerAuthApiKeyServiceOptions;
const serverAuthApiKeyManagementCapabilities = {} as ServerAuthApiKeyManagementCapabilities;
const serverAuthRequestCredentialResolver = {} as ServerAuthRequestCredentialResolver;
const authorizationSnapshot = {} as AuthAuthorizationSnapshot;
const compiledAccessRequirement = compileAccessRequirement(accessRequirement);
const serverResourceFields = defineServerResourceFields({
  read: ['id', 'tenant_id', 'title'],
  create: ['title'],
  update: ['title'],
});
const subpathResourceFields = defineSubpathResourceFields({
  read: ['id', 'tenant_id', 'title'],
  create: ['title'],
  update: ['title'],
});
const syncPluginConfig: SyncPluginConfig = {
  db: { mode: ':memory:' },
  tables: {},
  replicaChangePolling: { intervalMs: 250 },
};
const syncAckErrorCode: SyncAckErrorCode = SYNC_ACK_ERROR_CODES.dataRealmNotReady;
const syncAckMessage: SyncAckMessage = {
  type: 'sync.ack',
  ref: 'mutation-ref',
  seq: null,
  ok: false,
  errorCode: syncAckErrorCode,
};
const syncMutationRejection = {} as SyncMutationRejection;
const syncMutationErrorCode: SyncMutationErrorCode =
  SYNC_MUTATION_ERROR_CODES.waitTimeout;
const syncMutationErrorDetails: SyncMutationErrorDetails = {
  ref: 'mutation-ref', table: 'todos', op: 'UPDATE', rowId: 'todo-1',
};
const syncMutationWaitOptions: SyncMutationWaitOptions = {
  timeoutMs: SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
};
const syncMutationError = new SyncMutationError(
  syncMutationErrorCode,
  syncMutationErrorDetails,
);
void isSyncMutationError(syncMutationError);
void syncMutationWaitOptions;
void SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS;
type SyncDataPlaneSnapshotMessages = readonly [
  SyncDataPlaneName,
  SyncSnapshotBeginMessage,
  SyncSnapshotChunkMessage,
  SyncSnapshotEndMessage,
];
const syncDataPlaneSnapshotMessages = {} as SyncDataPlaneSnapshotMessages;
const systemDatabaseConfig: SystemDatabaseConfig = {
  mode: 'file',
  path: './data/zero.system.db',
};
const systemDatabaseServices = {} as ServerSystemDatabaseServices;
type IdentityProjectionPublicTypes = readonly [
  IdentityAnchorStoreOptions,
  IdentityProjectionErrorCode,
  IdentityProjectionLifecycleRoutes,
  SynchronousIdentityProjectionTarget,
];
const identityProjectionPublicTypes = {} as IdentityProjectionPublicTypes;
const tenantDocuments = defineTable('tenant_documents', {
  tenant_id: field.text({ required: true }),
  title: field.text({ required: true }),
});
const guardianOwnedRecords = defineTable('guardian_owned_records', {
  user_id: field.guardianUser(),
  title: field.text({ required: true }),
});
const guardianAnchorRequirements = getGuardianAnchorRequirements(
  guardianOwnedRecords.serverTable,
);
const guardianTableReferences = getGuardianTableReferences(
  guardianOwnedRecords.serverTable,
);
const guardianFieldReference = guardianTableReferences[0] as
  | GuardianFieldReference
  | undefined;
type GuardianReferencePublicTypes = readonly [
  GuardianReferenceKind,
  GuardianTableReferenceMetadata,
];
const guardianReferencePublicTypes = {} as GuardianReferencePublicTypes;
const guardianOwnedPolicy = resourcesGuardianActorPolicy({ userField: 'user_id' });
const tenantDocumentResource = defineResource({
  table: tenantDocuments,
  realm: tenantRealm(),
  policy: adminOnly(),
});
const tenantDocumentSubpathResource = defineSubpathResource({
  table: tenantDocuments,
  realm: resourcesTenantRealm(),
  policy: resourcesOwnerPolicy({ userField: 'tenant_id', create: 'require' }),
});
const configuredPostLoginPath = (config: AppConfig): string | undefined => config.postLoginPath;
const resolvedPostLoginPath = (config: ResolvedConfig): string => config.postLoginPath;
const workflowDefinition = flow(step('start', 'smoke.activity', { input: expr.input() }));
const workflowChooseOptions: WorkflowChooseOptions = { label: 'Smoke choice' };
const workflowSystemEventIdempotencyKeyLimit =
  MAX_WORKFLOW_SYSTEM_EVENT_IDEMPOTENCY_KEY_LENGTH;
const packageAutomationFunction = defineDatabaseFunction({
  name: 'package.smoke',
  version: 1,
  mode: 'transaction',
  handler: () => null,
});
const packageAutomationTrigger = defineDatabaseTrigger({
  name: 'package.smoke',
  version: 1,
  table: 'package_rows',
  after: { insert: true },
  run: packageAutomationFunction,
});
const packageAutomationRegistry = defineDatabaseAutomations({
  functions: [packageAutomationFunction],
  triggers: [packageAutomationTrigger],
});
type WorkflowActivityInput = { instanceId: string };
type WorkflowPublicTypes = readonly [
  ClaimedWorkflowEvent,
  PublishWorkflowDefinitionVersionResult,
  ResolvedWorkflowDefinitionDraft,
  ResolvedWorkflowDefinitionVersion,
  WorkflowActorAuthorityFence,
  WorkflowClock,
  WorkflowCodeEmitter,
  WorkflowDefinitionCatalogRecord,
  WorkflowDefinitionDraftRecord,
  WorkflowDefinitionScope,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionRecord,
  WorkflowDefinitionVersionStatus,
  WorkflowExecutionResult,
  WorkflowInstanceListFilter,
  WorkflowMutationOptions,
  WorkflowObservability,
  WorkflowPublicTopology,
  WorkflowStartOptions,
  WorkflowSystemEventDeliveryOptions,
  WorkflowSystemEventDeliveryResult,
];
const typedWorkflowRegistry = new WorkflowRegistry();
const typedWorkflowActivity = typedWorkflowRegistry.registerActivity<
  WorkflowActivityInput,
  WorkflowExecutionServerServices
>({
  name: 'smoke.activity',
  handler: async ({ input, zero }) => zero?.workflows?.get(input.instanceId) ?? null,
});
const workflowTypeSurface = null as unknown as {
  activity: WorkflowActivityDefinition<WorkflowActivityInput, WorkflowExecutionServerServices>;
  clientInteraction: WorkflowClientInteractionRecord;
  executionServices: WorkflowExecutionServerServices;
  interaction: WorkflowInteractionRecord;
  memory: WorkflowMemoryContext;
  publicTypes: WorkflowPublicTypes;
  registeredActivity: RegisteredWorkflowActivity<
    WorkflowActivityInput,
    WorkflowExecutionServerServices
  >;
  scopedListFilter: ScopedWorkflowInstanceListFilter;
  scoped: ScopedWorkflowService;
};
const machineServiceProjection = null as unknown as {
  auth: AuthorityScopedAuthServices;
  create: typeof createAuthorityScopedServerServices;
  notifications: ScopedNotificationService;
  observability: AuthorityScopedObservabilityServices;
  options: CreateAuthorityScopedServerServicesOptions;
  pdf: ScopedPdfService;
  pdfStorageTarget: ScopedPdfStorageTarget;
  rooms: ScopedRoomService;
  storageDrives: ScopedStorageDriveApi;
  storageObjects: ScopedStorageObjectApi;
  storagePermissions: ScopedStoragePermissionApi;
  storage: ScopedStorageService;
  storageUploads: ScopedStorageUploadGrantApi;
  services: AuthorityScopedServerServices;
};
const storageAdapterContract = null as unknown as {
  operation: StorageAdapterOperationOptions;
  publication: StoragePendingBlobPublication;
  serverOperation: ServerStorageAdapterOperationOptions;
  serverPublication: ServerStoragePendingBlobPublication;
  serverWrite: ServerStorageBlobWriteResult;
  write: StorageBlobWriteResult;
};
const aiSdk7Surface = null as unknown as {
  agent: AIAgentDefinition;
  durable: {
    descriptor: RegisteredAIDurableAgent;
    options: AIDurableAgentRuntimeOptions;
    progress: AIDurableAgentProgress;
  };
  capabilities: ResolvedAIProviderCapabilities;
  embedMany: AIEmbedManyRequest;
  file: AIHostedFileLocator;
  image: AIGenerateImageRequest;
  rerank: AIRerankRequest;
  execution: {
    request: AIModelExecutionRequest;
    prepare: AIPrepareModelExecution;
    service: AIServiceOptions;
    serverPrepare: ServerAIPrepareModelExecution;
    serverService: ServerAIServiceOptions;
  };
  video: AIGenerateVideoRequest;
};
const appWorkflowRegistrationContext = null as unknown as AppWorkflowRegistrationContext;
const dataStudioServerFeature = createDataStudioFeatureSubpath();
const dataStudioServerTypes = null as unknown as {
  feature: DataStudioFeatureSubpath;
  receipt: DataStudioMutationReceiptSubpath<unknown>;
};

export const serverSymbols = {
  AI_PROVIDER_CATALOG,
  AI_PROVIDER_TYPES,
  AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES,
  SERVER_AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES,
  AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES,
  AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES,
  SERVER_AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES,
  AI_DURABLE_AGENT_STATE_VERSION,
  AIAgentRunner,
  AIAgentService,
  AIDurableAgentService,
  AIDurableAgentWorkflowRuntime,
  AIOutput,
  AIService,
  aiSdk7Surface,
  appWorkflowRegistrationContext,
  createAIHostedFilesService,
  createAIModelExecutionPreparer,
  createServerAIModelExecutionPreparer,
  createAIVideoService,
  defineAIAgent,
  defineAIAgentTool,
  prepareDirectAIModelExecution,
  AuthApplicationAdministrationService,
  AuthApiKeyService,
  AuthApiKeyStore,
  AuthAuditService,
  AuthPlatformTenantAdministrationService,
  AuthTenantAdministrationService,
  ADMINISTRATION_TENANT_ROLE_KEYS,
  AuthorizationKernel,
  createAuthorityScopedServerServices,
  FRAMEWORK_PLATFORM_ADMINISTRATION_PERMISSIONS,
  accessRequirement,
  authAdministration,
  serverAuthAdministration,
  authNativeSourceResolver,
  authTenancy,
  authTenancyMode,
  authAuthorization,
  authAuthorizationMode,
  authOwnerAdoption,
  appDatabasePlacement,
  publicDatabaseRestart,
  normalizedDatabaseRestart,
  authTenantCreation,
  authTenantCreationMode,
  authTenantTerminology,
  configuredPostLoginPath,
  createApp,
  createDataStudioRouterSubpath,
  dataStudioServerFeature,
  dataStudioServerTypes,
  DataStudioServiceSubpath,
  createIdentityProjectionLifecycleHook,
  DatabaseError,
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
  defaultDatabaseHotSnapshotTimeoutMs,
  createDatabaseRef,
  createNamedDatabaseRef,
  createTenantDatabaseRef,
  selectedNamedDatabaseRef,
  selectedTenantDatabaseRef,
  captureAuthApplicationMutationAuthority,
  captureAuthTenantMutationAuthority,
  createAuthAuthorizationSnapshot,
  createAuthPlugin,
  createAuthorizationKernel,
  createDataRealmReadinessPlugin,
  createServerDataRealmReadinessPlugin,
  getAuthAuditService,
  createServerAuthorizationKernel,
  compiledAccessRequirement,
  installAuthStopBarrier,
  installServerAuthStopBarrier,
  isAdministrationOnlyRole,
  isAdministrationTenantRoleKey,
  isPolicyTrustedUserProperty,
  isRoleAssignableToTenantKind,
  adminOnly,
  createKvPlugin,
  createKvPluginSubpath,
  createNotificationPlugin,
  createPlatformSQLiteService,
  createResourceCrudPlugin,
  createSubpathResourceCrudPlugin,
  createRoomPlugin,
  createSchedulerPlugin,
  createStoragePlugin,
  createSubpathUploadGrantToken,
  createSyncPlugin,
  createUploadGrantToken,
  createVectorPlugin,
  defineNativeAuthConfig,
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  composeDatabaseRealm,
  databaseRealmContribution,
  defineDatabaseRealm,
  defineDatabaseRealmContribution,
  emptyDatabaseRealm,
  emptyDatabaseRealmContribution,
  adaptedDatabaseRealmContribution,
  emptyDatabaseRealmContributionDefinition,
  emptyDatabaseRealmCompositionDefinition,
  composedDatabaseRealm,
  databaseReadQueryHandler,
  databaseReadQueryRegistry,
  databaseWriteCommandCapability,
  databaseWriteCommandContext,
  databaseWriteCommandHandler,
  databaseWriteCommandRegistry,
  definedAuthConfig,
  defineResource,
  serverResourceFields,
  defineSubpathResource,
  subpathResourceFields,
  defineTable,
  tenantDocuments,
  tenantDocumentResource,
  tenantDocumentSubpathResource,
  tenantKindPolicy,
  resourcesTenantKindPolicy,
  tenantRealm,
  resourcesTenantRealm,
  EmailService,
  field,
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  GUARDIAN_TABLE_REFERENCES,
  guardianAnchorRequirements,
  guardianFieldReference,
  guardianOwnedPolicy,
  guardianOwnedRecords,
  guardianReferencePublicTypes,
  guardianTableReferences,
  hasGuardianTableReferences,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  IDENTITY_PROJECTION_ERROR_CODES,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
  identityProjectionPublicTypes,
  IdentityAnchorStore,
  IdentityProjectionError,
  IdentityProjectionOutboxStore,
  IdentityProjectionService,
  identityProjectionError,
  encodeFieldValue,
  getAI,
  getEmailService,
  getKvService,
  getKvServiceSubpath,
  getPlatformTokenService,
  getPlatformSQLiteService,
  getPdfService,
  getPdfServiceSubpath,
  getResourceRegistry,
  getVectorStore,
  getWorkflowService,
  metadataPolicy,
  nativeSourceResolver,
  normalizedAuth,
  resolvedDatabasePlacement,
  selectedDatabaseRef,
  policyPropertyRegistry,
  permissionKey,
  permissionScope,
  serverPermissionScope,
  platformTenantPage,
  tenantKind,
  applicationAdministrationConfig,
  tenantAdministrationConfig,
  authAuditEvent,
  authAuditQuery,
  authApiKeyServiceOptions,
  authApiKeyManagementCapabilities,
  authRequestCredentialResolver,
  authorizationSnapshot,
  KvMemoryEngine,
  KvMemoryEngineSubpath,
  KvService,
  KvServiceSubpath,
  Migrator,
  OBS_CODES,
  PdfService,
  ownerPolicy,
  PlatformTokenService,
  PURE_OBS_CODES,
  resourcesOwnerPolicy,
  resolvedAuthAuthorization,
  resolvedAuthTenancy,
  ServerAuthApiKeyService,
  ServerAuthApiKeyStore,
  serverAuthApiKeyServiceOptions,
  serverAuthApiKeyManagementCapabilities,
  serverAuthRequestCredentialResolver,
  RoomOwnerCannotLeaveError,
  resolvedPostLoginPath,
  checkDatabaseAutomations,
  runPlatformDoctor,
  runUsageAudit,
  runDatabaseActorIfRequested,
  parseDataRealmReadinessSnapshot,
  syncPluginConfig,
  SYNC_ACK_ERROR_CODES,
  syncAckErrorCode,
  syncAckMessage,
  syncDataPlaneSnapshotMessages,
  syncMutationRejection,
  systemDatabaseConfig,
  systemDatabaseServices,
  verifySubpathUploadGrantToken,
  verifyUploadGrantToken,
  workflowChooseOptions,
  workflowSystemEventIdempotencyKeyLimit,
  packageAutomationRegistry,
  workflowDefinition,
  workflowTypeSurface,
  machineServiceProjection,
  storageAdapterContract,
  typedWorkflowActivity,
  WorkflowActivityCatalog,
  WorkflowExecutor,
  WorkflowRegistry,
  WorkflowService,
  createWorkflowObservability,
  normalizeWorkflowSchemaSnapshot,
};
`;

const clientSmokeSource = `
import {
  buildDataTableServerQuery as buildDataTableServerQueryRoot,
  createDataTableApiAdapter as createDataTableApiAdapterRoot,
  DataTableBulkActions as DataTableBulkActionsRoot,
  DataTableControls as DataTableControlsRoot,
  DataTableServerSourceError as DataTableServerSourceErrorRoot,
  SecretField as SecretFieldRoot,
  StreamingText as StreamingTextRoot,
  useDataTableMutationRunner as useDataTableMutationRunnerRoot,
} from '@zero/framework';
import type {
  DataTableAllMatchingBulkSelection as DataTableAllMatchingBulkSelectionRoot,
  DataTableBulkAction as DataTableBulkActionRoot,
  DataTableBulkActionsProps as DataTableBulkActionsPropsRoot,
  DataTableMutationContext as DataTableMutationContextRoot,
  DataTableMutationRunner as DataTableMutationRunnerRoot,
  DataTablePageBulkSelection as DataTablePageBulkSelectionRoot,
  DataTablePaginationProps as DataTablePaginationPropsRoot,
  DataTableServerAdapter as DataTableServerAdapterRoot,
  DataTableServerPage as DataTableServerPageRoot,
  DataTableServerQuery as DataTableServerQueryRoot,
  DataTableServerResult as DataTableServerResultRoot,
  DataTableState as DataTableStateRoot,
  SecretFieldProps as SecretFieldPropsRoot,
  StreamSource as StreamSourceRoot,
  StreamingTextProps as StreamingTextPropsRoot,
  StreamingTextStatus as StreamingTextStatusRoot,
} from '@zero/framework';
import {
  DATA_STUDIO_APP_TABLES as DATA_STUDIO_APP_TABLES_SUBPATH,
  DATA_STUDIO_CLIENT_TABLES as DATA_STUDIO_CLIENT_TABLES_SUBPATH,
  normalizeDataStudioSchema as normalizeDataStudioSchemaSubpath,
} from '@zero/framework/data-studio';
import type {
  DataStudioSchema as DataStudioSchemaSubpath,
} from '@zero/framework/data-studio';
import {
  AdministrationScopeGate as AdministrationScopeGateSubpath,
  ApiKeyManagement as ApiKeyManagementSubpath,
  ApplicationUserApiKeyManagement as ApplicationUserApiKeyManagementSubpath,
  AuthFlowContinuation as AuthFlowContinuationSubpath,
  ControlPlaneAuditViewer as ControlPlaneAuditViewerSubpath,
  DataRealmReadinessNotice as DataRealmReadinessNoticeSubpath,
  DataRealmReadyGate as DataRealmReadyGateSubpath,
  DomainOnboarding as DomainOnboardingSubpath,
  LoginForm,
  MFAEnrollmentForm,
  PermissionGate as PermissionGateSubpath,
  PlatformAdminGate as PlatformAdminGateSubpath,
  PlatformApiKeyManagement as PlatformApiKeyManagementSubpath,
  PlatformWorkspaceManagement as PlatformWorkspaceManagementSubpath,
  SelfApiKeyManagement as SelfApiKeyManagementSubpath,
  TenantCreationForm as TenantCreationFormSubpath,
  TenantInvitationForm,
  TenantGate as TenantGateSubpath,
  TenantJoinRequestForm,
  TenantMemberApiKeyManagement as TenantMemberApiKeyManagementSubpath,
  TenantMemberManagement as TenantMemberManagementSubpath,
  TenantOnboardingManagement,
  useTenantInvitationAction as useTenantInvitationActionSubpath,
  TenantSelectionForm as TenantSelectionFormSubpath,
  TenantSwitcher as TenantSwitcherSubpath,
  TenantDomainManagement as TenantDomainManagementSubpath,
} from '@zero/framework/components/auth';
import type {
  ApiKeyManagementCommonProps as ApiKeyManagementCommonPropsSubpath,
  ApiKeyManagementProps as ApiKeyManagementPropsSubpath,
  ApplicationUserApiKeyManagementProps as ApplicationUserApiKeyManagementPropsSubpath,
  DataRealmReadyGateProps as DataRealmReadyGatePropsSubpath,
  PlatformApiKeyManagementProps as PlatformApiKeyManagementPropsSubpath,
  SelfApiKeyManagementProps as SelfApiKeyManagementPropsSubpath,
  TenantMemberApiKeyManagementProps as TenantMemberApiKeyManagementPropsSubpath,
  UseTenantInvitationActionOptions as UseTenantInvitationActionOptionsSubpath,
} from '@zero/framework/components/auth';
import { AppShell as AppShellSubpath } from '@zero/framework/components/app-shell';
import { AnimatedList as AnimatedListSubpath } from '@zero/framework/components/animated-list';
import { BentoGrid as BentoGridSubpath } from '@zero/framework/components/bento-grid';
import { CodeBlock as CodeBlockSubpath } from '@zero/framework/components/code-block';
import { CtaSection as CtaSectionSubpath } from '@zero/framework/components/cta';
import { Collapsible as CollapsibleSubpath } from '@zero/framework/components/collapsible';
import {
  buildDataTableServerQuery as buildDataTableServerQuerySubpath,
  createDataTableApiAdapter as createDataTableApiAdapterSubpath,
  DataTableBulkActions as DataTableBulkActionsSubpath,
  DataTableControls as DataTableControlsSubpath,
  DataTableSearch as DataTableSearchSubpath,
  DataTableServerSourceError as DataTableServerSourceErrorSubpath,
  DataTableToolbar as DataTableToolbarSubpath,
  DataTableView,
  useDataTableMutationRunner as useDataTableMutationRunnerSubpath,
} from '@zero/framework/components/data-table';
import type {
  DataTableAllMatchingBulkSelection as DataTableAllMatchingBulkSelectionSubpath,
  DataTableBulkAction as DataTableBulkActionSubpath,
  DataTableBulkActionsProps as DataTableBulkActionsPropsSubpath,
  DataTableMutationContext as DataTableMutationContextSubpath,
  DataTableMutationRunner as DataTableMutationRunnerSubpath,
  DataTablePageBulkSelection as DataTablePageBulkSelectionSubpath,
  DataTablePaginationProps as DataTablePaginationPropsSubpath,
  DataTableServerAdapter as DataTableServerAdapterSubpath,
  DataTableServerPage as DataTableServerPageSubpath,
  DataTableServerQuery as DataTableServerQuerySubpath,
  DataTableServerResult as DataTableServerResultSubpath,
  DataTableState as DataTableStateSubpath,
  DataTableControlsProps as DataTableControlsPropsSubpath,
  DataTableSearchOptions as DataTableSearchOptionsSubpath,
  DataTableSearchProps as DataTableSearchPropsSubpath,
  DataTableToolbarContext as DataTableToolbarContextSubpath,
  DataTableToolbarProps as DataTableToolbarPropsSubpath,
  DataTableToolbarSlot as DataTableToolbarSlotSubpath,
  DataTableToolbarSlots as DataTableToolbarSlotsSubpath,
} from '@zero/framework/components/data-table';
import {
  DataStudio as DataStudioSubpath,
  DataStudioFilterControl as DataStudioFilterControlSubpath,
  DataStudioInlineCell as DataStudioInlineCellSubpath,
  DataStudioWorkspace as DataStudioWorkspaceSubpath,
} from '@zero/framework/components/data-studio';
import type {
  DataStudioInlineCellProps as DataStudioInlineCellPropsSubpath,
  DataStudioFilterControlProps as DataStudioFilterControlPropsSubpath,
  DataStudioProps as DataStudioPropsSubpath,
  DataStudioWorkspaceProps as DataStudioWorkspacePropsSubpath,
} from '@zero/framework/components/data-studio';
import { DropdownMenu as DropdownMenuSubpath } from '@zero/framework/components/dropdown-menu';
import {
  Popover as PopoverSubpath,
  PopoverContent as PopoverContentSubpath,
  PopoverTrigger as PopoverTriggerSubpath,
} from '@zero/framework/components/popover';
import type {
  PopoverContentProps as PopoverContentPropsSubpath,
  PopoverProps as PopoverPropsSubpath,
  PopoverTriggerProps as PopoverTriggerPropsSubpath,
} from '@zero/framework/components/popover';
import { ExpandableCards as ExpandableCardsSubpath } from '@zero/framework/components/expandable-card';
import { Faq as FaqSubpath } from '@zero/framework/components/faq';
import { FeaturesSection as FeaturesSectionSubpath } from '@zero/framework/components/features';
import { FooterSection as FooterSectionSubpath } from '@zero/framework/components/footer';
import { Hero as HeroSubpath } from '@zero/framework/components/hero';
import { KanbanBoard as KanbanBoardSubpath } from '@zero/framework/components/kanban';
import { MasterDetailView } from '@zero/framework/components/master-detail';
import { ResizableNavbar as ResizableNavbarSubpath } from '@zero/framework/components/navbar';
import { QRCode as QRCodeSubpath } from '@zero/framework/components/qr-code';
import { RadialMenu as RadialMenuSubpath } from '@zero/framework/components/radial-menu';
import { Sidebar as SidebarSubpath } from '@zero/framework/components/sidebar';
import { SecretField as SecretFieldSubpath } from '@zero/framework/components/secret-field';
import type {
  SecretFieldProps as SecretFieldPropsSubpath,
} from '@zero/framework/components/secret-field';
import { StorageManagement } from '@zero/framework/components/storage';
import { TextGenerateEffect as TextGenerateEffectSubpath } from '@zero/framework/components/text-effects';
import { Tooltip as TooltipSubpath } from '@zero/framework/components/tooltip';
import { Button as UiButton } from '@zero/framework/components/ui/button';
import { Checkbox as UiCheckbox } from '@zero/framework/components/ui/checkbox';
import { Progress as UiProgress } from '@zero/framework/components/ui/progress';
import {
  RadioGroup as UiRadioGroup,
  RadioGroupItem as UiRadioGroupItem,
} from '@zero/framework/components/ui/radio-group';
import { ThemeProvider as ThemeProviderSubpath } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { StreamingText as StreamingTextSubpath } from '@zero/framework/components/streaming-text';
import type {
  StreamSource as StreamSourceSubpath,
  StreamingTextProps as StreamingTextPropsSubpath,
  StreamingTextStatus as StreamingTextStatusSubpath,
} from '@zero/framework/components/streaming-text';
import { useDisclosure } from '@zero/framework/hooks';
import { Check } from '@zero/framework/icons';
import { ModalManager } from '@zero/framework/modals';
import { AppProvider } from '@zero/framework/react/app-provider';
import {
  useApplicationAccess as useApplicationAccessSubpath,
  useAuthApiKeys as useAuthApiKeysSubpath,
  useAuthConfig as useAuthConfigSubpath,
  useAuthAudit as useAuthAuditSubpath,
  useAuthorizationScopeBoundary as useAuthorizationScopeBoundarySubpath,
  useAuthorization as useAuthorizationSubpath,
  useCollection as useCollectionSubpath,
  useDataRealmReadiness as useDataRealmReadinessSubpath,
  useDataStudio as useDataStudioSubpath,
  useHasPermission as useHasPermissionSubpath,
  usePlatformAdministration as usePlatformAdministrationSubpath,
  usePlatformTenants as usePlatformTenantsSubpath,
  useResourceList as useResourceListSubpath,
  useDomainOnboarding as useDomainOnboardingSubpath,
  useTenantDomainAdministration as useTenantDomainAdministrationSubpath,
  useTenantMembers as useTenantMembersSubpath,
  useTenantOnboardingAdministration as useTenantOnboardingAdministrationSubpath,
  useTenantAppShellWorkspaces as useTenantAppShellWorkspacesSubpath,
  useTenantSwitcher as useTenantSwitcherSubpath,
  useWorkflow as useWorkflowSubpath,
  useWorkflowActions as useWorkflowActionsSubpath,
  useWorkflowList as useWorkflowListSubpath,
  useWorkflowRun as useWorkflowRunSubpath,
  useWorkflowTopology as useWorkflowTopologySubpath,
} from '@zero/framework/react/hooks';
import type {
  UseAuthApiKeysOptions as UseAuthApiKeysOptionsSubpath,
  UseAuthApiKeysResult as UseAuthApiKeysResultSubpath,
  UseDataRealmReadinessResult as UseDataRealmReadinessResultSubpath,
  UseDataStudioResult as UseDataStudioResultSubpath,
  UsePlatformAdministrationOptions as UsePlatformAdministrationOptionsSubpath,
  UsePlatformAdministrationResult as UsePlatformAdministrationResultSubpath,
  UseTenantOnboardingAdministrationOptions as UseTenantOnboardingAdministrationOptionsSubpath,
  UseTenantOnboardingAdministrationResult as UseTenantOnboardingAdministrationResultSubpath,
  WorkflowInteractionSubmissionResult as WorkflowInteractionSubmissionResultSubpath,
  UseWorkflowTopologyResult as UseWorkflowTopologyResultSubpath,
} from '@zero/framework/react/hooks';
import {
  AdministrationScopeGate,
  ApiKeyManagement,
  ApplicationUserApiKeyManagement,
  AuthFlowContinuation,
  ControlPlaneAuditViewer,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  DataRealmReadinessNotice,
  DataRealmReadyGate,
  DataStudio,
  DomainOnboarding,
  ApiError,
  Button,
  AppShell,
  AnimatedList,
  AnimatedListCard,
  BentoGrid,
  BentoGridItem,
  CodeBlock,
  CtaSection,
  Collapsible,
  DataTable,
  DataTableSearch,
  DataTableToolbar,
  defineResourceFields,
  DropdownMenu,
  ExpandableCards,
  Faq,
  FeaturesSection,
  FlipWords,
  FooterSection,
  groupKanbanItemIds,
  Hero,
  hasAuthorizationPermission,
  IdentityUserManagement,
  KanbanBoard,
  PlatformApiKeyManagement,
  PlatformWorkspaceManagement,
  PlatformUserManagement,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PermissionGate,
  PlatformAdminGate,
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
  parseDataRealmReadinessSnapshot,
  QRCode,
  RadialMenu,
  ResizableNavbar,
  projectKanbanMove,
  StickToBottom,
  SelfApiKeyManagement,
  SecretField,
  SYNC_MUTATION_ERROR_CODES,
  SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
  SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS,
  SyncMutationError,
  StreamingText,
  TextGenerateEffect,
  ThemeTogglerButton,
  ThemeProvider,
  TooltipSubpath,
  TypewriterEffect,
  useCollection,
  useDataRealmReadiness,
  useDataStudio,
  useApplicationAccess,
  useAuthApiKeys,
  useAuthConfig,
  useAuthAudit,
  useDomainOnboarding,
  useAuthorization,
  isSyncMutationError,
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
  useHasPermission,
  usePlatformAdministration,
  usePlatformTenants,
  useNativeAuthContinuation,
  useResourceList,
  useTenantDomainAdministration,
  useTenantMembers,
  useTenantOnboardingAdministration,
  useTenantInvitationAction,
  useTenantAppShellWorkspaces,
  useTenantSwitcher,
  TenantCreationForm,
  TenantGate,
  TenantDomainManagement,
  TenantMemberManagement,
  TenantMemberApiKeyManagement,
  TenantSelectionForm,
  TenantSwitcher,
  useWorkflow,
  useWorkflowActions,
  useWorkflowList,
  useWorkflowRun,
  useWorkflowTopology,
  unwrap,
  WavyBackground,
} from '@zero/framework/react';
import {
  createSyncClient,
  type SyncMutationRejection as ClientSyncMutationRejection,
} from '@zero/framework/sync/client';
import { createIdentityId } from '@zero/framework/sync/identity';
	import type { Row } from '@zero/framework/sync/types';
	import type { ComponentProps } from 'react';
import type { ToasterProps } from '@zero/framework/react';
import type {
  AppProviderProps,
  AdministrationScopeGateProps,
  ApiKeyManagementCommonProps,
  ApiKeyManagementProps,
  ApplicationUserApiKeyManagementProps,
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
  AuthApplicationAdminSdkSurface,
  AuthAuditEvent,
  AuthAuditSdkSurface,
  AuthPlatformAddMemberParams,
  AuthPlatformAdminSdkSurface,
  AuthPlatformIssueInvitationParams,
  AuthPlatformRoleSelection,
  AuthPlatformTenantPage,
  AuthPlatformApiKeyListQuery,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
  ControlPlaneAuditViewerProps,
  DataRealmReadinessSnapshot,
  DataStudioCapabilities,
  DataStudioRowFilter,
  DataStudioProps,
  DataStudioSdkSurface,
  UseDataStudioResult,
  DataRealmReadyGateProps,
  DataTableSearchOptions,
  DataTableSearchProps,
  DataTableToolbarContext,
  DataTableToolbarProps,
  DataTableToolbarSlot,
  DataTableToolbarSlots,
  AuthAuthorizationState,
  AuthState,
  AuthConfigState,
  AuthConfigStatus,
  AuthorizationScopeBoundary,
  AuthDomainOnboardingCompletion,
  AuthTenantDomainAdministration,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
	  AppShellWorkspaceConfig,
  Client,
  IssuedAuthApiKey,
	  SyncMutationErrorCode,
	  SyncMutationErrorDetails,
	  SyncMutationRejection,
	  SyncMutationWaitOptions,
  LoginFormProps,
  SecretFieldProps,
  StreamSource,
  StreamingTextProps,
  StreamingTextStatus,
  PlatformUserManagementProps,
  PlatformApiKeyManagementProps,
  PlatformWorkspaceManagementProps,
  PopoverContentProps,
  PopoverProps,
  PopoverTriggerProps,
  TenantCreationFormProps,
  TenantMemberApiKeyManagementProps,
  TenantMemberManagementProps,
  TenantSelectionFormProps,
  TenantSwitcherProps,
  SelfApiKeyManagementProps,
  UseAuthApiKeysOptions,
  UseAuthApiKeysResult,
  UseDataRealmReadinessResult,
  UseTenantAppShellWorkspacesOptions,
  UsePlatformAdministrationOptions,
  UsePlatformAdministrationResult,
  UsePlatformTenantsResult,
  UseTenantOnboardingAdministrationOptions,
  UseTenantOnboardingAdministrationResult,
  UseTenantInvitationActionOptions,
  UseTenantInvitationActionResult,
  WorkflowInteractionSubmissionResult,
  UseWorkflowTopologyResult,
} from '@zero/framework/react';

	const row: Row = {};
	const toasterProps: ToasterProps = {};
	const rootSyncMutationErrorCode: SyncMutationErrorCode =
	  SYNC_MUTATION_ERROR_CODES.waitTimeout;
	const rootSyncMutationErrorDetails: SyncMutationErrorDetails = {
	  ref: 'root-ref', table: 'todos', op: 'UPDATE', rowId: 'todo-1',
	};
	const rootSyncMutationWaitOptions: SyncMutationWaitOptions = {
	  timeoutMs: SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
	};
	const rootSyncMutationError = new SyncMutationError(
	  rootSyncMutationErrorCode,
	  rootSyncMutationErrorDetails,
	);
	void isSyncMutationError(rootSyncMutationError);
	void rootSyncMutationWaitOptions;
	void SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS;
	type SecretFieldPublicTypes = readonly [
	  SecretFieldPropsRoot,
	  SecretFieldProps,
	  SecretFieldPropsSubpath,
	];
	const secretFieldPublicTypes = null as unknown as SecretFieldPublicTypes;
	type StreamingTextPublicTypes = readonly [
	  StreamSourceRoot,
	  StreamingTextPropsRoot,
	  StreamingTextStatusRoot,
	  StreamSource,
	  StreamingTextProps,
	  StreamingTextStatus,
	  StreamSourceSubpath,
	  StreamingTextPropsSubpath,
	  StreamingTextStatusSubpath,
	];
	const streamingTextPublicTypes = null as unknown as StreamingTextPublicTypes;
	type DataTablePublicTypes = readonly [
	  DataTableAllMatchingBulkSelectionRoot<{ query: string }>,
	  DataTableBulkActionRoot<Row, { query: string }>,
	  DataTableBulkActionsPropsRoot<Row, { query: string }>,
	  DataTableMutationContextRoot,
	  DataTableMutationRunnerRoot,
	  DataTablePageBulkSelectionRoot<Row>,
	  DataTablePaginationPropsRoot<Row>,
	  DataTableServerAdapterRoot<Row>,
	  DataTableServerPageRoot,
	  DataTableServerQueryRoot,
	  DataTableServerResultRoot<Row>,
	  DataTableStateRoot,
	  DataTableSearchOptions,
	  DataTableSearchProps,
	  DataTableToolbarContext<Row>,
	  DataTableToolbarProps<Row>,
	  DataTableToolbarSlot<Row>,
	  DataTableToolbarSlots<Row>,
	  DataTableAllMatchingBulkSelectionSubpath<{ query: string }>,
	  DataTableBulkActionSubpath<Row, { query: string }>,
	  DataTableBulkActionsPropsSubpath<Row, { query: string }>,
	  DataTableMutationContextSubpath,
	  DataTableMutationRunnerSubpath,
	  DataTablePageBulkSelectionSubpath<Row>,
	  DataTablePaginationPropsSubpath<Row>,
	  DataTableServerAdapterSubpath<Row>,
	  DataTableServerPageSubpath,
	  DataTableServerQuerySubpath,
	  DataTableServerResultSubpath<Row>,
	  DataTableStateSubpath,
	  DataTableSearchOptionsSubpath,
	  DataTableControlsPropsSubpath,
	  DataTableSearchPropsSubpath,
	  DataTableToolbarContextSubpath<Row>,
	  DataTableToolbarPropsSubpath<Row>,
	  DataTableToolbarSlotSubpath<Row>,
	  DataTableToolbarSlotsSubpath<Row>,
	];
	const dataTablePublicTypes = null as unknown as DataTablePublicTypes;
	type PopoverPublicTypes = readonly [
	  PopoverProps,
	  PopoverTriggerProps,
	  PopoverContentProps,
	  PopoverPropsSubpath,
	  PopoverTriggerPropsSubpath,
	  PopoverContentPropsSubpath,
	];
	const popoverPublicTypes = null as unknown as PopoverPublicTypes;
	const administrationScopeGateProps = {} as AdministrationScopeGateProps;
	const authConfigState = {} as AuthConfigState;
	const authConfigStatus = 'ready' as AuthConfigStatus;
	const dataRealmReadinessSnapshot = {} as DataRealmReadinessSnapshot;
	const dataRealmReadyGateProps = {} as DataRealmReadyGateProps;
	const dataRealmReadyGatePropsSubpath = {} as DataRealmReadyGatePropsSubpath;
	const dataRealmReadinessResult = {} as UseDataRealmReadinessResult;
	const dataRealmReadinessResultSubpath = {} as UseDataRealmReadinessResultSubpath;
	const applicationAdmin = {} as AuthApplicationAdminSdkSurface;
	const platformAdmin = {} as AuthPlatformAdminSdkSurface;
	const platformAddMember = {} as AuthPlatformAddMemberParams;
	const platformIssueInvitation = {} as AuthPlatformIssueInvitationParams;
	const platformRoleSelection = {} as AuthPlatformRoleSelection;
	const platformUpdateMemberInput = {} as AuthPlatformUpdateMemberInput;
	const platformUpdateMember = {} as AuthPlatformUpdateMemberParams;
	const platformTenantPage = {} as AuthPlatformTenantPage;
	const auditEvent = {} as AuthAuditEvent;
	const auditSdk = {} as AuthAuditSdkSurface;
	const auditViewerProps: ControlPlaneAuditViewerProps = { scope: 'tenant' };
	const authorizationState = {} as AuthAuthorizationState;
	const authorizationScopeBoundary = {} as AuthorizationScopeBoundary;
	const domainAdministration = {} as AuthTenantDomainAdministration;
	const domainCompletion = {} as AuthDomainOnboardingCompletion;
	type ApiKeyPublicTypes = readonly [
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
	  UseAuthApiKeysOptions,
	  UseAuthApiKeysResult,
	  ApiKeyManagementCommonProps,
	  ApiKeyManagementProps,
	  ApplicationUserApiKeyManagementProps,
	  PlatformApiKeyManagementProps,
	  SelfApiKeyManagementProps,
	  TenantMemberApiKeyManagementProps,
	];
	type ApiKeySubpathPublicTypes = readonly [
	  UseAuthApiKeysOptionsSubpath,
	  UseAuthApiKeysResultSubpath,
	  ApiKeyManagementCommonPropsSubpath,
	  ApiKeyManagementPropsSubpath,
	  ApplicationUserApiKeyManagementPropsSubpath,
	  PlatformApiKeyManagementPropsSubpath,
	  SelfApiKeyManagementPropsSubpath,
	  TenantMemberApiKeyManagementPropsSubpath,
	];
	const apiKeyPublicTypes = {} as ApiKeyPublicTypes;
	const apiKeySubpathPublicTypes = {} as ApiKeySubpathPublicTypes;
	const clientApiKeys = {} as Client['apiKeys'];
	const clientDataRealm = {} as Client['dataRealm'];
	const clientDataStudio = {} as Client['dataStudio'];
	type DataStudioPublicTypes = readonly [
	  DataStudioCapabilities,
	  DataStudioProps,
	  DataStudioPropsSubpath,
	  DataStudioInlineCellPropsSubpath,
	  DataStudioFilterControlPropsSubpath,
	  DataStudioRowFilter,
	  DataStudioWorkspacePropsSubpath,
	  DataStudioSdkSurface,
	  UseDataStudioResult,
	  UseDataStudioResultSubpath,
	];
	const dataStudioPublicTypes = null as unknown as DataStudioPublicTypes;
	const dataStudioSubpathSchema: DataStudioSchemaSubpath = {
	  version: 1,
	  columns: [],
	};
	const normalizedDataStudioSubpathSchema = normalizeDataStudioSchemaSubpath(
	  dataStudioSubpathSchema,
	);
	const clientMutationRejection = {} as SyncMutationRejection;
	const clientSubpathMutationRejection = {} as ClientSyncMutationRejection;
		const domainReleaseInput = {} as AuthTenantDomainReleaseInput;
		const domainReleaseResult = {} as AuthTenantDomainReleaseResult;
		const clientResourceFields = defineResourceFields({
		  read: ['id', 'title'],
		  create: ['title'],
		  update: ['title'],
		});
		const releaseTenantDomainClaim = {} as Client['releaseTenantDomainClaim'];
		const listTenants = {} as Client['listTenants'];
		const createTenant = {} as Client['createTenant'];
		const switchTenant = {} as Client['switchTenant'];
		const legacyLoginFormProps: LoginFormProps = { showRememberMe: true };
	const platformUserManagementProps = {} as PlatformUserManagementProps;
	const platformWorkspaceManagementProps = {} as PlatformWorkspaceManagementProps;
	const tenantCreationFormProps = {} as TenantCreationFormProps;
	const tenantMemberManagementProps = {} as TenantMemberManagementProps;
	const tenantSelectionFormProps = {} as TenantSelectionFormProps;
	const tenantSwitcherProps = {} as TenantSwitcherProps;
	const tenantAppShellOptions = {} as UseTenantAppShellWorkspacesOptions;
	const tenantAppShellWorkspaces = {} as AppShellWorkspaceConfig;
	const platformAdministrationResult = {} as UsePlatformAdministrationResult;
	const platformAdministrationOptions = {} as UsePlatformAdministrationOptions;
	const platformTenantsResult = {} as UsePlatformTenantsResult;
	const tenantOnboardingAdministrationOptions = {} as UseTenantOnboardingAdministrationOptions;
	const tenantOnboardingAdministrationResult = {} as UseTenantOnboardingAdministrationResult;
	const platformAdministrationOptionsSubpath = {} as UsePlatformAdministrationOptionsSubpath;
	const platformAdministrationResultSubpath = {} as UsePlatformAdministrationResultSubpath;
	const tenantOnboardingAdministrationOptionsSubpath = {} as UseTenantOnboardingAdministrationOptionsSubpath;
	const tenantOnboardingAdministrationResultSubpath = {} as UseTenantOnboardingAdministrationResultSubpath;
		const workflowTopologyResult = {} as UseWorkflowTopologyResult;
		const workflowTopologyResultSubpath = {} as UseWorkflowTopologyResultSubpath;
		const workflowInteractionSubmissionResult = {} as WorkflowInteractionSubmissionResult;
		const workflowInteractionSubmissionResultSubpath = {} as WorkflowInteractionSubmissionResultSubpath;
	const clientPlatformAdmin = {} as Client['platformAdmin'];
	const appProviderPostLoginPath = (props: AppProviderProps): string | undefined => props.postLoginPath;
	const authRestorationState = (state: AuthState): boolean => state.isRestoring;
	type MasterDetailProps = ComponentProps<typeof MasterDetailView>;
	const masterDetailLazySource: MasterDetailProps['source'] = {
	  type: 'lazy',
	  table: 'users',
	  options: { limit: 25, order: 'created_at', dir: 'desc' },
	};

export const clientSymbols = {
  AdministrationScopeGate,
  AdministrationScopeGateSubpath,
  ApiKeyManagement,
  ApiKeyManagementSubpath,
  apiKeyPublicTypes,
  apiKeySubpathPublicTypes,
  ApplicationUserApiKeyManagement,
  ApplicationUserApiKeyManagementSubpath,
  AuthFlowContinuation,
  AuthFlowContinuationSubpath,
  ControlPlaneAuditViewer,
  ControlPlaneAuditViewerSubpath,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  DataRealmReadinessNotice,
  DataRealmReadinessNoticeSubpath,
  DataRealmReadyGate,
  DataRealmReadyGateSubpath,
  dataRealmReadinessResult,
  dataRealmReadinessResultSubpath,
  dataRealmReadinessSnapshot,
  dataRealmReadyGateProps,
  dataRealmReadyGatePropsSubpath,
  DomainOnboarding,
  DomainOnboardingSubpath,
  ApiError,
  Button,
  AnimatedList,
  AnimatedListCard,
  AnimatedListSubpath,
  AppProvider,
  appProviderPostLoginPath,
  AppShell,
  AppShellSubpath,
  BentoGrid,
  BentoGridItem,
  BentoGridSubpath,
  CodeBlock,
  CodeBlockSubpath,
  CtaSection,
  CtaSectionSubpath,
  Check,
  Collapsible,
  CollapsibleSubpath,
  createIdentityId,
	  createSyncClient,
	  clientApiKeys,
	  clientDataRealm,
	  clientDataStudio,
	  dataStudioPublicTypes,
	  DATA_STUDIO_APP_TABLES_SUBPATH,
	  DATA_STUDIO_CLIENT_TABLES_SUBPATH,
	  normalizedDataStudioSubpathSchema,
	  DataStudio,
	  DataStudioFilterControlSubpath,
	  DataStudioSubpath,
	  DataStudioInlineCellSubpath,
	  DataStudioWorkspaceSubpath,
	  clientMutationRejection,
	  clientSubpathMutationRejection,
	  clientResourceFields,
	  dataTablePublicTypes,
	  DataTable,
	  buildDataTableServerQueryRoot,
	  buildDataTableServerQuerySubpath,
	  createDataTableApiAdapterRoot,
	  createDataTableApiAdapterSubpath,
	  DataTableBulkActionsRoot,
	  DataTableBulkActionsSubpath,
	  DataTableControlsRoot,
	  DataTableControlsSubpath,
  DataTableServerSourceErrorRoot,
  DataTableServerSourceErrorSubpath,
  DataTableSearch,
  DataTableSearchSubpath,
  DataTableToolbar,
  DataTableToolbarSubpath,
  DataTableView,
  useDataTableMutationRunnerRoot,
  useDataTableMutationRunnerSubpath,
  DropdownMenu,
  DropdownMenuSubpath,
  ExpandableCards,
  ExpandableCardsSubpath,
  Faq,
  FaqSubpath,
  FeaturesSection,
  FeaturesSectionSubpath,
  FooterSection,
  FooterSectionSubpath,
  groupKanbanItemIds,
  Hero,
  HeroSubpath,
  hasAuthorizationPermission,
  IdentityUserManagement,
  KanbanBoard,
  KanbanBoardSubpath,
	  PlatformApiKeyManagement,
	  PlatformApiKeyManagementSubpath,
	  PlatformWorkspaceManagement,
	  PlatformWorkspaceManagementSubpath,
	  PlatformUserManagement,
	  legacyLoginFormProps,
	  platformWorkspaceManagementProps,
	  platformUserManagementProps,
  PermissionGate,
  PermissionGateSubpath,
  Popover,
  PopoverContent,
  PopoverContentSubpath,
  popoverPublicTypes,
  PopoverSubpath,
  PopoverTrigger,
  PopoverTriggerSubpath,
  PlatformAdminGate,
  PlatformAdminGateSubpath,
  LoginForm,
	authRestorationState,
	  MasterDetailView,
	  masterDetailLazySource,
  MFAEnrollmentForm,
  TenantCreationForm,
  TenantCreationFormSubpath,
  TenantInvitationForm,
  TenantGate,
  TenantGateSubpath,
  TenantJoinRequestForm,
  TenantMemberApiKeyManagement,
  TenantMemberApiKeyManagementSubpath,
  TenantMemberManagement,
  TenantMemberManagementSubpath,
  TenantOnboardingManagement,
  TenantSelectionForm,
  TenantSelectionFormSubpath,
  TenantSwitcher,
  TenantSwitcherSubpath,
  TenantDomainManagement,
  TenantDomainManagementSubpath,
  domainReleaseInput,
  domainReleaseResult,
  releaseTenantDomainClaim,
  listTenants,
  createTenant,
  switchTenant,
  ModalManager,
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
  parseDataRealmReadinessSnapshot,
  QRCode,
  QRCodeSubpath,
  RadialMenu,
  RadialMenuSubpath,
  ResizableNavbar,
  ResizableNavbarSubpath,
  SidebarSubpath,
  SelfApiKeyManagement,
  SelfApiKeyManagementSubpath,
  SecretFieldRoot,
  SecretField,
  SecretFieldSubpath,
  secretFieldPublicTypes,
  StickToBottom,
  StorageManagement,
  StreamingTextRoot,
  StreamingText,
  StreamingTextSubpath,
  streamingTextPublicTypes,
  TextGenerateEffect,
  TextGenerateEffectSubpath,
  ThemeProvider,
  ThemeProviderSubpath,
  ThemeTogglerButton,
  Toaster,
  TypewriterEffect,
  UiButton,
  UiCheckbox,
  UiProgress,
  UiRadioGroup,
  UiRadioGroupItem,
  useCollection,
  useDataRealmReadiness,
  useDataRealmReadinessSubpath,
  useDataStudio,
  useDataStudioSubpath,
  useApplicationAccess,
  useApplicationAccessSubpath,
  useAuthApiKeys,
  useAuthApiKeysSubpath,
  useAuthConfig,
  useAuthConfigSubpath,
  useAuthAudit,
  useAuthAuditSubpath,
  useDomainOnboarding,
  useDomainOnboardingSubpath,
  useAuthorization,
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
  useAuthorizationScopeBoundarySubpath,
  useAuthorizationSubpath,
  useCollectionSubpath,
  useNativeAuthContinuation,
  useHasPermission,
  useHasPermissionSubpath,
	  usePlatformAdministration,
	  usePlatformAdministrationSubpath,
	  usePlatformTenants,
	  usePlatformTenantsSubpath,
  useResourceList,
  useResourceListSubpath,
  useTenantDomainAdministration,
  useTenantDomainAdministrationSubpath,
  useTenantMembers,
  useTenantMembersSubpath,
  useTenantOnboardingAdministration,
  useTenantOnboardingAdministrationSubpath,
  useTenantAppShellWorkspaces,
  useTenantAppShellWorkspacesSubpath,
  useTenantSwitcher,
  useTenantSwitcherSubpath,
  useWorkflow,
  useWorkflowActions,
  useWorkflowActionsSubpath,
  useWorkflowList,
  useWorkflowListSubpath,
  useWorkflowRun,
  useWorkflowRunSubpath,
  useWorkflowSubpath,
  useWorkflowTopology,
  useWorkflowTopologySubpath,
  workflowTopologyResult,
  workflowTopologyResultSubpath,
  workflowInteractionSubmissionResult,
  workflowInteractionSubmissionResultSubpath,
  useDisclosure,
  unwrap,
  FlipWords,
  WavyBackground,
  projectKanbanMove,
  row,
  toasterProps,
  administrationScopeGateProps,
  authConfigState,
  authConfigStatus,
  applicationAccessProps,
  applicationAdmin,
  platformAdmin,
  platformAddMember,
  platformIssueInvitation,
  platformRoleSelection,
  platformUpdateMemberInput,
  platformUpdateMember,
  platformTenantPage,
  platformAdministrationResult,
  platformAdministrationOptions,
  platformAdministrationOptionsSubpath,
  platformAdministrationResultSubpath,
  platformTenantsResult,
  tenantOnboardingAdministrationResult,
  tenantOnboardingAdministrationOptions,
  tenantOnboardingAdministrationOptionsSubpath,
  tenantOnboardingAdministrationResultSubpath,
  clientPlatformAdmin,
  auditEvent,
  auditSdk,
  auditViewerProps,
  authorizationState,
  authorizationScopeBoundary,
  domainAdministration,
  domainCompletion,
  tenantCreationFormProps,
  tenantMemberManagementProps,
  tenantSelectionFormProps,
  tenantSwitcherProps,
  tenantAppShellOptions,
  tenantAppShellWorkspaces,
};
`;

const nativeSmokeSource = `
import {
  createNativeAuthBrokerClient,
  createNativeSyncAuth,
  createZeroNativeAuthBroker,
  createZeroNativeAuth,
  type NativeIdentityScope,
  type NativeSyncAuthConfig,
  type NativeTenantListResult,
  type NativeTenantSummary,
  type ZeroNativeAuth,
  type ZeroNativeAuthOptions,
} from '@zero/framework/native';

export function configureNativeAuth(options: ZeroNativeAuthOptions): ZeroNativeAuth {
  const scopes: NativeIdentityScope[] = ['openid', 'profile', 'email'];
  void scopes;
  return createZeroNativeAuth(options);
}

export function configureBroker(options: ZeroNativeAuthOptions) {
  const broker = createZeroNativeAuthBroker(options);
  return createNativeAuthBrokerClient({
    serverUrl: options.serverUrl,
    transport: broker,
  });
}

export function configureNativeSync(auth: ZeroNativeAuth): NativeSyncAuthConfig {
  return createNativeSyncAuth(auth);
}

export function assertNativeTenantContract(auth: ZeroNativeAuth) {
  const list: Promise<NativeTenantListResult> = auth.listTenants();
  const switched = auth.switchTenant('tenant-id');
  const summary = {} as NativeTenantSummary;
  return { list, switched, summary };
}
`;
