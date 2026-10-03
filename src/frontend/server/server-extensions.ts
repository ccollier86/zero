/**
 * server-extensions.ts
 *
 * Defines Zero-native backend extension contracts and applies them to Elysia.
 * This file owns extension shape, validation, auth policy attachment, and
 * bundle composition; filesystem discovery remains in server-route-loader.ts.
 */

import type { AnyElysia, MaybePromise } from 'elysia';

import {
  createProtectedMultipartRequestGuard,
  type AuthMiddlewareAuthorizationOptions,
} from '../../auth/auth.middleware';
import {
  getAuthRequestCredentialResolver,
  getAuthorizationKernel,
  getAuthStore,
  getTokenService,
} from '../../auth/auth.plugin';
import type { RequestAuthorizationAccess } from '../../auth/authorization-access';
import {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
  type AccessRequirement,
  type AuthorizationKernel,
  type CompiledAccessRequirement,
  type StructuredAccessRequirement,
} from '../../auth/authorization-kernel';
import type { AuthContext } from '../../auth/types';
import {
  createServerRoute,
} from './server-route';
import {
  createLazyServerRouteServices,
  getServerRouteServices,
  type ServerRouteServices,
} from './server-services';
import type { ServerRequestServices } from './server-request-services';
import { applyServerExtensionErrorHandler } from './server-extension-error-handler';
import {
  evaluateMiddlewareApplicability,
  normalizeHttpMethod,
  normalizeMiddlewareMatcher,
  type ZeroHttpMethod,
  type ZeroHttpMethodInput,
  type ZeroMiddlewareMatcher,
  type ZeroPathMatcher,
} from './server-matcher';
import {
  enforceServerPolicy,
  type ZeroPolicyEvaluationOptions,
} from './server-policy';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
} from '../../runtime/service-keys';

export const ZERO_SERVER_EXTENSION_KIND = Symbol.for('zero.server.extension.kind');

const EXTENSION_KINDS = new Set(['endpoint', 'router', 'middleware', 'plugin']);

export type ZeroServerExtensionKind = 'endpoint' | 'router' | 'middleware' | 'plugin';
export type ZeroExtensionAuthRequirement = AccessRequirement;
export type ZeroLifecycleHook = ((context: ZeroLifecycleContext) => MaybePromise<unknown>) | Array<(context: ZeroLifecycleContext) => MaybePromise<unknown>>;
export type ZeroRouteMatcher = ZeroPathMatcher;
export type InferValidationSchema<TSchema> = TSchema extends { static: infer TStatic }
  ? TStatic
  : unknown;
export type ZeroLifecycleUser<TAuth extends AccessRequirement | undefined = undefined> =
  TAuth extends 'user' | 'admin'
    ? AuthContext
    : TAuth extends true | 'required'
      ? AuthContext
      : TAuth extends StructuredAccessRequirement
        ? TAuth extends { user: 'required' }
          ? AuthContext
          : TAuth extends
              | { platformRole: unknown }
              | { tenant: 'required' }
              | { scopeRole: unknown }
              | { permission: unknown }
              | { allPermissions: unknown }
              | { anyPermissions: unknown }
              | { properties: unknown }
            ? AuthContext
            : AuthContext | null
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
  /** Request-local application/tenant authorization facade. */
  access: RequestAuthorizationAccess;
  body: TBody;
  headers: THeaders;
  params: TParams;
  query: TQuery;
  requireAdmin: () => AuthContext;
  requireAuth: () => AuthContext;
  request: Request;
  user: TUser;
  zero: ServerRequestServices;
}

/** Options shared by Zero-native HTTP endpoints. */
export interface ZeroEndpointOptions<
  TBodySchema = unknown,
  TQuerySchema = unknown,
  TParamsSchema = unknown,
  THeadersSchema = unknown,
  TAuth extends AccessRequirement | undefined = undefined,
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
  TAuth extends AccessRequirement | undefined = undefined,
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
  auth?: AccessRequirement;
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
export type ZeroMiddlewareUser<
  TAuth extends AccessRequirement | undefined = undefined,
  TMatcher extends ZeroMiddlewareMatcher | undefined = undefined
> =
  ZeroLifecycleUser<TAuth> extends AuthContext
    ? AuthContext
    : TMatcher extends { auth: 'user' | 'admin' }
      ? AuthContext
      : TMatcher extends { role: string | string[] }
        ? AuthContext
        : TMatcher extends { properties: Record<string, unknown> }
          ? AuthContext
          : AuthContext | null;

export interface ZeroMiddlewareOptions<
  TAuth extends AccessRequirement | undefined = undefined,
  TMatcher extends ZeroMiddlewareMatcher | undefined = undefined
> {
  /** Stable middleware name used by traces and diagnostics. */
  name: string;
  /** Optional matcher. Omit to apply to every app-owned extension route. */
  path?: ZeroRouteMatcher | ZeroRouteMatcher[];
  /** Auth policy required before middleware runs. */
  auth?: TAuth;
  /** Structured matcher for path, method, predicate, auth, role, and user properties. */
  matcher?: TMatcher;
  /** Runs before matching app-owned extension route handlers. */
  run: (context: ZeroLifecycleContext<unknown, unknown, unknown, unknown, ZeroMiddlewareUser<TAuth, TMatcher>>) => MaybePromise<unknown>;
}

/** A validated Zero-native middleware definition. */
export interface ZeroMiddlewareDefinition<
  TAuth extends AccessRequirement | undefined = undefined,
  TMatcher extends ZeroMiddlewareMatcher | undefined = undefined
> extends ZeroMiddlewareOptions<TAuth, TMatcher> {
  readonly kind: 'middleware';
  readonly normalizedMatcher: ZeroMiddlewareMatcher;
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
export type AnyZeroMiddlewareDefinition = ZeroMiddlewareDefinition<any, any>;

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
  const TAuth extends AccessRequirement | undefined = undefined,
  TResponse = unknown
>(
  options: ZeroEndpointOptions<TBodySchema, TQuerySchema, TParamsSchema, THeadersSchema, TAuth, TResponse>
): ZeroEndpointDefinition<TBodySchema, TQuerySchema, TParamsSchema, THeadersSchema, TAuth, TResponse> {
  assertAbsolutePath(options.path, 'endpoint path');
  if (options.auth !== undefined) compileAccessRequirement(options.auth);

  return markExtension('endpoint', {
    ...options,
    method: normalizeHttpMethod(options.method),
  });
}

/** Create a validated Zero-native router definition. */
export function defineRouter(options: ZeroRouterOptions): ZeroRouterDefinition {
  assertExtensionName(options.name, 'router');
  if (options.prefix !== undefined) assertRouterPrefix(options.prefix);
  if (options.auth !== undefined) compileAccessRequirement(options.auth);

  return markExtension('router', {
    ...options,
  });
}

/** Create a validated Zero-native middleware definition. */
export function defineMiddleware<
  const TAuth extends AccessRequirement | undefined = undefined,
  const TMatcher extends ZeroMiddlewareMatcher | undefined = undefined
>(
  options: ZeroMiddlewareOptions<TAuth, TMatcher>
): ZeroMiddlewareDefinition<TAuth, TMatcher> {
  assertExtensionName(options.name, 'middleware');
  if (options.auth !== undefined) compileAccessRequirement(options.auth);

  return markExtension('middleware', {
    ...options,
    normalizedMatcher: normalizeMiddlewareMatcher({
      matcher: options.matcher,
      path: options.path,
    }),
  });
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
  runtime?: ZeroAppRuntime;
}): ServerRoutePlugin {
  const extensions = [...options.extensions];
  const name = options.name ?? 'zero.app.server-extensions';

  return async function mountZeroServerExtensions(parent: AnyElysia): Promise<AnyElysia> {
    const app = await createServerExtensionApp({
      extensions,
      name,
      runtime: options.runtime,
    });
    return (parent as AnyElysia & { use(plugin: ServerRoutePlugin): AnyElysia }).use(app);
  };
}

/** Build a scoped app-owned extension app with all async setup resolved. */
export async function createServerExtensionApp(options: {
  extensions: ZeroServerExtensionMountable[];
  name?: string;
  runtime?: ZeroAppRuntime;
}): Promise<AnyElysia> {
  const kernel = resolveAuthorizationKernel(options.runtime);
  const rootAccess = createRootAccessPlan('optional', kernel);
  let app = createServerRoute(
    { name: options.name ?? 'zero.app.server-extensions' },
    options.runtime,
  ) as AnyElysia;
  app = applyServerExtensionErrorHandler(app);

  for (const extension of options.extensions) {
    app = await applyServerExtensionWithPlan(
      app,
      extension,
      rootAccess,
      kernel,
      options.runtime,
      '',
    );
  }

  return app;
}

/** Apply one Zero-native or raw Elysia extension to an app-owned extension app. */
export async function applyServerExtension(
  app: AnyElysia,
  extension: ZeroServerExtensionMountable,
  inheritedAuth: AccessRequirement | CompiledAccessRequirement = 'optional',
  runtime?: ZeroAppRuntime,
  routePrefix = '',
): Promise<AnyElysia> {
  const kernel = resolveAuthorizationKernel(runtime);
  return applyServerExtensionWithPlan(
    app,
    extension,
    createRootAccessPlan(inheritedAuth, kernel),
    kernel,
    runtime,
    routePrefix,
  );
}

interface ResolvedAccessPlan {
  readonly requirement: CompiledAccessRequirement;
  readonly forceAnonymous: boolean;
}

async function applyServerExtensionWithPlan(
  app: AnyElysia,
  extension: ZeroServerExtensionMountable,
  inheritedAccess: ResolvedAccessPlan,
  kernel: AuthorizationKernel | null,
  runtime?: ZeroAppRuntime,
  routePrefix = '',
): Promise<AnyElysia> {
  if (isServerRoutePlugin(extension) && !isZeroServerExtension(extension)) {
    return usePlugin(app, extension);
  }

  if (!isZeroServerExtension(extension)) {
    throw new TypeError('[server-extensions] Expected a Zero server extension or Elysia plugin.');
  }

  switch (extension.kind) {
    case 'endpoint':
      return applyEndpoint(app, extension, inheritedAccess, kernel, runtime, routePrefix);
    case 'router':
      return applyRouter(app, extension, inheritedAccess, kernel, runtime, routePrefix);
    case 'middleware':
      return applyMiddleware(app, extension, inheritedAccess, kernel, runtime);
    case 'plugin':
      return applyPlugin(app, extension, runtime);
  }
}

function applyEndpoint(
  app: AnyElysia,
  endpoint: ZeroEndpointDefinition,
  inheritedAccess: ResolvedAccessPlan,
  kernel: AuthorizationKernel | null,
  runtime?: ZeroAppRuntime,
  routePrefix = '',
): AnyElysia {
  const access = mergeAccessPlan(inheritedAccess, endpoint.auth, kernel);
  const routeOptions = buildRouteOptions(endpoint, access);
  const multipartGuard = createEarlyMultipartGuard(
    access,
    runtime,
    joinRoutePaths(routePrefix, endpoint.path),
    endpoint.method,
  );
  const guardedApp = multipartGuard
    ? (app as AnyElysia & {
        onRequest(handler: ReturnType<typeof createProtectedMultipartRequestGuard>): AnyElysia;
      }).onRequest(multipartGuard)
    : app;

  return (guardedApp as AnyElysia & {
    route(method: string, path: string, handler: (context: unknown) => MaybePromise<unknown>, hook?: unknown): AnyElysia;
  }).route(
    endpoint.method,
    endpoint.path,
    async function zeroEndpointHandler(context: unknown) {
      const handlerContext = createLifecycleContext(context, access, runtime);
      return endpoint.handler(handlerContext);
    },
    routeOptions
  );
}

async function applyRouter(
  app: AnyElysia,
  router: ZeroRouterDefinition,
  inheritedAccess: ResolvedAccessPlan,
  kernel: AuthorizationKernel | null,
  runtime?: ZeroAppRuntime,
  routePrefix = '',
): Promise<AnyElysia> {
  const access = mergeAccessPlan(inheritedAccess, router.auth, kernel);
  const fullPrefix = joinRoutePaths(routePrefix, router.prefix ?? '');
  let routerApp = createServerRoute(
    {
      name: `zero.router.${router.name}`,
      prefix: router.prefix,
    },
    runtime,
  ) as AnyElysia;

  routerApp = applyAuthGuard(routerApp, access, runtime, fullPrefix);

  const children = [...(router.endpoints ?? []), ...(router.routes ?? [])];
  for (const child of children) {
    routerApp = await applyServerExtensionWithPlan(
      routerApp,
      child,
      access,
      kernel,
      runtime,
      fullPrefix,
    );
  }

  return usePlugin(app, routerApp);
}

function applyMiddleware(
  app: AnyElysia,
  middleware: ZeroMiddlewareDefinition,
  inheritedAccess: ResolvedAccessPlan,
  kernel: AuthorizationKernel | null,
  runtime?: ZeroAppRuntime,
): AnyElysia {
  const matcher = middleware.normalizedMatcher;
  const accessPlan = mergeAccessPlan(inheritedAccess, middleware.auth, kernel);

  return (app as AnyElysia & {
    onBeforeHandle(handler: (context: unknown) => MaybePromise<unknown>): AnyElysia;
  }).onBeforeHandle(async function zeroMiddlewareHandler(context: unknown) {
    const current = asContext(context);
    const matchContext = createLifecycleContextWithUser(context, current.authContext, runtime);
    const applicability = await evaluateMiddlewareApplicability(matcher, matchContext);
    if (!applicability.applies) return undefined;

    current.access.authorize(accessPlan.requirement);
    current.authContext = current.access.context;
    const admittedMatchContext = createLifecycleContextWithUser(
      context,
      current.authContext,
      runtime,
    );
    const matcherUser = enforceServerPolicy(
      matcher,
      admittedMatchContext,
      createServerPolicyOptions(runtime, kernel),
    );
    const user = accessPlan.forceAnonymous
      ? null
      : accessPlan.requirement.user === 'required'
        ? current.access.requireUser()
        : matcherUser;
    const handlerContext = createLifecycleContextWithUser(context, user, runtime);

    try {
      return await middleware.run(handlerContext);
    } finally {
      // Middleware admission is scoped to the middleware callback. Descendant
      // routes establish their own merged policy and must not inherit a
      // visible API-key identity merely because this callback admitted it.
      current.access.authorize('optional');
      current.authContext = current.access.context;
    }
  });
}

async function applyPlugin(
  app: AnyElysia,
  plugin: ZeroPluginDefinition,
  runtime?: ZeroAppRuntime,
): Promise<AnyElysia> {
  const child = createServerRoute({ name: `zero.plugin.${plugin.name}` }, runtime);
  const result = await plugin.setup({
    app: child,
    zero: createLazyServerRouteServices(runtime),
  });

  return usePlugin(app, result ?? child);
}

function applyAuthGuard(
  app: AnyElysia,
  access: ResolvedAccessPlan,
  runtime?: ZeroAppRuntime,
  routePrefix = '',
): AnyElysia {
  const guard = createAuthGuard(access);
  if (!guard) return app;

  const multipartGuard = createEarlyMultipartGuard(
    access,
    runtime,
    (request) => matchesRoutePrefix(request, routePrefix),
  );

  return (app as AnyElysia & {
    onRequest(handler: ReturnType<typeof createProtectedMultipartRequestGuard>): AnyElysia;
    onBeforeHandle(handler: (context: unknown) => MaybePromise<unknown>): AnyElysia;
  }).onRequest(multipartGuard!).onBeforeHandle(guard);
}

function buildRouteOptions(
  endpoint: ZeroEndpointDefinition,
  access: ResolvedAccessPlan,
): Record<string, unknown> {
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
    beforeHandle: prependHook(createAuthGuard(access), endpoint.beforeHandle),
    afterHandle: endpoint.afterHandle,
    mapResponse: endpoint.mapResponse,
    error: endpoint.error,
  });
}

function createEarlyMultipartGuard(
  access: ResolvedAccessPlan,
  runtime?: ZeroAppRuntime,
  path?: string | ((request: Request) => boolean),
  method?: string,
) {
  if (!requiresPreHandlerAdmission(access.requirement)) return undefined;
  const getAppTokenService = runtime
    ? () => runtime.get(ZERO_AUTH_TOKEN_SERVICE)
    : getTokenService;
  return createProtectedMultipartRequestGuard(getAppTokenService, {
    requirement: access.requirement,
    path,
    method,
  }, createAuthorizationDependencies(runtime));
}

function createAuthGuard(
  access: ResolvedAccessPlan,
): ((context: unknown) => void) | undefined {
  if (!requiresPreHandlerAdmission(access.requirement)) return undefined;
  return function requireZeroAccess(context: unknown): void {
    const current = asContext(context);
    current.access.authorize(access.requirement);
    current.authContext = current.access.context;
  };
}

function requiresPreHandlerAdmission(
  requirement: CompiledAccessRequirement,
): boolean {
  return requirement.user === 'required'
    || requirement.credentialKinds?.includes('api-key') === true;
}

function createLifecycleContext(
  context: unknown,
  access: ResolvedAccessPlan,
  runtime?: ZeroAppRuntime,
): ZeroLifecycleContext {
  const current = asContext(context);
  current.access.authorize(access.requirement);
  current.authContext = current.access.context;
  const user = access.forceAnonymous
    ? null
    : access.requirement.user === 'required'
      ? current.access.requireUser()
      : current.authContext ?? null;

  return createLifecycleContextWithUser(context, user, runtime);
}

function createLifecycleContextWithUser(
  context: unknown,
  user: AuthContext | null,
  runtime?: ZeroAppRuntime,
): ZeroLifecycleContext {
  const current = asContext(context);
  const zero = current.zero ?? getServerRouteServices(runtime);

  return {
    ...current,
    auth: user,
    user,
    zero,
  } as ZeroLifecycleContext;
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

function joinRoutePaths(prefix: string, path: string): string {
  const left = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  const right = path === '/' ? '' : path.replace(/^\/+/, '');
  const joined = `${left}/${right}`.replace(/\/+/g, '/');
  return joined || '/';
}

function matchesRoutePrefix(request: Request, prefix: string): boolean {
  const normalized = joinRoutePaths('', prefix);
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/') return true;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

function usePlugin(app: AnyElysia, plugin: ServerRoutePlugin): AnyElysia {
  return (app as AnyElysia & { use(plugin: ServerRoutePlugin): AnyElysia }).use(plugin);
}

function asContext(context: unknown): ZeroLifecycleContext {
  return context as ZeroLifecycleContext;
}

function createRootAccessPlan(
  requirement: AccessRequirement | CompiledAccessRequirement,
  kernel: AuthorizationKernel | null,
): ResolvedAccessPlan {
  const compiled = isCompiledAccessRequirement(requirement)
    ? validateCompiledForKernel(requirement, kernel)
    : kernel?.compile(requirement) ?? compileAccessRequirement(requirement);
  return {
    requirement: compiled,
    forceAnonymous: compiled.user === 'optional' && requirement === false,
  };
}

function mergeAccessPlan(
  parent: ResolvedAccessPlan,
  child: AccessRequirement | undefined,
  kernel: AuthorizationKernel | null,
): ResolvedAccessPlan {
  if (child === undefined) return parent;
  const requirement = kernel
    ? kernel.merge(parent.requirement, child)
    : mergeAccessRequirements(parent.requirement, child);
  return {
    requirement,
    // A public child cannot discard a required parent. For an otherwise
    // optional branch, explicit false retains its legacy anonymous context.
    forceAnonymous: requirement.user === 'optional' && child === false,
  };
}

function validateCompiledForKernel(
  requirement: CompiledAccessRequirement,
  kernel: AuthorizationKernel | null,
): CompiledAccessRequirement {
  // Merging with an empty declaration preserves the requirement while running
  // serialized-shape validation. A configured kernel additionally applies its
  // role, permission, tenant, and property registry checks.
  return kernel
    ? kernel.merge(requirement, false)
    : mergeAccessRequirements(requirement, false);
}

function resolveAuthorizationKernel(runtime?: ZeroAppRuntime): AuthorizationKernel | null {
  return runtime
    ? runtime.get(ZERO_AUTHORIZATION_KERNEL)
    : getAuthorizationKernel();
}

function createAuthorizationDependencies(
  runtime?: ZeroAppRuntime,
): AuthMiddlewareAuthorizationOptions {
  return {
    getRequestCredentialResolver: runtime
      ? () => runtime.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
      : getAuthRequestCredentialResolver,
    getAuthorizationKernel: runtime
      ? () => runtime.get(ZERO_AUTHORIZATION_KERNEL)
      : getAuthorizationKernel,
    getPropertyStore: runtime
      ? () => runtime.get(ZERO_AUTH_STORE)
      : getAuthStore,
    getRoleAssignments: runtime
      ? () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
      : undefined,
  };
}

function createServerPolicyOptions(
  runtime: ZeroAppRuntime | undefined,
  kernel: AuthorizationKernel | null,
): ZeroPolicyEvaluationOptions {
  return {
    getPropertyStore: runtime
      ? () => runtime.get(ZERO_AUTH_STORE)
      : getAuthStore,
    getPropertyRegistry: () => kernel
      ? { isPolicyTrusted: (key) => kernel.isPolicyTrustedProperty(key) }
      : null,
  };
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
