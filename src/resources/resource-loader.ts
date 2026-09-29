/**
 * resource-loader.ts
 *
 * Discovers and imports app-owned resource definition modules from package-mode
 * resource folders. This file owns filesystem/module loading only; registry
 * validation and policy semantics live in resource-registry.ts and policy
 * modules.
 */

import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { isResourceDefinition, type ResourceDefinition } from './resource-definition';

const RESOURCE_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOURCE_EXPORT_KEYS = ['default', 'resource', 'resources'] as const;

/** Options for loading app-owned resource definition modules. */
export interface ResourceLoaderOptions {
  /** Conventional resource directory. Defaults to `./server/resources`. */
  resourcesDir?: string | false;
  /** App-owned observability target supplied by managed createApp(). */
  observability?: PlatformObservabilityRuntime;
}

/** Error thrown when a resource module export is invalid. */
export class ResourceLoaderError extends Error {
  constructor(message: string, readonly filePath: string) {
    super(message);
    this.name = 'ResourceLoaderError';
  }
}

/** Load app-owned resource definitions from a conventional resource directory. */
export async function loadResourceDefinitions(
  options: ResourceLoaderOptions = {}
): Promise<ResourceDefinition[]> {
  const resourcesDir = options.resourcesDir ?? './server/resources';
  if (!resourcesDir) return [];

  const resolvedDir = resolve(resourcesDir);
  if (!existsSync(resolvedDir)) return [];

  const files = await collectResourceFiles(resolvedDir);
  const resources: ResourceDefinition[] = [];

  for (const filePath of files) {
    try {
      const module = await import(pathToFileURL(filePath).href);
      resources.push(...normalizeResourceModule(module, filePath));
    } catch (error) {
      const emit = options.observability
        ? emitPlatformCodeTo.bind(null, options.observability)
        : emitPlatformCode;
      // The original import error still reaches the caller. Telemetry must not
      // retain its stack/message or the absolute module path.
      emit(OBS_CODES.RESOURCE_LOAD_FAILED, {
        metadata: { stage: 'module-import' },
      });
      throw error;
    }
  }

  return resources;
}

/**
 * Recursively collect resource module files in stable load order.
 *
 * Test/spec files and declaration files are skipped so colocated development
 * helpers do not get registered at runtime.
 */
export async function collectResourceFiles(resourcesDir: string): Promise<string[]> {
  const resolvedDir = resolve(resourcesDir);
  if (!existsSync(resolvedDir)) return [];
  if (!statSync(resolvedDir).isDirectory()) {
    throw new ResourceLoaderError(`[resources] Expected directory: ${resolvedDir}`, resolvedDir);
  }

  const files: string[] = [];
  await walkResourceDir(resolvedDir, files);
  return files.sort();
}

function normalizeResourceModule(module: unknown, filePath: string): ResourceDefinition[] {
  const resources = getResourceExports(module);

  if (resources.length === 0 || resources.some((resource) => !isResourceDefinition(resource))) {
    throw new ResourceLoaderError(
      `[resources] ${filePath} must export defineResource() output or an array from default/resource/resources.`,
      filePath
    );
  }

  return resources as ResourceDefinition[];
}

function getResourceExports(module: unknown): unknown[] {
  if (!module || typeof module !== 'object') return [];

  const exports = module as Record<string, unknown>;
  const values: unknown[] = [];
  const seen = new Set<unknown>();

  for (const key of RESOURCE_EXPORT_KEYS) {
    const value = exports[key];
    if (value === undefined) continue;

    for (const current of flattenExport(value)) {
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      values.push(current);
    }
  }

  return values;
}

async function walkResourceDir(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkResourceDir(entryPath, files);
      continue;
    }

    if (entry.isFile() && isResourceModuleFile(entry.name)) {
      files.push(entryPath);
    }
  }
}

function isResourceModuleFile(fileName: string): boolean {
  if (fileName.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName)) return false;
  for (const extension of RESOURCE_MODULE_EXTENSIONS) {
    if (fileName.endsWith(extension)) return true;
  }
  return false;
}

function flattenExport(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap((entry) => flattenExport(entry));
}
