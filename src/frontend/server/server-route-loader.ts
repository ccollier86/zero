/**
 * server-route-loader.ts
 *
 * Discovers and imports app-owned Elysia route plugins from `server/routes`.
 * This file owns filesystem route-module loading only; it does not define app
 * routes, mutate platform services, or inspect React file-router modules.
 */

import { existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { AnyElysia, MaybePromise } from 'elysia';

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';

const ROUTE_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Elysia plugin shapes accepted from app-owned route modules. */
export type ServerRoutePlugin = AnyElysia | ((app: AnyElysia) => MaybePromise<AnyElysia>);

/** Options for loading app-owned Elysia server route modules. */
export interface ServerRouteLoaderOptions {
  /** Directory to scan recursively. Defaults to `./server/routes`. */
  routesDir?: string;
}

/** Error thrown when an app-owned route module has an invalid export. */
export class ServerRouteLoaderError extends Error {
  constructor(message: string, readonly filePath: string) {
    super(message);
    this.name = 'ServerRouteLoaderError';
  }
}

/**
 * Load app-owned Elysia route plugins from a routes directory.
 *
 * Missing directories resolve to an empty list so generated starter apps can
 * opt into server routes only when they add files. Invalid route modules throw
 * because silently skipping user API code would hide production defects.
 */
export async function loadServerRoutePlugins(
  options: ServerRouteLoaderOptions = {}
): Promise<ServerRoutePlugin[]> {
  const routesDir = resolve(options.routesDir ?? './server/routes');
  if (!existsSync(routesDir)) return [];

  const files = await collectServerRouteFiles(routesDir);
  const plugins: ServerRoutePlugin[] = [];

  for (const filePath of files) {
    try {
      const routeModule = await import(pathToFileURL(filePath).href);
      plugins.push(...normalizeServerRouteModule(routeModule, filePath));
    } catch (error) {
      emitPlatformCode(OBS_CODES.ROUTER_SERVER_ROUTE_LOAD_FAILED, {
        error,
        metadata: { filePath },
      });
      throw error;
    }
  }

  if (plugins.length > 0) {
    emitPlatformCode(OBS_CODES.ROUTER_SERVER_ROUTES_LOADED, {
      metadata: {
        routesDir,
        modules: files.length,
        plugins: plugins.length,
      },
    });
  }

  return plugins;
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

function normalizeServerRouteModule(module: unknown, filePath: string): ServerRoutePlugin[] {
  const value = getRouteExport(module);
  const plugins = Array.isArray(value) ? value : [value];

  if (plugins.length === 0 || plugins.some((plugin) => !isServerRoutePlugin(plugin))) {
    throw new ServerRouteLoaderError(
      `[server-routes] ${filePath} must export an Elysia plugin, plugin callback, or array from default/routes/plugin.`,
      filePath
    );
  }

  return plugins as ServerRoutePlugin[];
}

function getRouteExport(module: unknown): unknown {
  if (!module || typeof module !== 'object') return undefined;
  const value = module as {
    default?: unknown;
    plugin?: unknown;
    routes?: unknown;
  };
  return value.default ?? value.plugin ?? value.routes;
}

function isServerRoutePlugin(value: unknown): value is ServerRoutePlugin {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;

  const candidate = value as {
    handle?: unknown;
    use?: unknown;
  };
  return typeof candidate.handle === 'function' && typeof candidate.use === 'function';
}
