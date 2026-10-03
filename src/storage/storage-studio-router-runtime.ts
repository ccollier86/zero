/**
 * storage-studio-router-runtime.ts
 *
 * Binds explicitly admitted Guardian request authority to Storage Studio and
 * projects domain failures into safe HTTP/observability contracts.
 */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import {
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import type { AuthorizationKernel } from '../auth/authorization-kernel';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError, normalizeStorageError } from './storage-domain-error';
import { toStorageHttpFailure, type StorageHttpOperation } from './storage-http-error';
import {
  resolveStorageStudioAuthority,
  type StorageStudioAuthority,
} from './storage-studio-authority';
import type { StorageStudioService } from './storage-studio-service';

export const STORAGE_STUDIO_ROUTE_AUTH = Object.freeze({
  user: 'required' as const,
  credentials: ['session', 'api-key'] as const,
});

export interface StorageStudioRouterRuntimeOptions {
  readonly config: ResolvedStorageStudioConfig;
  readonly getService: () => StorageStudioService | null;
  readonly getAuthorizationKernel: () => AuthorizationKernel | null;
  readonly getUserProperties: (userId: string) => Record<string, string>;
}

export interface StorageStudioRequestActor {
  readonly service: StorageStudioService;
  readonly authority: StorageStudioAuthority;
  readonly scope: ServiceDataScope;
  readonly userProperties: Record<string, string>;
}

/** Admit session/API-key authority and bind it to its server-owned data scope. */
export function requireStorageStudioRequestActor(
  access: RequestAuthorizationAccess,
  options: StorageStudioRouterRuntimeOptions,
): StorageStudioRequestActor {
  access.authorize(STORAGE_STUDIO_ROUTE_AUTH);
  const scope = requireRequestServiceDataScope(access, options.getAuthorizationKernel);
  const authority = resolveStorageStudioAuthority(access, scope, options.config);
  const service = options.getService();
  if (!service) {
    throw new StorageDomainError('STORAGE_NOT_READY', 'Storage Studio is not ready.');
  }
  return Object.freeze({
    service,
    authority,
    scope,
    userProperties: Object.freeze({
      ...options.getUserProperties(authority.actor.userId),
    }),
  });
}

/** Run one admitted route operation through the closed Storage error boundary. */
export async function runStorageStudioRoute<T>(
  set: { status?: number | string },
  operationName: string,
  operation: StorageHttpOperation,
  callback: () => T | Promise<T>,
): Promise<T | object> {
  try {
    return await callback();
  } catch (cause) {
    const error = normalizeStorageError(cause);
    const failure = toStorageHttpFailure(error, operation);
    emitPlatformCode(
      failure.status >= 500
        ? OBS_CODES.STORAGE_STUDIO_OPERATION_FAILED
        : OBS_CODES.STORAGE_STUDIO_OPERATION_REJECTED,
      {
        error,
        metadata: {
          operation: operationName,
          code: error.code,
          retryable: error.retryable,
          outcome: error.outcome ?? 'none',
        },
      },
    );
    set.status = failure.status;
    return failure.body;
  }
}

/** Close Elysia parser/schema failures before their diagnostic payload is serialized. */
export function handleStorageStudioTransportError(
  code: unknown,
  set: { status?: number | string },
): object | undefined {
  if (code !== 'VALIDATION' && code !== 'PARSE') return undefined;
  const error = new StorageDomainError(
    'STORAGE_INPUT_INVALID',
    'Storage Studio request input is invalid.',
  );
  const failure = toStorageHttpFailure(error, 'write');
  emitPlatformCode(OBS_CODES.STORAGE_STUDIO_OPERATION_REJECTED, {
    error,
    metadata: {
      operation: code === 'PARSE' ? 'request.parse' : 'request.validation',
      code: error.code,
      retryable: error.retryable,
      outcome: error.outcome ?? 'none',
    },
  });
  set.status = failure.status;
  return failure.body;
}
