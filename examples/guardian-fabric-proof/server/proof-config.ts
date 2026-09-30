/** Pure configuration factory shared by the runnable proof and its integration test. */

import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import {
  defineZeroConfig,
  type AuthBootstrapConfig,
  type ObservabilityConfig,
  type PlatformSQLiteService,
} from '@zero/framework/server';

import { tables } from '../db/schema';
import { guardianFabricTenantRealm } from '../db/tenant-realm';
import { tasksResource } from './resources/tasks';

export interface GuardianFabricProofPaths {
  readonly applicationDatabase: string;
  readonly systemDatabase: string;
  readonly tenantDatabases: string;
  readonly app: string;
  readonly storage: string;
  readonly generated: string;
  readonly output: string;
}

export interface GuardianFabricProofConfigOptions {
  readonly port?: number;
  readonly publicUrl?: string;
  readonly bootstrap?: AuthBootstrapConfig;
  readonly actorEntrypoint?: string;
  readonly observability?: ObservabilityConfig;
  readonly paths?: Partial<GuardianFabricProofPaths>;
  /** Test/runtime-owned handles; the declared path remains authoritative. */
  readonly sqlite?: Readonly<{
    application?: PlatformSQLiteService;
    system?: PlatformSQLiteService;
  }>;
}

const DEFAULT_PATHS: GuardianFabricProofPaths = Object.freeze({
  applicationDatabase: './data/application.db',
  systemDatabase: './data/system.db',
  tenantDatabases: './data/tenant-databases',
  app: './app',
  storage: './data/storage',
  generated: './.zero/generated',
  output: './.build',
});

const DEFAULT_ACTOR_ENTRYPOINT = fileURLToPath(new URL('../app/server.ts', import.meta.url));

/**
 * Build the exact Guardian + Fabric proof contract without reading process
 * state or opening files. Callers must inject environment-derived values.
 */
export function createGuardianFabricProofConfig(
  options: GuardianFabricProofConfigOptions = {},
) {
  const port = validPort(options.port ?? 3100);
  const paths = proofPaths(options.paths);
  assertInjectedDatabasePath(
    'application',
    paths.applicationDatabase,
    options.sqlite?.application,
  );
  assertInjectedDatabasePath('system', paths.systemDatabase, options.sqlite?.system);

  return defineZeroConfig({
    app: {
      name: 'Guardian + Fabric Proof',
      publicUrl: options.publicUrl ?? `http://localhost:${port}`,
    },
    port,
    db: {
      mode: 'file',
      path: paths.applicationDatabase,
      ...(options.sqlite?.application
        ? { sqlite: options.sqlite.application }
        : {}),
    },
    systemDb: {
      mode: 'file',
      path: paths.systemDatabase,
      ...(options.sqlite?.system ? { sqlite: options.sqlite.system } : {}),
    },
    tables,
    auth: {
      bootstrap: options.bootstrap ?? { mode: 'secret' },
      registration: { mode: 'public' },
      tenancy: {
        mode: 'multi',
        terminology: {
          singular: 'workspace',
          plural: 'workspaces',
        },
        creation: { mode: 'authenticated' },
        onboarding: {
          invitations: {
            enabled: true,
            accountCreation: true,
            delivery: {
              default: 'manual',
              allowManual: true,
              email: {
                enabled: false,
                landingPath: '/accept-invitation',
              },
            },
          },
          // This focused proof exposes exact-email invitations end to end. Join
          // requests need a separate public/domain admission surface, so leaving
          // them disabled keeps the packaged administration UI honest.
          joinRequests: { enabled: false },
        },
      },
      authorization: {
        mode: 'advanced',
        registryVersion: 2,
        permissions: {
          'tasks:read': {
            scope: 'tenant',
            label: 'Read assigned tasks',
            description: 'Read tasks attributed to the active workspace membership.',
          },
          'tasks:read:any': {
            scope: 'tenant',
            label: 'Read every task',
            description: 'Read every task in the active workspace database.',
          },
          'tasks:create': {
            scope: 'tenant',
            label: 'Create assigned tasks',
            description: 'Create tasks stamped to the active Guardian user and membership.',
          },
          'tasks:update:own': {
            scope: 'tenant',
            label: 'Update assigned tasks',
            description: 'Update tasks owned by the active Guardian user and membership.',
          },
          'tasks:manage': {
            scope: 'tenant',
            label: 'Manage every task',
            description: 'Read, update, and remove every task in the active workspace database.',
          },
        },
        roles: {
          viewer: {
            label: 'Task viewer',
            permissions: ['tasks:read', 'tasks:read:any'],
          },
          editor: {
            label: 'Task contributor',
            permissions: ['tasks:read', 'tasks:create', 'tasks:update:own'],
          },
          manager: {
            label: 'Task manager',
            permissions: [
              'tasks:read',
              'tasks:read:any',
              'tasks:create',
              'tasks:update:own',
              'tasks:manage',
            ],
          },
        },
      },
      apiKeys: {
        enabled: true,
        selfService: true,
        administratorIssuance: true,
        defaultTTL: '7d',
        maxTTL: '30d',
        maxActivePerUser: 5,
      },
      accountEmails: {
        passwordReset: false,
      },
    },
    routeAuth: 'explicit',
    loginPath: '/login',
    postLoginPath: '/app',
    publicPaths: ['/login', '/register', '/accept-invitation'],
    databaseTopology: {
      mode: 'multiple',
      rootDirectory: paths.tenantDatabases,
      realm: guardianFabricTenantRealm,
      actors: {
        launch: {
          kind: 'source',
          entrypoint: options.actorEntrypoint ?? DEFAULT_ACTOR_ENTRYPOINT,
        },
      },
      tenantIsolation: 'tenant-database',
      placement: 'file',
      readers: true,
      maxDatabases: 32,
      maxDatabaseFiles: 1_000,
      maxTenantSyncDatabases: 24,
      maxTenantSyncBindingsPerDatabase: 32,
    },
    stateSync: false,
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
    sitemap: false,
    appDir: paths.app,
    resources: [tasksResource],
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    storageDir: paths.storage,
    generatedDir: paths.generated,
    outDir: paths.output,
    observability: options.observability ?? {
      console: true,
      endpoint: false,
    },
    doctor: {
      // These non-unique indexes are installed by the tenant realm migration.
      indexedFields: {
        tasks: ['created_by_user_id', 'assigned_membership_id'],
      },
    },
  });
}

function validPort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError('Guardian + Fabric proof port must be an integer from 1 through 65535.');
  }
  return value;
}

function proofPaths(
  overrides: Partial<GuardianFabricProofPaths> | undefined,
): GuardianFabricProofPaths {
  const paths = { ...DEFAULT_PATHS, ...overrides };
  for (const [name, value] of Object.entries(paths)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`Guardian + Fabric proof path "${name}" must be non-empty.`);
    }
  }
  return Object.freeze(paths);
}

function assertInjectedDatabasePath(
  plane: 'application' | 'system',
  declaredPath: string,
  sqlite: PlatformSQLiteService | undefined,
): void {
  if (!sqlite) return;
  if (sqlite.mode !== 'file'
    || sqlite.path === null
    || resolvePath(sqlite.path) !== resolvePath(declaredPath)) {
    throw new TypeError(
      `Injected ${plane} SQLite service must be file-backed at its declared proof path.`,
    );
  }
}
