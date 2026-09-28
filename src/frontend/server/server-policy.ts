/**
 * server-policy.ts
 *
 * Owns app-owned server authorization policy evaluation for Zero middleware
 * matchers. This file depends on auth abstractions and observability only; it
 * does not mount Elysia plugins, scan files, or register routes.
 */

import { getAuthStore, getPropertyService } from '../../auth/auth-runtime';
import { AuthError, type AuthContext } from '../../auth/types';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type {
  ZeroAuthRequirement,
  ZeroMiddlewareMatcher,
  ZeroPolicyScalar,
  ZeroPropertyRequirement,
} from './server-matcher';

/** Minimal user-property store needed by middleware policy checks. */
export interface ZeroPolicyUserPropertyStore {
  getProperties(userId: string): Record<string, string>;
}

/** Minimal configured-property registry needed to trust policy inputs. */
export interface ZeroPolicyUserPropertyRegistry {
  isPolicyTrusted(key: string): boolean;
}

/** Request auth context needed to evaluate middleware policy. */
export interface ZeroPolicyContext {
  authContext: AuthContext | null;
}

/** Options for policy evaluation, mainly used by tests. */
export interface ZeroPolicyEvaluationOptions {
  getPropertyStore?: () => ZeroPolicyUserPropertyStore | null;
  getPropertyRegistry?: () => ZeroPolicyUserPropertyRegistry | null;
}

export type ZeroPolicyDenyReason =
  | 'unauthorized'
  | 'forbidden'
  | 'role'
  | 'property'
  | 'property-untrusted'
  | 'auth-unavailable';

/** Structured policy result for callers that need to inspect before throwing. */
export interface ZeroPolicyEvaluation {
  allowed: boolean;
  auth: AuthContext | null;
  reason?: ZeroPolicyDenyReason;
  status?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Evaluate auth, role, and property requirements for a middleware matcher.
 *
 * Path/method/predicate applicability must be evaluated before this function.
 * This function assumes the request applies and therefore fails closed when
 * authorization requirements are not satisfied.
 */
export function evaluateServerPolicy(
  matcher: ZeroMiddlewareMatcher | undefined,
  context: ZeroPolicyContext,
  options: ZeroPolicyEvaluationOptions = {}
): ZeroPolicyEvaluation {
  const auth = context.authContext;
  const effectiveAuth = getEffectiveAuthRequirement(matcher);

  if (effectiveAuth === 'optional' || effectiveAuth === false) {
    return { allowed: true, auth };
  }

  if (!auth) {
    return deny('unauthorized', 401, 'Unauthorized');
  }

  if (effectiveAuth === 'admin' && auth.role !== 'admin') {
    return deny('forbidden', 403, 'Forbidden', {
      requiredAuth: 'admin',
      role: auth.role,
    });
  }

  if (matcher?.role && !matchesRoleRequirement(auth.role, matcher.role)) {
    return deny('role', 403, 'Forbidden', {
      role: auth.role,
      requiredRole: matcher.role,
    });
  }

  if (matcher?.properties && Object.keys(matcher.properties).length > 0) {
    const propertyKeys = Object.keys(matcher.properties);
    const registry = (options.getPropertyRegistry ?? getPropertyService)();
    if (!registry) {
      emitPlatformCode(OBS_CODES.ROUTER_MIDDLEWARE_POLICY_AUTH_UNAVAILABLE, {
        metadata: {
          userId: auth.userId,
          propertyKeys,
          service: 'property-registry',
        },
      });
      return deny('auth-unavailable', 503, 'Auth policy services are unavailable');
    }

    const untrustedKeys = propertyKeys.filter((key) => !registry.isPolicyTrusted(key));
    if (untrustedKeys.length > 0) {
      emitPlatformCode(OBS_CODES.ROUTER_MIDDLEWARE_POLICY_PROPERTY_UNTRUSTED, {
        metadata: {
          propertyKeys: untrustedKeys,
        },
      });
      return deny(
        'property-untrusted',
        500,
        'Auth policy configuration is invalid',
        { propertyKeys: untrustedKeys }
      );
    }

    const store = (options.getPropertyStore ?? getAuthStore)();
    if (!store) {
      emitPlatformCode(OBS_CODES.ROUTER_MIDDLEWARE_POLICY_AUTH_UNAVAILABLE, {
        metadata: {
          userId: auth.userId,
          propertyKeys,
          service: 'property-store',
        },
      });
      return deny('auth-unavailable', 503, 'Auth policy services are unavailable');
    }

    const properties = store.getProperties(auth.userId);
    const denied = findDeniedProperty(properties, matcher.properties);
    if (denied) {
      return deny('property', 403, 'Forbidden', denied);
    }
  }

  return { allowed: true, auth };
}

/**
 * Evaluate middleware policy and throw AuthError when the request is denied.
 */
export function enforceServerPolicy(
  matcher: ZeroMiddlewareMatcher | undefined,
  context: ZeroPolicyContext,
  options: ZeroPolicyEvaluationOptions = {}
): AuthContext | null {
  const result = evaluateServerPolicy(matcher, context, options);
  if (result.allowed) return result.auth;

  throw new AuthError(
    result.message ?? 'Forbidden',
    result.status === 401
      ? 'UNAUTHORIZED'
      : result.status && result.status >= 500
        ? 'AUTH_POLICY_UNAVAILABLE'
        : 'FORBIDDEN',
    result.status ?? 403
  );
}

/** Return the effective auth level implied by matcher policy requirements. */
export function getEffectiveAuthRequirement(
  matcher: ZeroMiddlewareMatcher | undefined
): ZeroAuthRequirement {
  if (!matcher) return 'optional';
  if (matcher.auth === 'admin') return 'admin';
  if (matcher.auth === 'user') return 'user';
  if (matcher.role || hasPropertyRequirements(matcher)) return 'user';
  return matcher.auth ?? 'optional';
}

function matchesRoleRequirement(role: string, requirement: string | string[]): boolean {
  const roles = Array.isArray(requirement) ? requirement : [requirement];
  return roles.includes(role);
}

function findDeniedProperty(
  properties: Record<string, string>,
  requirements: Record<string, ZeroPropertyRequirement>
): Record<string, unknown> | null {
  for (const [key, requirement] of Object.entries(requirements)) {
    const value = properties[key] ?? null;
    if (!matchesPropertyRequirement(value, requirement)) {
      return {
        key,
        expected: requirement,
        actual: value,
      };
    }
  }

  return null;
}

function matchesPropertyRequirement(value: string | null, requirement: ZeroPropertyRequirement): boolean {
  if (Array.isArray(requirement)) {
    return value !== null && requirement.map(serializePolicyScalar).includes(value);
  }

  if (isPolicyScalar(requirement)) {
    return value === serializePolicyScalar(requirement);
  }

  if (requirement.exists !== undefined) {
    const exists = value !== null;
    if (exists !== requirement.exists) return false;
  }

  if (requirement.equals !== undefined && value !== serializePolicyScalar(requirement.equals)) {
    return false;
  }

  if (requirement.in !== undefined) {
    if (value === null) return false;
    if (!requirement.in.map(serializePolicyScalar).includes(value)) return false;
  }

  if (requirement.not !== undefined) {
    const deniedValues = Array.isArray(requirement.not)
      ? requirement.not.map(serializePolicyScalar)
      : [serializePolicyScalar(requirement.not)];
    if (value !== null && deniedValues.includes(value)) return false;
  }

  return true;
}

function hasPropertyRequirements(matcher: ZeroMiddlewareMatcher): boolean {
  return Boolean(matcher.properties && Object.keys(matcher.properties).length > 0);
}

function isPolicyScalar(value: unknown): value is ZeroPolicyScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function serializePolicyScalar(value: ZeroPolicyScalar): string {
  return String(value);
}

function deny(
  reason: ZeroPolicyDenyReason,
  status: number,
  message: string,
  metadata?: Record<string, unknown>
): ZeroPolicyEvaluation {
  return {
    allowed: false,
    auth: null,
    reason,
    status,
    message,
    metadata,
  };
}
