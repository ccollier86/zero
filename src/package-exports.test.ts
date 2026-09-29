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
  });

  test('client-facing package subpaths build through the export map', async () => {
    await buildSmokeEntry('client.tsx', clientSmokeSource, 'browser');
  });

  test('native auth package subpath builds without React or server imports', async () => {
    await buildSmokeEntry('native.ts', nativeSmokeSource, 'browser');
  });
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
import { AIService } from '@zero/framework/ai';
import {
  ADMINISTRATION_TENANT_ROLE_KEYS,
  AuthApplicationAdministrationService,
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
  getAuthAuditService,
  installAuthStopBarrier,
  isAdministrationOnlyRole,
  isAdministrationTenantRoleKey,
  isPolicyTrustedUserProperty,
  isRoleAssignableToTenantKind,
  type NativeAuthorizationSourceResolver as AuthNativeSourceResolver,
} from '@zero/framework/auth';
import type {
  AccessRequirement,
  AuthAdministrationTenantConfig,
  AuthApplicationAdministrationConfig,
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
  IssuedPageSession,
  TenantKind,
  UserListOptions,
  UserStoreOptions,
  WebRefreshProof,
} from '@zero/framework/auth';
import { runPlatformDoctor, runUsageAudit } from '@zero/framework/doctor';
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
  ownerPolicy as resourcesOwnerPolicy,
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS as subpathResourceReceiptMaxKeys,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES as subpathResourceReceiptMaxResultBytes,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES as subpathResourceReceiptMaxRetainedBytes,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT as subpathResourceReceiptRetainedLimit,
  tenantRealm as resourcesTenantRealm,
} from '@zero/framework/resources';
import {
  RoomOwnerCannotLeaveError,
  createRoomPlugin,
} from '@zero/framework/rooms';
import { createSchedulerPlugin } from '@zero/framework/scheduler';
import { defineTable, encodeFieldValue, field } from '@zero/framework/schema';
import {
  adminOnly,
  createApp,
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
  createDatabaseRef,
  createNamedDatabaseRef,
  createTenantDatabaseRef,
  createAuthorizationKernel as createServerAuthorizationKernel,
  createResourceCrudPlugin,
  createUploadGrantToken,
  defineAuthConfig,
  defineNativeAuthConfig,
  defineDatabaseRealm,
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
  tenantRealm,
  runDatabaseActorIfRequested,
  verifyUploadGrantToken,
} from '@zero/framework/server';
import type {
  AppDatabasePlacementConfig,
  AuthAdministrationTenantConfig as ServerAuthAdministrationTenantConfig,
  AuthAuthorizationOwnerAdoptionConfig,
  AuthPermissionScope as ServerAuthPermissionScope,
  AuthTenantCreationConfig,
  AuthTenantCreationMode,
  AuthTenantTerminologyConfig,
  NativeAuthorizationSourceResolver,
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
  ZeroPolicyUserPropertyRegistry,
} from '@zero/framework/server';
import {
  createStoragePlugin,
  createUploadGrantToken as createSubpathUploadGrantToken,
  verifyUploadGrantToken as verifySubpathUploadGrantToken,
} from '@zero/framework/storage';
import { createSyncPlugin, type SyncPluginConfig } from '@zero/framework/sync';
import { PlatformTokenService } from '@zero/framework/tokens';
import { createVectorPlugin } from '@zero/framework/vector';
import { WorkflowService } from '@zero/framework/workflows';

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
const tenantDocuments = defineTable('tenant_documents', {
  tenant_id: field.text({ required: true }),
  title: field.text({ required: true }),
});
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

export const serverSymbols = {
  AIService,
  AuthApplicationAdministrationService,
  AuthAuditService,
  AuthPlatformTenantAdministrationService,
  AuthTenantAdministrationService,
  ADMINISTRATION_TENANT_ROLE_KEYS,
  AuthorizationKernel,
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
  createApp,
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
  defineDatabaseRealm,
  emptyDatabaseRealm,
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
  tenantRealm,
  resourcesTenantRealm,
  EmailService,
  field,
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
  RoomOwnerCannotLeaveError,
  runPlatformDoctor,
  runUsageAudit,
  runDatabaseActorIfRequested,
  syncPluginConfig,
  verifySubpathUploadGrantToken,
  verifyUploadGrantToken,
  WorkflowService,
};
`;

const clientSmokeSource = `
import {
  AdministrationScopeGate as AdministrationScopeGateSubpath,
  ApplicationAccessManagement as ApplicationAccessManagementSubpath,
  AuthFlowContinuation as AuthFlowContinuationSubpath,
  ControlPlaneAuditViewer as ControlPlaneAuditViewerSubpath,
  DomainOnboarding as DomainOnboardingSubpath,
  LoginForm,
  MFAEnrollmentForm,
  PermissionGate as PermissionGateSubpath,
  PlatformAdminGate as PlatformAdminGateSubpath,
  PlatformAdministrationManagement as PlatformAdministrationManagementSubpath,
  PlatformTenantManagement as PlatformTenantManagementSubpath,
  TenantCreationForm as TenantCreationFormSubpath,
  TenantInvitationForm,
  TenantGate as TenantGateSubpath,
  TenantJoinRequestForm,
  TenantMemberManagement as TenantMemberManagementSubpath,
  TenantOnboardingManagement,
  TenantSelectionForm as TenantSelectionFormSubpath,
  TenantSwitcher as TenantSwitcherSubpath,
  TenantDomainManagement as TenantDomainManagementSubpath,
} from '@zero/framework/components/auth';
import { AppShell as AppShellSubpath } from '@zero/framework/components/app-shell';
import { AnimatedList as AnimatedListSubpath } from '@zero/framework/components/animated-list';
import { BentoGrid as BentoGridSubpath } from '@zero/framework/components/bento-grid';
import { CodeBlock as CodeBlockSubpath } from '@zero/framework/components/code-block';
import { CtaSection as CtaSectionSubpath } from '@zero/framework/components/cta';
import { Collapsible as CollapsibleSubpath } from '@zero/framework/components/collapsible';
import { DataTableView } from '@zero/framework/components/data-table';
import { DropdownMenu as DropdownMenuSubpath } from '@zero/framework/components/dropdown-menu';
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
import { useDisclosure } from '@zero/framework/hooks';
import { Check } from '@zero/framework/icons';
import { ModalManager } from '@zero/framework/modals';
import { AppProvider } from '@zero/framework/react/app-provider';
import {
  useApplicationAccess as useApplicationAccessSubpath,
  useAuthConfig as useAuthConfigSubpath,
  useAuthAudit as useAuthAuditSubpath,
  useAuthorizationScopeBoundary as useAuthorizationScopeBoundarySubpath,
  useAuthorization as useAuthorizationSubpath,
  useCollection as useCollectionSubpath,
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
} from '@zero/framework/react/hooks';
import type {
  UsePlatformAdministrationOptions as UsePlatformAdministrationOptionsSubpath,
  UsePlatformAdministrationResult as UsePlatformAdministrationResultSubpath,
  UseTenantOnboardingAdministrationOptions as UseTenantOnboardingAdministrationOptionsSubpath,
  UseTenantOnboardingAdministrationResult as UseTenantOnboardingAdministrationResultSubpath,
} from '@zero/framework/react/hooks';
import {
  AdministrationScopeGate,
  ApplicationAccessManagement,
  AuthFlowContinuation,
  ControlPlaneAuditViewer,
  DomainOnboarding,
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
  KanbanBoard,
  PlatformAdministrationManagement,
  PlatformTenantManagement,
  PlatformUserManagement,
  PermissionGate,
  PlatformAdminGate,
  QRCode,
  RadialMenu,
  ResizableNavbar,
  projectKanbanMove,
  StickToBottom,
  TextGenerateEffect,
  ThemeTogglerButton,
  ThemeProvider,
  TooltipSubpath,
  TypewriterEffect,
  useCollection,
  useApplicationAccess,
  useAuthConfig,
  useAuthAudit,
  useDomainOnboarding,
  useAuthorization,
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
  useTenantAppShellWorkspaces,
  useTenantSwitcher,
  TenantCreationForm,
  TenantGate,
  TenantDomainManagement,
  TenantMemberManagement,
  TenantSelectionForm,
  TenantSwitcher,
  WavyBackground,
} from '@zero/framework/react';
import { createSyncClient } from '@zero/framework/sync/client';
import { createIdentityId } from '@zero/framework/sync/identity';
	import type { Row } from '@zero/framework/sync/types';
	import type { ComponentProps } from 'react';
import type { ToasterProps } from '@zero/framework/react';
import type {
  AdministrationScopeGateProps,
  ApplicationAccessManagementProps,
  AuthApplicationAdminSdkSurface,
  AuthAuditEvent,
  AuthAuditSdkSurface,
  AuthPlatformAddMemberParams,
  AuthPlatformAdminSdkSurface,
  AuthPlatformIssueInvitationParams,
  AuthPlatformRoleSelection,
  AuthPlatformTenantPage,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
  ControlPlaneAuditViewerProps,
  AuthAuthorizationState,
  AuthConfigState,
  AuthConfigStatus,
  AuthorizationScopeBoundary,
  AuthDomainOnboardingCompletion,
  AuthTenantDomainAdministration,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
	  AppShellWorkspaceConfig,
	  Client,
	  LoginFormProps,
  PlatformUserManagementProps,
  PlatformAdministrationManagementProps,
  PlatformTenantManagementProps,
	  TenantCreationFormProps,
  TenantMemberManagementProps,
  TenantSelectionFormProps,
  TenantSwitcherProps,
  UseTenantAppShellWorkspacesOptions,
  UsePlatformAdministrationOptions,
  UsePlatformAdministrationResult,
  UsePlatformTenantsResult,
  UseTenantOnboardingAdministrationOptions,
  UseTenantOnboardingAdministrationResult,
} from '@zero/framework/react';

	const row: Row = {};
	const toasterProps: ToasterProps = {};
	const administrationScopeGateProps = {} as AdministrationScopeGateProps;
	const authConfigState = {} as AuthConfigState;
	const authConfigStatus = 'ready' as AuthConfigStatus;
	const applicationAccessProps: ApplicationAccessManagementProps = {};
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
	const platformAdministrationManagementProps = {} as PlatformAdministrationManagementProps;
	const platformTenantManagementProps = {} as PlatformTenantManagementProps;
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
	const clientPlatformAdmin = {} as Client['platformAdmin'];
	type MasterDetailProps = ComponentProps<typeof MasterDetailView>;
	const masterDetailLazySource: MasterDetailProps['source'] = {
	  type: 'lazy',
	  table: 'users',
	  options: { limit: 25, order: 'created_at', dir: 'desc' },
	};

export const clientSymbols = {
  AdministrationScopeGate,
  AdministrationScopeGateSubpath,
  ApplicationAccessManagement,
  ApplicationAccessManagementSubpath,
  AuthFlowContinuation,
  AuthFlowContinuationSubpath,
  ControlPlaneAuditViewer,
  ControlPlaneAuditViewerSubpath,
  DomainOnboarding,
  DomainOnboardingSubpath,
  Button,
  AnimatedList,
  AnimatedListCard,
  AnimatedListSubpath,
  AppProvider,
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
	  clientResourceFields,
	  DataTable,
  DataTableView,
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
  KanbanBoard,
  KanbanBoardSubpath,
	  PlatformAdministrationManagement,
	  PlatformAdministrationManagementSubpath,
	  PlatformTenantManagement,
	  PlatformTenantManagementSubpath,
	  PlatformUserManagement,
	  legacyLoginFormProps,
	  platformAdministrationManagementProps,
	  platformTenantManagementProps,
	  platformUserManagementProps,
  PermissionGate,
  PermissionGateSubpath,
  PlatformAdminGate,
  PlatformAdminGateSubpath,
  LoginForm,
	  MasterDetailView,
	  masterDetailLazySource,
  MFAEnrollmentForm,
  TenantCreationForm,
  TenantCreationFormSubpath,
  TenantInvitationForm,
  TenantGate,
  TenantGateSubpath,
  TenantJoinRequestForm,
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
  QRCode,
  QRCodeSubpath,
  RadialMenu,
  RadialMenuSubpath,
  ResizableNavbar,
  ResizableNavbarSubpath,
  SidebarSubpath,
  StickToBottom,
  StorageManagement,
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
  useApplicationAccess,
  useApplicationAccessSubpath,
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
  useDisclosure,
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
