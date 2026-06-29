/**
 * server-extensions.ts
 *
 * Defines Zero-native backend extension contracts and applies them to Elysia.
 * This file owns extension shape, validation, auth policy attachment, and
 * bundle composition; filesystem discovery remains in server-route-loader.ts.
 */

import type { AnyElysia, MaybePromise } from 'elysia';

import type { AuthContext } from '../../auth/types';
import {
  createLazyServerRouteServices,
  createServerRoute,
  getServerRouteServices,
  type ServerRouteServices,
} from './server-route';

export const ZERO_SERVER_EXTENSION_KIND = Symbol.for('zero.server.extension.kind');

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const EXTENSION_KINDS = new Set(['endpoint', 'router', 'middleware', 'plugin']);

export type ZeroServerExtensionKind = 'endpoint' | 'router' | 'middleware' | 'plugin';
export type ZeroAuthRequirement = false | 'optional' | 'user' | 'admin';
export type ZeroHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type ZeroHttpMethodInput = ZeroHttpMethod | Lowercase<ZeroHttpMethod>;
export type ZeroLifecycleHook = ((context: ZeroLifecycleContext) => MaybePromise<unknown>) | Array<(context: ZeroLifecycleContext) => MaybePromise<unknown>>;
export type ZeroRouteMatcher =
  | string
  | RegExp
  | ((context: ZeroLifecycleContext) => MaybePromise<boolean>);
export type InferValidationSchema<TSchema> = TSchema extends { static: infer TStatic }
  ? TStatic
  : unknown;
export type ZeroLifecycleUser<TAuth extends ZeroAuthRequirement | undefined = undefined> =
  TAuth extends 'user' | 'admin'
    ? AuthContext
    : AuthContext | null;

/** Elysia plugin shapes accepted from app-owned server modules. */
export type ServerRoutePlugin = AnyElysia | ((app: AnyElysia) => MaybePromise<AnyElysia>);

/** Request context passed to Zero-native handlers and middleware. */
export interface ZeroLifecycleContext<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
  TUser extends AuthContext | null = AuthContext | null
> extends Record<string, unknown> {
  auth: TUser;
  authContext: AuthContext | null;
  body: TBody;
  headers: THeaders;
  params: TParams;
  query: TQuery;
  requireAdmin: () => AuthContext;
  requireAuth: () => AuthContext;
  request: Request;
  user: TUser;
  zero: ServerRouteServices;
}

/** Options shared by Zero-native HTTP endpoints. */
export interface ZeroEndpointOptions<
  TBodySchema = unknown,
  TQuerySchema = unknown,
  TParamsSchema = unknown,
  THeadersSchema = unknown,
  TAuth extends ZeroAuthRequirement | undefined = undefined,
  TResponse = unknown
> {
  /** Optional stable name used in traces, errors, and generated plugin names. */
  name?: string;
  /** HTTP method handled by this endpoint. */
  method: ZeroHttpMethodInput;
  /** Absolute route path, relative to an enclosing router prefix when present. */
  path: string;
  /** Auth policy for this route. Defaults to the enclosing router policy or optional auth. */
  auth?: TAuth;
  body?: TBodySchema;
  query?: TQuerySchema;
  params?: TParamsSchema;
  headers?: THeadersSchema;
  cookie?: unknown;
  response?: unknown;
  detail?: unknown;
  parse?: ZeroLifecycleHook;
  transform?: ZeroLifecycleHook;
  beforeHandle?: ZeroLifecycleHook;
  afterHandle?: ZeroLifecycleHook;
  mapResponse?: ZeroLifecycleHook;
  error?: ZeroLifecycleHook;
  /** Handles the request after validation, auth, and route lifecycle hooks run. */
  handler: (context: ZeroLifecycleContext<
    InferValidationSchema<TBodySchema>,
    InferValidationSchema<TQuerySchema>,
    InferValidationSchema<TParamsSchema>,
    InferValidationSchema<THeadersSchema>,
    ZeroLifecycleUser<TAuth>
  >) => MaybePromise<TResponse>;
}

/** A validated Zero-native HTTP endpoint definition. */
export interface ZeroEndpointDefinition<
  TBodySchema = unknown,
  TQuerySchema = unknown,
  TParamsSchema = unknown,
  THeadersSchema = unknown,
  TAuth extends ZeroAuthRequirement | undefined = undefined,
  TResponse = unknown
> extends ZeroEndpointOptions<TBodySchema, TQuerySchema, TParamsSchema, THeadersSchema, TAuth, TResponse> {
  readonly kind: 'endpoint';
  readonly [ZERO_SERVER_EXTENSION_KIND]: 'endpoint';
}

/** Options accepted by defineRouter(). */
export interface ZeroRouterOptions {
  /** Stable router name used by Elysia deduplication and traces. */
  name: string;
  /** Optional URL prefix for every child extension. */
  prefix?: string;
  /** Auth policy inherited by child endpoints and raw route plugins. */
  auth?: ZeroAuthRequirement;
  /** Child endpoints, middleware, nested routers, plugins, or raw Elysia plugins. */
  endpoints?: ZeroRouterChild[];
  /** Alias for endpoints when route-oriented naming reads better. */
  routes?: ZeroRouterChild[];
}

/** A validated Zero-native route group definition. */
export interface ZeroRouterDefinition extends ZeroRouterOptions {
  readonly kind: 'router';
  readonly [ZERO_SERVER_EXTENSION_KIND]: 'router';
}

/** Options accepted by defineMiddleware(). */
export interface ZeroMiddlewareOptions<TAuth extends ZeroAuthRequirement | undefined = undefined> {
  /** Stable middleware name used by traces and diagnostics. */
  name: string;
  /** Optional matcher. Omit to apply to every app-owned extension route. */
  path?: ZeroRouteMatcher | ZeroRouteMatcher[];
  /** Auth policy required before middleware runs. */
  auth?: TAuth;
  /** Runs before matching app-owned extension route handlers. */
  run: (context: ZeroLifecycleContext<unknown, unknown, unknown, unknown, ZeroLifecycleUser<TAuth>>) => MaybePromise<unknown>;
}

/** A validated Zero-native middleware definition. */
export interface ZeroMiddlewareDefinition<TAuth extends ZeroAuthRequirement | undefined = undefined> extends ZeroMiddlewareOptions<TAuth> {
  readonly kind: 'middleware';
  readonly [ZERO_SERVER_EXTENSION_KIND]: 'middleware';
}

/** Context passed to defineZeroPlugin setup callbacks. */
export interface ZeroPluginSetupContext {
  app: ReturnType<typeof createServerRoute>;
  zero: ServerRouteServices;
}

/** Options accepted by defineZeroPlugin(). */
export interface ZeroPluginOptions {
  /** Stable plugin name used by Elysia deduplication and traces. */
  name: string;
  /** Configures and returns an optional child Elysia plugin. */
  setup: (context: ZeroPluginSetupContext) => MaybePromise<AnyElysia | void>;
}

/** A validated Zero-native plugin definition. */
export interface ZeroPluginDefinition extends ZeroPluginOptions {
  readonly kind: 'plugin';
  readonly [ZERO_SERVER_EXTENSION_KIND]: 'plugin';
}

export type AnyZeroEndpointDefinition = ZeroEndpointDefinition<any, any, any, any, any, any>;
export type AnyZeroMiddlewareDefinition = ZeroMiddlewareDefinition<any>;

export type ZeroServerExtension =
  | AnyZeroEndpointDefinition
  | ZeroRouterDefinition
  | AnyZeroMiddlewareDefinition
  | ZeroPluginDefinition;

export type ZeroRouterChild = ZeroServerExtension | ServerRoutePlugin;
export type ZeroServerExtensionMountable = ZeroServerExtension | ServerRoutePlugin;

/** Create a validated Zero-native endpoint definition. */
export function defineEndpoint<
  const TBodySchema = unknown,
  const TQuerySchema = unknown,
  const TParamsSchema = unknown,
  const THeadersSchema = unknown,
  const TAuth extends ZeroAuthRequirement | undefined = undefined,
  TResponse = unknown
>(
  options: ZeroEndpointOptions<TBodySchema, TQuerySchema, TParamsSchema, THeadersSchema, TAuth, TResponse>
): ZeroEndpointDefinition<TBodySchema, TQuerySchema, TParamsSchema, THeadersSchema, TAuth, TResponse> {
  assertAbsolutePath(options.path, 'endpoint path');

  return markExtension('endpoint', {
    ...options,
    method: normalizeHttpMethod(options.method),
  });
}

/** Create a validated Zero-native router definition. */
export function defineRouter(options: ZeroRouterOptions): ZeroRouterDefinition {
  assertExtensionName(options.name, 'router');
  if (options.prefix !== undefined) assertRouterPrefix(options.prefix);

  return markExtension('router', {
    ...options,
  });
}

/** Create a validated Zero-native middleware definition. */
export function defineMiddleware<const TAuth extends ZeroAuthRequirement | undefined = undefined>(
  options: ZeroMiddlewareOptions<TAuth>
): ZeroMiddlewareDefinition<TAuth> {
  assertExtensionName(options.name, 'middleware');

  return markExtension('middleware', options);
}

/** Create a validated Zero-native plugin definition. */
export function defineZeroPlugin(options: ZeroPluginOptions): ZeroPluginDefinition {
  assertExtensionName(options.name, 'plugin');

  return markExtension('plugin', options);
}

/** Return true when a value is a Zero-native server extension definition. */
export function isZeroServerExtension(value: unknown): value is ZeroServerExtension {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as Record<PropertyKey, unknown>)[ZERO_SERVER_EXTENSION_KIND];
  return typeof kind === 'string' && EXTENSION_KINDS.has(kind);
}

/** Return true when a value is a raw Elysia plugin or Elysia plugin callback. */
export function isServerRoutePlugin(value: unknown): value is ServerRoutePlugin {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;

  const candidate = value as {
    handle?: unknown;
    use?: unknown;
  };

  return typeof candidate.handle === 'function' && typeof candidate.use === 'function';
}

/** Compose a scoped app-owned extension plugin from Zero-native and raw Elysia inputs. */
export function createServerExtensionBundle(options: {
  extensions: ZeroServerExtensionMountable[];
  name?: string;
}): ServerRoutePlugin {
  const extensions = [...options.extensions];
  const name = options.name ?? 'zero.app.server-extensions';

  return async function mountZeroServerExtensions(parent: AnyElysia): Promise<AnyElysia> {
    const app = await createServerExtensionApp({ extensions, name });
    return (parent as AnyElysia & { use(plugin: ServerRoutePlugin): AnyElysia }).use(app);
  };
}

/** Build a scoped app-owned extension app with all async setup resolved. */
export async function createServerExtensionApp(options: {
  extensions: ZeroServerExtensionMountable[];
  name?: string;
}): Promise<AnyElysia> {
  let app = createServerRoute({ name: options.name ?? 'zero.app.server-extensions' }) as AnyElysia;

  for (const extension of options.extensions) {
    app = await applyServerExtension(app, extension);
  }

  return app;
}

/** Apply one Zero-native or raw Elysia extension to an app-owned extension app. */
export async function applyServerExtension(
  app: AnyElysia,
  extension: ZeroServerExtensionMountable,
  inheritedAuth: ZeroAuthRequirement = 'optional'
): Promise<AnyElysia> {
  if (isServerRoutePlugin(extension) && !isZeroServerExtension(extension)) {
    return usePlugin(app, extension);
  }

  if (!isZeroServerExtension(extension)) {
    throw new TypeError('[server-extensions] Expected a Zero server extension or Elysia plugin.');
  }

  switch (extension.kind) {
    case 'endpoint':
      return applyEndpoint(app, extension, inheritedAuth);
    case 'router':
      return applyRouter(app, extension, inheritedAuth);
    case 'middleware':
      return applyMiddleware(app, extension, inheritedAuth);
    case 'plugin':
      return applyPlugin(app, extension);
  }
}

function applyEndpoint(
  app: AnyElysia,
  endpoint: ZeroEndpointDefinition,
  inheritedAuth: ZeroAuthRequirement
): AnyElysia {
  const auth = resolveAuthRequirement(endpoint.auth, inheritedAuth);
  const routeOptions = buildRouteOptions(endpoint, auth);

  return (app as AnyElysia & {
    route(method: string, path: string, handler: (context: unknown) => MaybePromise<unknown>, hook?: unknown): AnyElysia;
  }).route(
    endpoint.method,
    endpoint.path,
    async function zeroEndpointHandler(context: unknown) {
      const handlerContext = createLifecycleContext(context, auth);
      return endpoint.handler(handlerContext);
    },
    routeOptions
  );
}

async function applyRouter(
  app: AnyElysia,
  router: ZeroRouterDefinition,
  inheritedAuth: ZeroAuthRequirement
): Promise<AnyElysia> {
  const auth = resolveAuthRequirement(router.auth, inheritedAuth);
  let routerApp = createServerRoute({
    name: `zero.router.${router.name}`,
    prefix: router.prefix,
  }) as AnyElysia;

  routerApp = applyAuthGuard(routerApp, auth);

  const children = [...(router.endpoints ?? []), ...(router.routes ?? [])];
  for (const child of children) {
    routerApp = await applyServerExtension(routerApp, child, auth);
  }

  return usePlugin(app, routerApp);
}

function applyMiddleware(
  app: AnyElysia,
  middleware: ZeroMiddlewareDefinition,
  inheritedAuth: ZeroAuthRequirement
): AnyElysia {
  const auth = resolveAuthRequirement(middleware.auth, inheritedAuth);

  return (app as AnyElysia & {
    onBeforeHandle(handler: (context: unknown) => MaybePromise<unknown>): AnyElysia;
  }).onBeforeHandle(async function zeroMiddlewareHandler(context: unknown) {
    const matchContext = createLifecycleContext(context, 'optional');
    if (!(await matchesMiddleware(middleware.path, matchContext))) return undefined;

    const handlerContext = auth === 'optional'
      ? matchContext
      : createLifecycleContext(context, auth);

    return middleware.run(handlerContext);
  });
}

async function applyPlugin(app: AnyElysia, plugin: ZeroPluginDefinition): Promise<AnyElysia> {
  const child = createServerRoute({ name: `zero.plugin.${plugin.name}` });
  const result = await plugin.setup({
    app: child,
    zero: createLazyServerRouteServices(),
  });

  return usePlugin(app, result ?? child);
}

function applyAuthGuard(app: AnyElysia, auth: ZeroAuthRequirement): AnyElysia {
  const guard = createAuthGuard(auth);
  if (!guard) return app;

  return (app as AnyElysia & {
    onBeforeHandle(handler: (context: unknown) => MaybePromise<unknown>): AnyElysia;
  }).onBeforeHandle(guard);
}

function buildRouteOptions(endpoint: ZeroEndpointDefinition, auth: ZeroAuthRequirement): Record<string, unknown> {
  return compactObject({
    body: endpoint.body,
    query: endpoint.query,
    params: endpoint.params,
    headers: endpoint.headers,
    cookie: endpoint.cookie,
    response: endpoint.response,
    detail: endpoint.detail,
    parse: endpoint.parse,
    transform: endpoint.transform,
    beforeHandle: prependHook(createAuthGuard(auth), endpoint.beforeHandle),
    afterHandle: endpoint.afterHandle,
    mapResponse: endpoint.mapResponse,
    error: endpoint.error,
  });
}

function createAuthGuard(auth: ZeroAuthRequirement): ((context: unknown) => void) | undefined {
  if (auth === 'user') {
    return function requireZeroUserAuth(context: unknown): void {
      asContext(context).requireAuth();
    };
  }

  if (auth === 'admin') {
    return function requireZeroAdminAuth(context: unknown): void {
      asContext(context).requireAdmin();
    };
  }

  return undefined;
}

function createLifecycleContext(context: unknown, auth: ZeroAuthRequirement): ZeroLifecycleContext {
  const current = asContext(context);
  const user = resolveRequestUser(current, auth);
  const zero = current.zero ?? getServerRouteServices();

  return {
    ...current,
    auth: user,
    user,
    zero,
  } as ZeroLifecycleContext;
}

function resolveRequestUser(context: ZeroLifecycleContext, auth: ZeroAuthRequirement): AuthContext | null {
  if (auth === 'admin') return context.requireAdmin();
  if (auth === 'user') return context.requireAuth();
  return context.authContext ?? null;
}

async function matchesMiddleware(
  matcher: ZeroMiddlewareOptions['path'],
  context: ZeroLifecycleContext
): Promise<boolean> {
  if (!matcher) return true;
  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  const pathname = new URL(context.request.url).pathname;

  for (const current of matchers) {
    if (typeof current === 'string' && matchesPathString(current, pathname)) return true;
    if (current instanceof RegExp && current.test(pathname)) return true;
    if (typeof current === 'function' && await current(context)) return true;
  }

  return false;
}

function matchesPathString(pattern: string, pathname: string): boolean {
  if (pattern === '*' || pattern === '/*') return true;
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

function prependHook(
  hook: ((context: unknown) => MaybePromise<unknown>) | undefined,
  existing: ZeroLifecycleHook | undefined
): ZeroLifecycleHook | undefined {
  if (!hook) return existing;
  if (!existing) return hook as (context: ZeroLifecycleContext) => MaybePromise<unknown>;
  return [hook as (context: ZeroLifecycleContext) => MaybePromise<unknown>, ...normalizeHooks(existing)];
}

function normalizeHooks(hooks: ZeroLifecycleHook): Array<(context: ZeroLifecycleContext) => MaybePromise<unknown>> {
  return Array.isArray(hooks) ? hooks : [hooks];
}

function usePlugin(app: AnyElysia, plugin: ServerRoutePlugin): AnyElysia {
  return (app as AnyElysia & { use(plugin: ServerRoutePlugin): AnyElysia }).use(plugin);
}

function asContext(context: unknown): ZeroLifecycleContext {
  return context as ZeroLifecycleContext;
}

function normalizeHttpMethod(method: ZeroHttpMethodInput): ZeroHttpMethod {
  const normalized = method.toUpperCase();
  if (!HTTP_METHODS.has(normalized)) {
    throw new Error(`[server-extensions] Unsupported HTTP method: ${method}`);
  }

  return normalized as ZeroHttpMethod;
}

function resolveAuthRequirement(
  auth: ZeroAuthRequirement | undefined,
  inheritedAuth: ZeroAuthRequirement
): ZeroAuthRequirement {
  return auth === undefined ? inheritedAuth : auth;
}

function assertExtensionName(name: string, type: string): void {
  if (!name || !name.trim()) {
    throw new Error(`[server-extensions] ${type} extensions require a non-empty name.`);
  }
}

function assertAbsolutePath(path: string, label: string): void {
  if (!path || !path.startsWith('/')) {
    throw new Error(`[server-extensions] ${label} must start with "/".`);
  }
}

function assertRouterPrefix(prefix: string): void {
  if (prefix !== '' && !prefix.startsWith('/')) {
    throw new Error('[server-extensions] router prefix must be empty or start with "/".');
  }
}

function markExtension<TKind extends ZeroServerExtensionKind, TOptions extends object>(
  kind: TKind,
  options: TOptions
): TOptions & { readonly kind: TKind; readonly [ZERO_SERVER_EXTENSION_KIND]: TKind } {
  return {
    ...options,
    kind,
    [ZERO_SERVER_EXTENSION_KIND]: kind,
  };
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}
