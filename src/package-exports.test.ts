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
import { AIService } from '@zero/framework/ai';
import {
  createAuthPlugin,
  installAuthStopBarrier,
  isPolicyTrustedUserProperty,
  type NativeAuthorizationSourceResolver as AuthNativeSourceResolver,
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
import { createPlatformSQLiteService } from '@zero/framework/persistence';
import { PdfService, getPdfService as getPdfServiceSubpath } from '@zero/framework/pdf';
import { createResourceCrudPlugin as createSubpathResourceCrudPlugin, defineResource as defineSubpathResource, ownerPolicy as resourcesOwnerPolicy } from '@zero/framework/resources';
import { createRoomPlugin } from '@zero/framework/rooms';
import { createSchedulerPlugin } from '@zero/framework/scheduler';
import { defineTable, encodeFieldValue, field } from '@zero/framework/schema';
import {
  adminOnly,
  createApp,
  createResourceCrudPlugin,
  createUploadGrantToken,
  defineNativeAuthConfig,
  defineResource,
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
  verifyUploadGrantToken,
} from '@zero/framework/server';
import type {
  AppConfig,
  NativeAuthorizationSourceResolver,
  ResolvedConfig,
} from '@zero/framework/server';
import {
  createStoragePlugin,
  createUploadGrantToken as createSubpathUploadGrantToken,
  verifyUploadGrantToken as verifySubpathUploadGrantToken,
} from '@zero/framework/storage';
import { createSyncPlugin } from '@zero/framework/sync';
import { PlatformTokenService } from '@zero/framework/tokens';
import { createVectorPlugin } from '@zero/framework/vector';
import {
  WorkflowActivityCatalog,
  WorkflowService,
  expr,
  flow,
  normalizeWorkflowSchemaSnapshot,
  step,
  type WorkflowChooseOptions,
  type WorkflowClientInteractionRecord,
  type WorkflowInteractionRecord,
  type WorkflowMemoryContext,
} from '@zero/framework/workflows';

const nativeSourceResolver: NativeAuthorizationSourceResolver = () => 'trusted-edge';
const authNativeSourceResolver: AuthNativeSourceResolver = () => 'trusted-edge';
const configuredPostLoginPath = (config: AppConfig): string | undefined => config.postLoginPath;
const resolvedPostLoginPath = (config: ResolvedConfig): string => config.postLoginPath;
const workflowDefinition = flow(step('start', 'smoke.activity', { input: expr.input() }));
const workflowChooseOptions: WorkflowChooseOptions = { label: 'Smoke choice' };
const workflowTypeSurface = null as unknown as {
  clientInteraction: WorkflowClientInteractionRecord;
  interaction: WorkflowInteractionRecord;
  memory: WorkflowMemoryContext;
};

export const serverSymbols = {
  AIService,
  authNativeSourceResolver,
  configuredPostLoginPath,
  createApp,
  createAuthPlugin,
  installAuthStopBarrier,
  installServerAuthStopBarrier,
  isPolicyTrustedUserProperty,
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
  defineResource,
  defineSubpathResource,
  defineTable,
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
  resolvedPostLoginPath,
  runPlatformDoctor,
  runUsageAudit,
  verifySubpathUploadGrantToken,
  verifyUploadGrantToken,
  workflowChooseOptions,
  workflowDefinition,
  workflowTypeSurface,
  WorkflowActivityCatalog,
  WorkflowService,
  normalizeWorkflowSchemaSnapshot,
};
`;

const clientSmokeSource = `
import { LoginForm, MFAEnrollmentForm } from '@zero/framework/components/auth';
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
  useCollection as useCollectionSubpath,
  useResourceList as useResourceListSubpath,
  useWorkflow as useWorkflowSubpath,
  useWorkflowActions as useWorkflowActionsSubpath,
  useWorkflowList as useWorkflowListSubpath,
  useWorkflowRun as useWorkflowRunSubpath,
} from '@zero/framework/react/hooks';
import {
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
  DropdownMenu,
  ExpandableCards,
  Faq,
  FeaturesSection,
  FlipWords,
  FooterSection,
  groupKanbanItemIds,
  Hero,
  KanbanBoard,
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
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
  useNativeAuthContinuation,
  useResourceList,
  useWorkflow,
  useWorkflowActions,
  useWorkflowList,
  useWorkflowRun,
  unwrap,
  WavyBackground,
} from '@zero/framework/react';
import { createSyncClient } from '@zero/framework/sync/client';
import { createIdentityId } from '@zero/framework/sync/identity';
	import type { Row } from '@zero/framework/sync/types';
	import type { ComponentProps } from 'react';
	import type {
	  AppProviderProps,
	  AuthState,
	  ToasterProps,
	} from '@zero/framework/react';

	const row: Row = {};
	const toasterProps: ToasterProps = {};
	const appProviderPostLoginPath = (props: AppProviderProps): string | undefined => props.postLoginPath;
	const authRestorationState = (state: AuthState): boolean => state.isRestoring;
	type MasterDetailProps = ComponentProps<typeof MasterDetailView>;
	const masterDetailLazySource: MasterDetailProps['source'] = {
	  type: 'lazy',
	  table: 'users',
	  options: { limit: 25, order: 'created_at', dir: 'desc' },
	};

	export const clientSymbols = {
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
  KanbanBoard,
  KanbanBoardSubpath,
  LoginForm,
	authRestorationState,
	  MasterDetailView,
	  masterDetailLazySource,
	  MFAEnrollmentForm,
  ModalManager,
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
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
  useCollectionSubpath,
  useNativeAuthContinuation,
  useResourceList,
  useResourceListSubpath,
  useWorkflow,
  useWorkflowActions,
  useWorkflowActionsSubpath,
  useWorkflowList,
  useWorkflowListSubpath,
  useWorkflowRun,
  useWorkflowRunSubpath,
  useWorkflowSubpath,
  useDisclosure,
  unwrap,
  FlipWords,
  WavyBackground,
  projectKanbanMove,
  row,
  toasterProps,
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
`;
