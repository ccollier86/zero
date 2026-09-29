import type * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type { AuthPlatformAdminSdkSurface } from './auth-platform-administration-types';
import type { TenantAdministrationBoundaryFence } from './tenant-administration-boundary';

export interface PlatformAdministrationSliceScope {
  enabled: boolean;
  boundaryRevision: number;
  fence: TenantAdministrationBoundaryFence;
  platform: AuthPlatformAdminSdkSurface | undefined;
}

export type PlatformAdministrationFailureAction =
  | 'platformAdministrationConfig'
  | 'platformAdministrationMembers'
  | 'platformAdministrationInvitations';

export function isCurrentPlatformRequest(
  scope: PlatformAdministrationSliceScope,
  requestGeneration: React.MutableRefObject<number>,
  expectedGeneration: number,
): boolean {
  return scope.fence.isCurrent(scope.boundaryRevision)
    && requestGeneration.current === expectedGeneration;
}

export function platformAdministrationErrorMessage(
  action: PlatformAdministrationFailureAction,
  cause: unknown,
  codeOnly = false,
): string {
  reportAuthClientActionFailure(action, cause, { codeOnly });
  return cause instanceof Error ? cause.message : 'Platform administration request failed';
}

export function boundedPlatformPageLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(value!)));
}

export function mergePlatformPageBy<T, K extends keyof T>(
  current: T[],
  incoming: T[],
  key: K,
): T[] {
  const values = new Map(current.map((entry) => [entry[key], entry]));
  for (const entry of incoming) values.set(entry[key], entry);
  return [...values.values()];
}

export function platformAdministrationUnavailable(): AuthClientError {
  return new AuthClientError(
    'Platform administration requires an active administration scope',
    404,
    'PLATFORM_ADMINISTRATION_UNAVAILABLE',
    null,
  );
}

export function platformAdministrationPermissionDenied(): AuthClientError {
  return new AuthClientError(
    'Your current administration role does not allow this action',
    403,
    'FORBIDDEN',
    null,
  );
}

export function stalePlatformAdministrationTarget(): AuthClientError {
  return new AuthClientError(
    'Reload administration members before changing this role set',
    409,
    'AUTHORIZATION_CHANGED',
    null,
  );
}

export function stalePlatformAdministrationOperation(): AuthClientError {
  return new AuthClientError(
    'The administration scope changed before this request completed',
    409,
    'AUTHORIZATION_CHANGED',
    null,
  );
}
