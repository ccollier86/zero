/**
 * plugin.ts
 *
 * Elysia integration for Zero observability. This plugin owns the default HTTP
 * access point, frontend event ingest, global error reporting, and optional
 * lifecycle trace emission; core services emit through the framework-neutral
 * sink helpers instead.
 */

import { Elysia, t } from 'elysia';
import { OBS_CODES } from './codes';
import {
  emitPlatformCode,
  emitPlatformEvent,
  getPlatformEventStore,
  warnPlatform,
} from './sink';
import type {
  ObservabilityConfig,
  ObservabilityEndpointReadMode,
  ObservabilityTraceConfig,
  PlatformEventLevel,
  PlatformEventSource,
} from './types';

const DEFAULT_BASE_PATH = '/api/_zero/observability';
const DEFAULT_FRONTEND_MAX_PAYLOAD_BYTES = 32_768;

export interface ObservabilityPluginConfig {
  /** Runtime observability config resolved by createApp(). */
  config?: ObservabilityConfig | false;
  /** Whether the app has auth middleware available. */
  authEnabled?: boolean;
}

/**
 * Create the Elysia observability plugin.
 *
 * The plugin exposes recent event reads from the configured event store and a
 * write-only frontend ingest route. Read access defaults to admin-only when
 * auth is enabled and development-only when auth is disabled.
 */
export function createObservabilityPlugin(options: ObservabilityPluginConfig = {}) {
  const config = options.config === false ? { enabled: false } : options.config ?? {};
  const endpoint = config.endpoint === false ? { enabled: false } : config.endpoint ?? {};
  const endpointEnabled = config.enabled !== false && endpoint.enabled !== false;
  const basePath = endpoint.basePath ?? DEFAULT_BASE_PATH;
  const readMode = endpoint.read ?? (options.authEnabled ? 'admin' : 'development');
  const frontendIngest = endpoint.frontendIngest !== false;
  const maxPayloadBytes = endpoint.maxPayloadBytes ?? DEFAULT_FRONTEND_MAX_PAYLOAD_BYTES;
  const traceConfig = config.trace === false ? undefined : config.trace;

  const app = new Elysia({ name: 'observability' })
    .onError({ as: 'global' }, function reportPlatformError({ error, request, set }) {
      emitPlatformCode(OBS_CODES.APP_REQUEST_FAILED, {
        error,
        metadata: {
          method: request.method,
          path: new URL(request.url).pathname,
          status: set.status,
        },
      });
    });

  const tracedApp = traceConfig?.enabled ? attachTrace(app, traceConfig) : app;

  if (!endpointEnabled) return tracedApp;

  return tracedApp.group(basePath, (group) => group
    .get(
      '/events',
      async (context) => {
        const { query, set, request } = context;
        const authContext = getOptionalAuthContext(context);

        if (!(await canReadEvents(readMode, request, authContext ?? null))) {
          set.status = 403;
          warnPlatform(OBS_CODES.OBSERVABILITY_ACCESS_DENIED, {
            metadata: {
              path: new URL(request.url).pathname,
              mode: typeof readMode === 'string' ? readMode : 'custom',
            },
          });
          return { error: 'Forbidden' };
        }

        const store = getPlatformEventStore();
        if (!store) {
          set.status = 503;
          return { error: 'Observability event store is not configured' };
        }

        return store.query({
          level: parseLevelFilter(query.level),
          category: query.category,
          code: query.code,
          source: parseSource(query.source),
          since: query.since,
          cursor: query.cursor,
          limit: query.limit,
        });
      },
      {
        query: t.Object({
          level: t.Optional(t.Union([
            t.Literal('debug'),
            t.Literal('info'),
            t.Literal('warn'),
            t.Literal('error'),
            t.Literal('fatal'),
            t.String(),
          ])),
          category: t.Optional(t.String()),
          code: t.Optional(t.String()),
          source: t.Optional(t.String()),
          since: t.Optional(t.Numeric()),
          cursor: t.Optional(t.Numeric()),
          limit: t.Optional(t.Numeric()),
        }),
      }
    )
    .post(
      '/events',
      ({ body, set, request }) => {
        if (!frontendIngest) {
          set.status = 404;
          return { error: 'Not found' };
        }

        const contentLength = Number(request.headers.get('content-length') ?? 0);
        if (contentLength > maxPayloadBytes) {
          set.status = 413;
          warnPlatform(OBS_CODES.OBSERVABILITY_FRONTEND_REJECTED, {
            metadata: { reason: 'payload_too_large', contentLength, maxPayloadBytes },
          });
          return { error: 'Payload too large' };
        }

        emitPlatformEvent({
          source: 'frontend',
          level: body.level ?? 'error',
          category: body.category ?? 'frontend',
          code: body.code ?? OBS_CODES.FRONTEND_RENDER_ERROR.code,
          prefix: body.prefix,
          message: body.message,
          metadata: body.metadata,
          error: body.error,
          requestId: body.requestId,
          traceId: body.traceId,
        });

        emitPlatformCode(OBS_CODES.OBSERVABILITY_FRONTEND_INGESTED, {
          metadata: { code: body.code ?? OBS_CODES.FRONTEND_RENDER_ERROR.code },
        });

        return { ok: true };
      },
      {
        body: t.Object({
          level: t.Optional(t.Union([
            t.Literal('debug'),
            t.Literal('info'),
            t.Literal('warn'),
            t.Literal('error'),
            t.Literal('fatal'),
          ])),
          category: t.Optional(t.String()),
          code: t.Optional(t.String()),
          prefix: t.Optional(t.String()),
          message: t.String({ minLength: 1, maxLength: 2000 }),
          metadata: t.Optional(t.Record(t.String(), t.Unknown())),
          error: t.Optional(t.Unknown()),
          requestId: t.Optional(t.String()),
          traceId: t.Optional(t.String()),
        }),
      }
    ));
}

function attachTrace<T extends Elysia<any, any, any, any, any, any, any>>(
  app: T,
  traceConfig: ObservabilityTraceConfig
): T {
  const slowRequestMs = traceConfig.slowRequestMs ?? 500;
  const slowLifecycleMs = traceConfig.slowLifecycleMs ?? 100;

  return app.trace(function zeroObservabilityTrace({ context, onHandle, onBeforeHandle, onAfterHandle, onError }) {
    const request = context.request;
    const path = new URL(request.url).pathname;
    const method = request.method;
    const requestStart = Date.now();

    onHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent('handle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onBeforeHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent('beforeHandle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onAfterHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent('afterHandle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onError(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent('error', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onAfterHandle(({ onStop }) => {
      onStop(() => {
        const elapsed = Date.now() - requestStart;
        if (elapsed >= slowRequestMs) {
          warnPlatform(OBS_CODES.APP_REQUEST_SLOW, {
            metadata: { method, path, elapsed, slowRequestMs },
          });
        }
      });
    });
  }) as T;
}

function emitLifecycleEvent(
  lifecycle: string,
  name: string,
  elapsed: number,
  error: Error | null,
  method: string,
  path: string,
  slowLifecycleMs: number
): void {
  if (error) {
    emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
      error,
      metadata: { lifecycle, name, elapsed, method, path },
    });
    return;
  }

  if (elapsed >= slowLifecycleMs) {
    warnPlatform(OBS_CODES.APP_LIFECYCLE_SLOW, {
      metadata: { lifecycle, name, elapsed, method, path, slowLifecycleMs },
    });
  }
}

async function canReadEvents(
  mode: ObservabilityEndpointReadMode,
  request: Request,
  authContext: { userId: string; email?: string; role?: string } | null
): Promise<boolean> {
  if (typeof mode === 'function') {
    return Boolean(await mode({ request, authContext }));
  }

  if (mode === 'disabled') return false;
  if (mode === 'development') return process.env.NODE_ENV !== 'production';
  if (mode === 'admin') return authContext?.role === 'admin';
  return authContext?.role === 'admin' || process.env.NODE_ENV !== 'production';
}

function parseLevelFilter(level: string | undefined): PlatformEventLevel | PlatformEventLevel[] | undefined {
  if (!level) return undefined;
  const levels = level.split(',').map((value) => value.trim()).filter(Boolean) as PlatformEventLevel[];
  return levels.length > 1 ? levels : levels[0];
}

function parseSource(source: string | undefined): PlatformEventSource | undefined {
  if (
    source === 'backend' ||
    source === 'frontend' ||
    source === 'cli' ||
    source === 'test'
  ) {
    return source;
  }
  return undefined;
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
