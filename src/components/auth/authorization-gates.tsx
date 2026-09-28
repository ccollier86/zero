'use client';

import * as React from 'react';
import {
  hasAnyAuthorizationPermission,
  hasEveryAuthorizationPermission,
} from '../../frontend/client/auth-authorization-types';
import { useAuthorization } from '../../frontend/client/authorization-hooks';

interface AuthorizationGateFallbacks {
  /** Rendered until the first scope-safe snapshot arrives. Defaults to nothing. */
  loadingFallback?: React.ReactNode;
  /** Rendered for denial, logout, fetch failure, or revocation. Defaults to nothing. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export interface PermissionGateProps extends AuthorizationGateFallbacks {
  /** One or more declarative permission keys. */
  permission: string | readonly string[];
  /** Require every permission (default) or any one permission. */
  match?: 'all' | 'any';
}

export interface TenantGateProps extends AuthorizationGateFallbacks {
  /** Optionally require this exact active tenant id. */
  tenantId?: string;
  /** Optionally require any one current tenant role. */
  role?: string | readonly string[];
}

export type PlatformAdminGateProps = AuthorizationGateFallbacks;

/**
 * UI visibility gate for the current live permission projection.
 * Protected routes and data must independently declare server authorization.
 */
export function PermissionGate({
  permission,
  match = 'all',
  loadingFallback = null,
  fallback = null,
  children,
}: PermissionGateProps) {
  const current = useAuthorization();
  if (current.isLoading) return <>{loadingFallback}</>;
  const permissions = typeof permission === 'string' ? [permission] : permission;
  const allowed = current.isReady && (match === 'any'
    ? hasAnyAuthorizationPermission(current.authorization, permissions)
    : hasEveryAuthorizationPermission(current.authorization, permissions));
  return <>{allowed ? children : fallback}</>;
}

/** Render only within the current live tenant scope, optionally narrowed by id/role. */
export function TenantGate({
  tenantId,
  role,
  loadingFallback = null,
  fallback = null,
  children,
}: TenantGateProps) {
  const current = useAuthorization();
  if (current.isLoading) return <>{loadingFallback}</>;
  const scope = current.authorization?.scope;
  const roles = role === undefined ? null : typeof role === 'string' ? [role] : role;
  const allowed = current.isReady
    && scope?.kind === 'tenant'
    && (tenantId === undefined || scope.tenantId === tenantId)
    && (roles === null || roles.some((candidate) => scope.roles.includes(candidate)));
  return <>{allowed ? children : fallback}</>;
}

/** Render only for the existing live global/platform `admin` role. */
export function PlatformAdminGate({
  loadingFallback = null,
  fallback = null,
  children,
}: PlatformAdminGateProps) {
  const current = useAuthorization();
  if (current.isLoading) return <>{loadingFallback}</>;
  const allowed = current.isReady
    && current.authorization?.identity.platformRole === 'admin';
  return <>{allowed ? children : fallback}</>;
}
