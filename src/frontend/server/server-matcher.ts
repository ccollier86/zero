/**
 * server-matcher.ts
 *
 * Owns Zero backend matcher contracts and applicability evaluation for
 * app-owned server extensions. This file is framework-independent; it does not
 * import Elysia, read auth stores, or mount routes.
 */

export type MaybePromise<T> = T | Promise<T>;

export type ZeroAuthRequirement = false | 'optional' | 'user' | 'admin';
export type ZeroHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type ZeroHttpMethodInput = ZeroHttpMethod | Lowercase<ZeroHttpMethod>;
export type ZeroPolicyScalar = string | number | boolean;

export type ZeroPropertyRequirement =
  | ZeroPolicyScalar
  | ZeroPolicyScalar[]
  | {
      equals?: ZeroPolicyScalar;
      in?: ZeroPolicyScalar[];
      not?: ZeroPolicyScalar | ZeroPolicyScalar[];
      exists?: boolean;
    };

/** Minimal request context needed to evaluate app-owned middleware matchers. */
export interface ZeroMatcherContext extends Record<string, unknown> {
  request: Request;
}

export type ZeroPathMatcher =
  | string
  | RegExp
  | ((context: ZeroMatcherContext) => MaybePromise<boolean>);
export type ZeroRouteMatcher = ZeroPathMatcher;

/** Structured app middleware matcher used before auth/policy enforcement. */
export interface ZeroMiddlewareMatcher {
  path?: ZeroPathMatcher | ZeroPathMatcher[];
  method?: ZeroHttpMethodInput | ZeroHttpMethodInput[];
  auth?: ZeroAuthRequirement;
  role?: string | string[];
  properties?: Record<string, ZeroPropertyRequirement>;
  predicate?: (context: ZeroMatcherContext) => MaybePromise<boolean>;
}

/** Legacy matcher fields accepted by Phase 1 middleware declarations. */
export interface ZeroMiddlewareMatcherAliases {
  path?: ZeroPathMatcher | ZeroPathMatcher[];
  auth?: ZeroAuthRequirement;
}

/** Result returned by matcher applicability checks. */
export interface ZeroMatcherEvaluation {
  applies: boolean;
  method: ZeroHttpMethod;
  pathname: string;
  reason?: 'path' | 'method' | 'predicate';
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

/**
 * Normalize a middleware matcher while preserving Phase 1 alias fields.
 *
 * Explicit `matcher` fields win over legacy aliases. This keeps existing apps
 * working while letting the structured matcher become the canonical API.
 */
export function normalizeMiddlewareMatcher(options: {
  matcher?: ZeroMiddlewareMatcher;
} & ZeroMiddlewareMatcherAliases): ZeroMiddlewareMatcher {
  const matcher: ZeroMiddlewareMatcher = { ...(options.matcher ?? {}) };

  if (matcher.path === undefined && options.path !== undefined) matcher.path = options.path;
  if (matcher.auth === undefined && options.auth !== undefined) matcher.auth = options.auth;
  if (matcher.method !== undefined) matcher.method = normalizeMethodList(matcher.method);

  return matcher;
}

/**
 * Add inherited auth to a normalized matcher when the matcher did not set its
 * own auth policy.
 */
export function inheritMatcherAuth(
  matcher: ZeroMiddlewareMatcher,
  inheritedAuth: ZeroAuthRequirement
): ZeroMiddlewareMatcher {
  if (matcher.auth !== undefined) return matcher;
  if (inheritedAuth === 'optional') return matcher;
  return { ...matcher, auth: inheritedAuth };
}

/**
 * Return whether a middleware matcher applies to the current request.
 *
 * This only evaluates applicability: path, method, and predicate. Auth, role,
 * and property requirements are authorization policy and are evaluated in
 * server-policy.ts.
 */
export async function evaluateMiddlewareApplicability(
  matcher: ZeroMiddlewareMatcher | undefined,
  context: ZeroMatcherContext
): Promise<ZeroMatcherEvaluation> {
  const method = normalizeHttpMethod(context.request.method as ZeroHttpMethodInput);
  const pathname = normalizePathname(new URL(context.request.url).pathname);

  if (!matcher) return { applies: true, method, pathname };

  if (matcher.path !== undefined && !(await matchesAnyPath(matcher.path, pathname, context))) {
    return { applies: false, method, pathname, reason: 'path' };
  }

  if (matcher.method !== undefined && !matchesMethod(matcher.method, method)) {
    return { applies: false, method, pathname, reason: 'method' };
  }

  if (matcher.predicate && !(await matcher.predicate(context))) {
    return { applies: false, method, pathname, reason: 'predicate' };
  }

  return { applies: true, method, pathname };
}

/** Normalize an HTTP method and reject unsupported values early. */
export function normalizeHttpMethod(method: ZeroHttpMethodInput): ZeroHttpMethod {
  const normalized = method.toUpperCase();
  if (!HTTP_METHODS.has(normalized)) {
    throw new Error(`[server-matcher] Unsupported HTTP method: ${method}`);
  }

  return normalized as ZeroHttpMethod;
}

function normalizeMethodList(
  methods: ZeroHttpMethodInput | ZeroHttpMethodInput[]
): ZeroHttpMethod | ZeroHttpMethod[] {
  return Array.isArray(methods)
    ? methods.map((method) => normalizeHttpMethod(method))
    : normalizeHttpMethod(methods);
}

function matchesMethod(methods: ZeroHttpMethodInput | ZeroHttpMethodInput[], method: ZeroHttpMethod): boolean {
  const normalized = Array.isArray(methods)
    ? methods.map((value) => normalizeHttpMethod(value))
    : [normalizeHttpMethod(methods)];
  return normalized.includes(method);
}

async function matchesAnyPath(
  matcher: ZeroPathMatcher | ZeroPathMatcher[],
  pathname: string,
  context: ZeroMatcherContext
): Promise<boolean> {
  const matchers = Array.isArray(matcher) ? matcher : [matcher];

  for (const current of matchers) {
    if (typeof current === 'string' && matchesPathString(current, pathname)) return true;
    if (current instanceof RegExp && matchesRegExp(current, pathname)) return true;
    if (typeof current === 'function' && await current(context)) return true;
  }

  return false;
}

function matchesRegExp(pattern: RegExp, pathname: string): boolean {
  const lastIndex = pattern.lastIndex;
  pattern.lastIndex = 0;
  const matches = pattern.test(pathname);
  pattern.lastIndex = lastIndex;
  return matches;
}

function matchesPathString(pattern: string, pathname: string): boolean {
  const normalizedPattern = normalizePathname(pattern);
  if (normalizedPattern === '*' || normalizedPattern === '/*') return true;

  if (normalizedPattern.endsWith('/:path*')) {
    return matchesPathPrefix(normalizedPattern.slice(0, -'/:path*'.length), pathname);
  }

  if (normalizedPattern.endsWith('/*')) {
    return pathname.startsWith(normalizedPattern.slice(0, -1));
  }

  if (normalizedPattern.endsWith('*')) {
    return pathname.startsWith(normalizedPattern.slice(0, -1));
  }

  if (normalizedPattern.includes('/:')) {
    return matchesParameterizedPath(normalizedPattern, pathname);
  }

  return pathname === normalizedPattern;
}

function matchesPathPrefix(prefix: string, pathname: string): boolean {
  const normalizedPrefix = normalizePathname(prefix);
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`);
}

function matchesParameterizedPath(pattern: string, pathname: string): boolean {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((segment, index) => {
    if (segment.startsWith(':')) return pathSegments[index].length > 0;
    return segment === pathSegments[index];
  });
}

function splitPath(pathname: string): string[] {
  return normalizePathname(pathname)
    .split('/')
    .filter(Boolean);
}

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  if (pathname === '*') return '*';
  const prefixed = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return prefixed.length > 1 && prefixed.endsWith('/')
    ? prefixed.slice(0, -1)
    : prefixed;
}
