/**
 * A complete Fabric topology: one shared control database plus one physical
 * application database per authenticated tenant.
 */

import { fileURLToPath } from 'node:url';
import {
  createTenantDatabaseRef,
  defineZeroConfig,
  type DatabaseRef,
} from '@zero/framework/server';
import { resources } from './db/resources';
import { tables } from './db/schema';
import { tenantDatabaseRealm } from './db/tenant-realm';

const port = readPositiveInteger('PORT', 3210);
const hotTenantRefs = new Set<DatabaseRef>(
  readCsv('ZERO_HOT_TENANT_IDS').map(createTenantDatabaseRef),
);
const actorEntrypoint = fileURLToPath(new URL('./app/server.ts', import.meta.url));

export const config = defineZeroConfig({
  app: {
    name: 'Fabric Tenancy',
    publicUrl: readEnv('APP_PUBLIC_URL') ?? `http://localhost:${port}`,
  },

  // Auth, memberships, permissions, and all other platform internals stay in
  // this separately pinned control-plane database.
  db: {
    mode: 'file',
    path: readEnv('ZERO_CONTROL_DB_PATH') ?? './data/control.sqlite',
  },

  tables,
  resources,

  auth: {
    bootstrap: {
      mode: 'secret',
      secret: readEnv('AUTH_BOOTSTRAP_SECRET'),
    },
    registration: { mode: 'public' },
    tenancy: {
      mode: 'multi',
      terminology: { singular: 'workspace', plural: 'workspaces' },
      creation: { mode: 'authenticated' },
    },
    authorization: {
      mode: 'advanced',
      permissions: {
        'tasks:read': {
          label: 'Read tasks',
          description: 'View tasks in the active workspace.',
        },
        'tasks:write': {
          label: 'Manage tasks',
          description: 'Create, edit, complete, and delete tasks in the active workspace.',
        },
      },
      roles: {
        'task-reader': {
          label: 'Task reader',
          permissions: ['tasks:read'],
        },
        'task-editor': {
          label: 'Task editor',
          permissions: ['tasks:read', 'tasks:write'],
        },
      },
    },
  },

  databaseTopology: {
    mode: 'multiple',
    rootDirectory: readEnv('ZERO_TENANT_DATABASE_ROOT') ?? './data/tenants',
    realm: tenantDatabaseRealm,
    actors: {
      launch: {
        kind: 'source',
        entrypoint: actorEntrypoint,
      },
    },
    tenantIsolation: 'tenant-database',
    placement: {
      default: 'file',
      select: ({ databaseRef }) => (
        hotTenantRefs.has(databaseRef) ? 'hot' : 'file'
      ),
      hot: {
        durability: 'on-write',
        maxBytes: readPositiveInteger('ZERO_HOT_MAX_BYTES', 64 * 1024 * 1024),
      },
    },
  },

  routeAuth: 'protected-by-default',
  loginPath: '/login',
  registrationPath: '/register',
  stateSync: false,
  email: false,
  ai: false,
  vector: false,
  pdf: false,
  kv: false,
  appDir: './app',
  outDir: './.build',
  generatedDir: './.zero/generated',
  serverPluginsDir: false,
  serverMiddlewareDir: false,
  serverEndpointsDir: false,
  serverRoutesDir: false,
  serverResourcesDir: false,
  port,
});

export default config;

function readEnv(name: string): string | undefined {
  const value = Bun.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
function readCsv(name: string): string[] {
  const value = readEnv(name);
  if (!value) return [];
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds JavaScript's safe integer range.`);
  }
  return parsed;
}
