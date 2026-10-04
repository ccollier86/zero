/**
 * ai-env.ts
 *
 * Coordinates AI configuration resolution from createApp config and Bun's
 * environment. Provider activation, environment parsing, and model selection
 * live in focused modules; this file owns only the public resolution boundary.
 */

import type { AIConfig, ResolvedAIConfig } from './ai-types';
import {
  detectAIEnvProviders,
  resolveExplicitAIProviders,
} from './ai-env-provider-resolution';
import {
  resolveAIEnvAliases,
  resolveAIEnvFilesProvider,
} from './ai-env-selection';
import type { AIEnv } from './ai-env-values';

export type { AIEnv } from './ai-env-values';

const DEFAULT_STATUS_BASE_PATH = '/api/_zero/ai';

/** Resolve AI config accepted by `createApp()`. */
export function resolveAIConfig(
  input: boolean | AIConfig | undefined,
  env: AIEnv = Bun.env
): ResolvedAIConfig | false {
  if (input === false || input === undefined) return false;

  const config: AIConfig = input === true ? {} : input;
  const autoDetect = config.autoDetect !== false;
  const explicitProviders = resolveExplicitAIProviders(config.providers ?? {}, env);
  const autoProviders = autoDetect
    ? detectAIEnvProviders(env, explicitProviders)
    : {};
  const providers = { ...autoProviders, ...explicitProviders };
  const aliases = resolveAIEnvAliases(config.aliases ?? {}, providers, env);
  const filesProvider = resolveAIEnvFilesProvider(config.filesProvider, env);
  const statusEndpoint = config.statusEndpoint === false || config.statusEndpoint === undefined
    ? { enabled: false, basePath: DEFAULT_STATUS_BASE_PATH }
    : {
        enabled: config.statusEndpoint.enabled !== false,
        basePath: config.statusEndpoint.basePath ?? DEFAULT_STATUS_BASE_PATH,
        read: config.statusEndpoint.read,
      };

  return {
    enabled: true,
    autoDetect,
    providers,
    aliases,
    filesProvider,
    statusEndpoint,
  };
}
