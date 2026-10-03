/** Authority, service binding, error projection, and filter parsing for routes. */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { AuthContext, PermissionKey } from '../auth/types';
import type { ZeroLifecycleContext } from '../frontend/server/server-extensions';
import type { ServerRequestServices } from '../frontend/server/server-request-services';
import { OBS_CODES } from '../observability/codes';
import { DataStudioError, normalizeDataStudioError } from './data-studio-error';
import { toDataStudioHttpFailure } from './data-studio-http-error';
import { DataStudioService } from './data-studio-service';

export const DATA_STUDIO_TENANT_AUTH = Object.freeze({
  user: 'required' as const,
  tenant: 'required' as const,
  credentials: ['session', 'api-key'] as const,
});

export type DataStudioRouteContext = ZeroLifecycleContext<
  any,
  any,
  any,
  any,
  AuthContext | null
>;

export function dataStudioPermissionAuth(permission: PermissionKey) {
  return Object.freeze({ ...DATA_STUDIO_TENANT_AUTH, permission });
}

export function dataStudioRequestService(
  context: DataStudioRouteContext,
): DataStudioService {
  const { auth, zero } = requireDataStudioOrganizationContext(context);
  if (!zero.data) {
    throw new DataStudioError(
      'DATA_STUDIO_NOT_READY',
      'Data Studio tenant database is not ready.',
    );
  }
  return new DataStudioService({
    data: zero.data,
    actor: {
      userId: auth.userId,
      membershipId: auth.membershipId!,
    },
  });
}

export function requireDataStudioOrganizationContext(
  context: DataStudioRouteContext,
): {
  readonly auth: AuthContext;
  readonly access: RequestAuthorizationAccess;
  readonly zero: ServerRequestServices;
} {
  const auth = context.access.requireUser();
  const scope = context.access.requireTenant();
  if (auth.tenantKind !== 'organization'
    || auth.tenantId !== scope.tenantId
    || auth.membershipId !== scope.membershipId
    || context.zero.scope?.scopeKind !== 'tenant'
    || context.zero.scope.tenantId !== scope.tenantId) {
    throw new DataStudioError(
      'DATA_STUDIO_AUTHORITY_REQUIRED',
      'Data Studio requires an active organization membership.',
    );
  }
  return { auth, access: context.access, zero: context.zero };
}

export async function dataStudioRouteRead<T>(
  context: DataStudioRouteContext,
  operation: string,
  callback: () => Promise<T>,
): Promise<T | object> {
  return await routeOperation(context, operation, 'read', callback);
}

export async function dataStudioRouteWrite<T>(
  context: DataStudioRouteContext,
  operation: string,
  callback: () => Promise<T>,
): Promise<T | object> {
  return await routeOperation(context, operation, 'write', callback);
}

export function parseDataStudioFilters(value: string): readonly {
  columnKey: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string | number | boolean | null;
}[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('invalid');
    return parsed as ReturnType<typeof parseDataStudioFilters>;
  } catch (cause) {
    throw new DataStudioError(
      'DATA_STUDIO_VALUE_INVALID',
      'Data Studio filters are invalid.',
      { cause },
    );
  }
}

async function routeOperation<T>(
  context: DataStudioRouteContext,
  operation: string,
  kind: 'read' | 'write',
  callback: () => Promise<T>,
): Promise<T | object> {
  try {
    return await callback();
  } catch (error) {
    const normalized = normalizeDataStudioError(error);
    const failure = toDataStudioHttpFailure(normalized, kind);
    context.zero.observability.emitCode(
      failure.status >= 500
        ? OBS_CODES.DATA_STUDIO_OPERATION_FAILED
        : OBS_CODES.DATA_STUDIO_OPERATION_REJECTED,
      {
        metadata: {
          operation,
          code: normalized.code,
          retryable: normalized.retryable,
          outcome: normalized.outcome ?? 'none',
        },
      },
    );
    (context.set as { status?: number }).status = failure.status;
    return failure.body;
  }
}
