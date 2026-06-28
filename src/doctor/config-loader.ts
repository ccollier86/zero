/**
 * config-loader.ts
 *
 * Loads a Zero createApp config module for doctor CLI checks. This file owns
 * module-shape normalization only; it must not start an app server or mutate
 * runtime state.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../frontend/server/types';

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
 * Load an AppConfig from a module.
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

  return candidate as AppConfig;
}
