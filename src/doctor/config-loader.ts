/**
 * config-loader.ts
 *
 * Loads a Zero createApp config module for doctor CLI checks. This file owns
 * module-shape normalization only; it must not start an app server or mutate
 * runtime state.
 */

import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../frontend/server/types';
import { loadResourceDefinitions } from '../resources/resource-loader';

const DEFAULT_CONFIG_PATHS = [
  './zero.config.ts',
  './zero.config.js',
  './config/zero.config.ts',
  './config/zero.config.js',
];

/** Resolve the config path passed to the doctor CLI or a conventional default. */
export function resolveDoctorConfigPath(input?: string | null): string | null {
  if (input) return resolve(input);
  for (const candidate of DEFAULT_CONFIG_PATHS) {
    const absolute = resolve(candidate);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

/**
 * Load an AppConfig and the same conventional server resource modules that
 * `createApp()` validates at startup.
 *
 * The module may export `config`, `appConfig`, `zeroConfig`, or default.
 */
export async function loadDoctorConfig(modulePath: string): Promise<AppConfig> {
  const url = `${pathToFileURL(modulePath).href}?t=${Date.now()}`;
  const module = await import(url);
  const candidate = module.config ?? module.appConfig ?? module.zeroConfig ?? module.default;

  if (!candidate || typeof candidate !== 'object') {
    throw new Error(
      `[doctor] Could not find a Zero app config in ${modulePath}. ` +
      'Export `config`, `appConfig`, `zeroConfig`, or a default AppConfig.'
    );
  }

  const config = candidate as AppConfig;
  const projectRoot = doctorProjectRoot(modulePath);
  const configuredDir = config.serverResourcesDir;
  const resourcesDir = configuredDir === false
    ? false
    : isAbsolute(configuredDir ?? '')
      ? configuredDir!
      : resolve(projectRoot, configuredDir ?? './server/resources');
  const discovered = await loadResourceDefinitions({ resourcesDir });

  return discovered.length === 0
    ? config
    : {
        ...config,
        resources: [...(config.resources ?? []), ...discovered],
      };
}

function doctorProjectRoot(modulePath: string): string {
  const configDir = dirname(resolve(modulePath));
  return basename(configDir) === 'config' ? dirname(configDir) : configDir;
}
