/**
 * plugin.ts
 *
 * Elysia integration for Zero observability. This plugin owns the default HTTP
 * access point, frontend event ingest, global error reporting, and optional
 * lifecycle trace emission; core services emit through the framework-neutral
 * sink helpers instead.
 */

import { Elysia, ValidationError, t } from 'elysia';
import { OBS_CODES } from './codes';
import {
  emitPlatformCodeTo,
  emitPlatformEventTo,
  getObservabilityRuntime,
} from './sink';
import type {
  ObservabilityConfig,
  ObservabilityEndpointReadMode,
  ObservabilityTraceConfig,
  PlatformEventLevel,
  PlatformObservabilityRuntime,
  PlatformEventSource,
} from './types';
import { getSafeRequestPath } from './safe-request-path';

const DEFAULT_BASE_PATH = '/api/_zero/observability';
const DEFAULT_FRONTEND_MAX_PAYLOAD_BYTES = 32_768;

export interface ObservabilityPluginConfig {
  /** Runtime observability config resolved by createApp(). */
  config?: ObservabilityConfig | false;
  /** App-owned runtime. Falls back to the captured ambient runtime for standalone use. */
  runtime?: PlatformObservabilityRuntime;
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
  // Capture once. Looking up the process-global runtime inside a request would
  // let a later createApp() redirect this app's events and readable endpoint.
  const runtime = options.runtime ?? getObservabilityRuntime();
  const config = options.config === false ? { enabled: false } : options.config ?? {};
  const endpoint = config.endpoint === false ? { enabled: false } : config.endpoint ?? {};
  const endpointEnabled = config.enabled !== false && endpoint.enabled !== false;
  const basePath = endpoint.basePath ?? DEFAULT_BASE_PATH;
  const readMode = endpoint.read ?? (options.authEnabled ? 'admin' : 'development');
  const frontendIngest = endpoint.frontendIngest !== false;
  const maxPayloadBytes = endpoint.maxPayloadBytes ?? DEFAULT_FRONTEND_MAX_PAYLOAD_BYTES;
  const traceConfig = config.trace === false ? undefined : config.trace;

  const app = new Elysia({ name: 'observability' })
    .onError({ as: 'global' }, function reportPlatformError({ code, error, request, set }) {
      if (code === 'VALIDATION' || code === 'PARSE') {
        const responseFailure = code === 'VALIDATION'
          && error instanceof ValidationError
          && error.type === 'response';
        emitPlatformCodeTo(
          runtime,
          responseFailure
            ? OBS_CODES.APP_RESPONSE_VALIDATION_FAILED
            : code === 'VALIDATION'
              ? OBS_CODES.APP_REQUEST_VALIDATION_REJECTED
            : OBS_CODES.APP_REQUEST_PARSE_REJECTED,
          {
            metadata: {
              method: request.method,
              path: getSafeRequestPath(request),
              status: responseFailure ? 500 : code === 'VALIDATION' ? 422 : 400,
            },
          },
        );
        return;
      }
      emitPlatformCodeTo(runtime, OBS_CODES.APP_REQUEST_FAILED, {
        error,
        metadata: {
          method: request.method,
          path: getSafeRequestPath(request),
          status: set.status,
        },
      });
    });

  const tracedApp = traceConfig?.enabled
    ? attachTrace(app, traceConfig, runtime)
    : app;

  if (!endpointEnabled) return tracedApp;

  return tracedApp.group(basePath, (group) => group
    .get(
      '/events',
      async (context) => {
        const { query, set, request } = context;
        const authContext = getOptionalAuthContext(context);

        if (!(await canReadEvents(readMode, request, authContext ?? null))) {
          set.status = 403;
          emitPlatformCodeTo(runtime, OBS_CODES.OBSERVABILITY_ACCESS_DENIED, {
            level: 'warn',
            metadata: {
              path: getSafeRequestPath(request),
              mode: typeof readMode === 'string' ? readMode : 'custom',
            },
          });
          return { error: 'Forbidden' };
        }

        const store = runtime.store;
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
          emitPlatformCodeTo(runtime, OBS_CODES.OBSERVABILITY_FRONTEND_REJECTED, {
            level: 'warn',
            metadata: { reason: 'payload_too_large', contentLength, maxPayloadBytes },
          });
          return { error: 'Payload too large' };
        }

        emitPlatformEventTo(runtime, {
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

        emitPlatformCodeTo(runtime, OBS_CODES.OBSERVABILITY_FRONTEND_INGESTED, {
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
  traceConfig: ObservabilityTraceConfig,
  runtime: PlatformObservabilityRuntime,
): T {
  const slowRequestMs = traceConfig.slowRequestMs ?? 500;
  const slowLifecycleMs = traceConfig.slowLifecycleMs ?? 100;

  return app.trace(function zeroObservabilityTrace({ context, onHandle, onBeforeHandle, onAfterHandle, onError }) {
    const request = context.request;
    const path = getSafeRequestPath(request);
    const method = request.method;
    const requestStart = Date.now();

    onHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent(runtime, 'handle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onBeforeHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent(runtime, 'beforeHandle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onAfterHandle(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent(runtime, 'afterHandle', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onError(({ name, onStop }) => {
      onStop(({ elapsed, error }) => {
        emitLifecycleEvent(runtime, 'error', name, elapsed, error, method, path, slowLifecycleMs);
      });
    });

    onAfterHandle(({ onStop }) => {
      onStop(() => {
        const elapsed = Date.now() - requestStart;
        if (elapsed >= slowRequestMs) {
          emitPlatformCodeTo(runtime, OBS_CODES.APP_REQUEST_SLOW, {
            level: 'warn',
            metadata: { method, path, elapsed, slowRequestMs },
          });
        }
      });
    });
  }) as T;
}

function emitLifecycleEvent(
  runtime: PlatformObservabilityRuntime,
  lifecycle: string,
  name: string,
  elapsed: number,
  error: Error | null,
  method: string,
  path: string,
  slowLifecycleMs: number
): void {
  if (error) {
    emitPlatformCodeTo(runtime, OBS_CODES.APP_LIFECYCLE_FAILED, {
      error,
      metadata: { lifecycle, name, elapsed, method, path },
    });
    return;
  }

  if (elapsed >= slowLifecycleMs) {
    emitPlatformCodeTo(runtime, OBS_CODES.APP_LIFECYCLE_SLOW, {
      level: 'warn',
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
