/**
 * ai.plugin.ts
 *
 * Elysia integration for Zero's internal AI service. This plugin owns service
 * decoration and the optional status endpoint only; provider execution stays
 * in AIService and authorization remains explicit at the HTTP boundary.
 */

import { Elysia } from 'elysia';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import { AIService } from './ai-service';
import type { AIStatusEndpointReadMode, ResolvedAIConfig } from './ai-types';
import {
  emitAICodeSafely,
  emitAIProviderStatus,
  type AIEmitCode,
} from './ai-observability';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { ZERO_AI_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';

const aiProviders = new CompatibilityProviderRegistry<AIService>('AI service');

/** Options for mounting the Zero AI Elysia plugin. */
export interface AIPluginConfig {
  config: ResolvedAIConfig;
  authEnabled?: boolean;
  service?: AIService;
  runtime?: ZeroAppRuntime;
  onServiceCreated?: (service: AIService) => void;
}

/**
 * Create the named Elysia plugin that decorates the request context with `ai`.
 *
 * The status endpoint never returns provider secrets. Read access defaults to
 * admin-only with auth and development-only without auth.
 */
export function createAIPlugin(options: AIPluginConfig) {
  const observability = options.runtime?.get(ZERO_OBSERVABILITY_RUNTIME);
  const boundEmitCode: AIEmitCode | undefined = observability == null
    ? undefined
    : (definition, emitOptions) => emitPlatformCodeTo(
        observability,
        definition,
        emitOptions,
      );
  const emitCode = boundEmitCode ?? emitPlatformCode;
  const service = options.service ?? new AIService(options.config, { emitCode });
  const owner = {};
  let started = false;
  const registration = aiProviders.register(owner, () => started ? service : null);
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    started = false;
    options.runtime?.clear(ZERO_AI_SERVICE, service);
    registration.unregister();
  };
  let removeRuntimeCleanup: (() => void) | undefined;
  try {
    options.runtime?.set(ZERO_AI_SERVICE, service);
    removeRuntimeCleanup = options.runtime?.addCleanup(cleanup);
    options.onServiceCreated?.(service);
  } catch (error) {
    removeRuntimeCleanup?.();
    cleanup();
    throw error;
  }

  const endpoint = options.config.statusEndpoint;
  const readMode = endpoint.read ?? (options.authEnabled ? 'admin' : 'development');

  const app = new Elysia({ name: 'zero-platform-ai' })
    .decorate('ai', service)
    .onStart(() => {
      started = true;
      emitAICodeSafely(emitCode, OBS_CODES.AI_CONFIGURED, {
        metadata: {
          providers: service.status().providers.length,
          aliases: Object.keys(service.status().aliases),
        },
      });
      for (const provider of service.status().providers) {
        if (!provider.active && provider.source === 'env' && provider.configuredBy.length === 0) continue;
        emitAIProviderStatus({
          providerId: provider.id,
          providerType: provider.type,
          active: provider.active,
          reason: provider.reason,
        }, emitCode);
      }
    })
    .onStop(() => {
      cleanup();
    });

  if (!endpoint.enabled) return app;

  return app.group(endpoint.basePath, (group) => group
    .get('/status', async (context) => {
      const authContext = getOptionalAuthContext(context);
      if (!(await canReadAIStatus(readMode, context.request, authContext))) {
        context.set.status = 403;
        emitAICodeSafely(emitCode, OBS_CODES.AI_STATUS_ACCESS_DENIED, {
          metadata: {
            path: new URL(context.request.url).pathname,
            mode: typeof readMode === 'string' ? readMode : 'custom',
          },
        });
        return { error: 'Forbidden' };
      }

      return service.status();
    }));
}

/**
 * Return the process-wide AI service created by createAIPlugin(), if any.
 *
 * Returns null before the plugin is mounted and should be treated as a
 * server-side convenience escape hatch, not browser API.
 */
export function getAI(): AIService | null {
  return aiProviders.get();
}

async function canReadAIStatus(
  mode: AIStatusEndpointReadMode,
  request: Request,
  authContext: { userId: string; email?: string; role?: string } | null
): Promise<boolean> {
  if (typeof mode === 'function') return Boolean(await mode({ request, authContext }));
  if (mode === 'disabled') return false;
  if (mode === 'development') return Bun.env.NODE_ENV !== 'production';
  if (mode === 'admin') return authContext?.role === 'admin';
  return authContext?.role === 'admin' || Bun.env.NODE_ENV !== 'production';
}

function getOptionalAuthContext(context: unknown): { userId: string; email?: string; role?: string } | null {
  const value = (context as { authContext?: unknown }).authContext;
  if (!value || typeof value !== 'object') return null;

  const authContext = value as { userId?: unknown; email?: unknown; role?: unknown };
  if (typeof authContext.userId !== 'string') return null;

  return {
    userId: authContext.userId,
    email: typeof authContext.email === 'string' ? authContext.email : undefined,
    role: typeof authContext.role === 'string' ? authContext.role : undefined,
  };
}
