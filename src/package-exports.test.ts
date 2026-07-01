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
import { createAuthPlugin, isPolicyTrustedUserProperty } from '@zero/framework/auth';
import { runPlatformDoctor } from '@zero/framework/doctor';
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
import { createResourceCrudPlugin as createSubpathResourceCrudPlugin, defineResource as defineSubpathResource, ownerPolicy as resourcesOwnerPolicy } from '@zero/framework/resources';
import { createRoomPlugin } from '@zero/framework/rooms';
import { createSchedulerPlugin } from '@zero/framework/scheduler';
import { defineTable, encodeFieldValue, field } from '@zero/framework/schema';
import {
  adminOnly,
  createApp,
  createResourceCrudPlugin,
  createUploadGrantToken,
  defineResource,
  getAI,
  getEmailService,
  getKvService,
  getPlatformTokenService,
  getPlatformSQLiteService,
  getResourceRegistry,
  getVectorStore,
  getWorkflowService,
  createKvPlugin,
  KvMemoryEngine,
  KvService,
  metadataPolicy,
  ownerPolicy,
  verifyUploadGrantToken,
} from '@zero/framework/server';
import {
  createStoragePlugin,
  createUploadGrantToken as createSubpathUploadGrantToken,
  verifyUploadGrantToken as verifySubpathUploadGrantToken,
} from '@zero/framework/storage';
import { createSyncPlugin } from '@zero/framework/sync';
import { PlatformTokenService } from '@zero/framework/tokens';
import { createVectorPlugin } from '@zero/framework/vector';
import { WorkflowService } from '@zero/framework/workflows';

export const serverSymbols = {
  AIService,
  createApp,
  createAuthPlugin,
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
  getResourceRegistry,
  getVectorStore,
  getWorkflowService,
  metadataPolicy,
  KvMemoryEngine,
  KvMemoryEngineSubpath,
  KvService,
  KvServiceSubpath,
  Migrator,
  OBS_CODES,
  ownerPolicy,
  PlatformTokenService,
  PURE_OBS_CODES,
  resourcesOwnerPolicy,
  runPlatformDoctor,
  verifySubpathUploadGrantToken,
  verifyUploadGrantToken,
  WorkflowService,
};
`;

const clientSmokeSource = `
import { LoginForm } from '@zero/framework/components/auth';
import { AppShell as AppShellSubpath } from '@zero/framework/components/app-shell';
import { Collapsible as CollapsibleSubpath } from '@zero/framework/components/collapsible';
import { DataTableView } from '@zero/framework/components/data-table';
import { DropdownMenu as DropdownMenuSubpath } from '@zero/framework/components/dropdown-menu';
import { KanbanBoard as KanbanBoardSubpath } from '@zero/framework/components/kanban';
import { MasterDetailView } from '@zero/framework/components/master-detail';
import { RadialMenu as RadialMenuSubpath } from '@zero/framework/components/radial-menu';
import { Sidebar as SidebarSubpath } from '@zero/framework/components/sidebar';
import { StorageManagement } from '@zero/framework/components/storage';
import { Button as UiButton } from '@zero/framework/components/ui/button';
import { ThemeProvider as ThemeProviderSubpath } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { useDisclosure } from '@zero/framework/hooks';
import { Check } from '@zero/framework/icons';
import { ModalManager } from '@zero/framework/modals';
import { AppProvider } from '@zero/framework/react/app-provider';
import { useCollection as useCollectionSubpath, useResourceList as useResourceListSubpath } from '@zero/framework/react/hooks';
import {
  Button,
  AppShell,
  Collapsible,
  DataTable,
  DropdownMenu,
  groupKanbanItemIds,
  KanbanBoard,
  RadialMenu,
  projectKanbanMove,
  StickToBottom,
  ThemeTogglerButton,
  ThemeProvider,
  useCollection,
  useResourceList,
} from '@zero/framework/react';
import { createSyncClient } from '@zero/framework/sync/client';
import { createIdentityId } from '@zero/framework/sync/identity';
import type { Row } from '@zero/framework/sync/types';
import type { ToasterProps } from '@zero/framework/react';

const row: Row = {};
const toasterProps: ToasterProps = {};

export const clientSymbols = {
  Button,
  AppProvider,
  AppShell,
  AppShellSubpath,
  Check,
  Collapsible,
  CollapsibleSubpath,
  createIdentityId,
  createSyncClient,
  DataTable,
  DataTableView,
  DropdownMenu,
  DropdownMenuSubpath,
  groupKanbanItemIds,
  KanbanBoard,
  KanbanBoardSubpath,
  LoginForm,
  MasterDetailView,
  ModalManager,
  RadialMenu,
  RadialMenuSubpath,
  SidebarSubpath,
  StickToBottom,
  StorageManagement,
  ThemeProvider,
  ThemeProviderSubpath,
  ThemeTogglerButton,
  Toaster,
  UiButton,
  useCollection,
  useCollectionSubpath,
  useResourceList,
  useResourceListSubpath,
  useDisclosure,
  projectKanbanMove,
  row,
  toasterProps,
};
`;
