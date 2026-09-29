/**
 * server-route-loader.ts
 *
 * Discovers and imports app-owned backend extensions from package-mode server
 * folders. This file owns filesystem module loading only; extension shape and
 * Elysia mounting live in server-extensions.ts.
 */

import { existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../../observability/sink';
import {
  createServerExtensionApp,
  isServerRoutePlugin,
  isZeroServerExtension,
  type ServerRoutePlugin,
  type ZeroServerExtensionMountable,
} from './server-extensions';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_OBSERVABILITY_RUNTIME } from '../../runtime/service-keys';

const ROUTE_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXPORT_KEYS = [
  'default',
  'endpoint',
  'endpoints',
  'middleware',
  'plugin',
  'plugins',
  'router',
  'routers',
  'routes',
] as const;

export type { ServerRoutePlugin } from './server-extensions';

export type ServerRouteExtensionDirectoryKind = 'plugins' | 'middleware' | 'endpoints' | 'routes';

/** One app-owned backend extension directory to scan. */
export interface ServerRouteExtensionDirectory {
  kind: ServerRouteExtensionDirectoryKind;
  dir?: string | false;
}

/** Options for loading app-owned Elysia server route modules. */
export interface ServerRouteLoaderOptions {
  /** Backwards-compatible route directory. Defaults to `./server/routes`. */
  routesDir?: string;
  /** Ordered extension directories. When provided, routesDir is ignored. */
  extensionDirs?: ServerRouteExtensionDirectory[];
  /** App-local runtime supplied by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
}

/** Error thrown when an app-owned route module has an invalid export. */
export class ServerRouteLoaderError extends Error {
  constructor(message: string, readonly filePath: string) {
    super(message);
    this.name = 'ServerRouteLoaderError';
  }
}

/**
 * Load app-owned backend extensions from configured server directories.
 *
 * Missing directories resolve to an empty list so generated starter apps can
 * opt into server routes only when they add files. Invalid modules throw
 * because silently skipping user backend code would hide production defects.
 */
export async function loadServerRoutePlugins(
  options: ServerRouteLoaderOptions = {}
): Promise<ServerRoutePlugin[]> {
  const observability = options.runtime?.get(ZERO_OBSERVABILITY_RUNTIME);
  const emit = observability
    ? emitPlatformCodeTo.bind(null, observability)
    : emitPlatformCode;
  const directories = resolveExtensionDirectories(options);
  const loadedFiles: string[] = [];
  const extensions: ZeroServerExtensionMountable[] = [];

  for (const directory of directories) {
    if (!directory.dir) continue;

    const resolvedDir = resolve(directory.dir);
    if (!existsSync(resolvedDir)) continue;

    const files = await collectServerRouteFiles(resolvedDir);
    for (const filePath of files) {
      try {
        const routeModule = await import(pathToFileURL(filePath).href);
        extensions.push(...normalizeServerRouteModule(routeModule, filePath));
        loadedFiles.push(filePath);
      } catch (error) {
        emit(OBS_CODES.ROUTER_SERVER_ROUTE_LOAD_FAILED, {
          metadata: { directoryKind: directory.kind },
        });
        throw error;
      }
    }
  }

  if (extensions.length > 0) {
    emit(OBS_CODES.ROUTER_SERVER_ROUTES_LOADED, {
      metadata: {
        directoryKinds: directories
          .filter((directory) => Boolean(directory.dir))
          .map((directory) => directory.kind),
        modules: loadedFiles.length,
        plugins: extensions.length,
      },
    });
  }

  return extensions.length === 0
    ? []
    : [await createServerExtensionApp({ extensions, runtime: options.runtime })];
}

/**
 * Recursively collect server route module files in stable load order.
 *
 * Test/spec files and declaration files are skipped so colocated development
 * helpers do not get mounted as runtime routes.
 */
export async function collectServerRouteFiles(routesDir: string): Promise<string[]> {
  const resolvedDir = resolve(routesDir);
  if (!existsSync(resolvedDir)) return [];
  if (!statSync(resolvedDir).isDirectory()) {
    throw new ServerRouteLoaderError(`[server-routes] Expected directory: ${resolvedDir}`, resolvedDir);
  }

  const files: string[] = [];
  await walkRouteDir(resolvedDir, files);
  return files.sort();
}

async function walkRouteDir(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkRouteDir(entryPath, files);
      continue;
    }

    if (entry.isFile() && isRouteModuleFile(entry.name)) {
      files.push(entryPath);
    }
  }
}

function isRouteModuleFile(fileName: string): boolean {
  if (fileName.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName)) return false;
  for (const extension of ROUTE_MODULE_EXTENSIONS) {
    if (fileName.endsWith(extension)) return true;
  }
  return false;
}

function normalizeServerRouteModule(module: unknown, filePath: string): ZeroServerExtensionMountable[] {
  const extensions = getRouteExports(module);

  if (extensions.length === 0 || extensions.some((extension) => !isValidServerExtensionExport(extension))) {
    throw new ServerRouteLoaderError(
      `[server-routes] ${filePath} must export a Zero endpoint/router/middleware/plugin, Elysia plugin, plugin callback, or array from default/routes/plugin/endpoints/middleware.`,
      filePath
    );
  }

  return extensions;
}

function getRouteExports(module: unknown): ZeroServerExtensionMountable[] {
  if (!module || typeof module !== 'object') return [];

  const exports = module as Record<string, unknown>;
  const values: ZeroServerExtensionMountable[] = [];
  const seen = new Set<unknown>();

  for (const key of EXPORT_KEYS) {
    const value = exports[key];
    if (value === undefined) continue;

    for (const current of flattenExport(value)) {
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      values.push(current as ZeroServerExtensionMountable);
    }
  }

  return values;
}

function flattenExport(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap((entry) => flattenExport(entry));
}

function isValidServerExtensionExport(value: unknown): boolean {
  return isZeroServerExtension(value) || isServerRoutePlugin(value);
}

function resolveExtensionDirectories(options: ServerRouteLoaderOptions): ServerRouteExtensionDirectory[] {
  if (options.extensionDirs) return options.extensionDirs;

  return [
    {
      kind: 'routes',
      dir: options.routesDir ?? './server/routes',
    },
  ];
}
