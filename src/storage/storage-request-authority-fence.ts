/** Credential-neutral request authority fences for delayed Storage commits. */

import type { AuthRequestCredentialResolver } from '../auth/auth-api-key-types';
import { readAuthBearerToken } from '../auth/auth-bearer-token';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import type { TokenService } from '../auth/token-service';
import { AuthError, type AuthContext } from '../auth/types';

export interface StorageAuthorityFenceDependencies {
  readonly getCredentialResolver: () => AuthRequestCredentialResolver | null;
  readonly getTokenService: () => TokenService | null;
  readonly getUserProperties: (userId: string) => Record<string, string>;
}

/** Rehydrate bearer authority after byte staging and before upload publication. */
export function createStorageUploadCommitFence(
  request: Request,
  admitted: AuthContext,
  dependencies: StorageAuthorityFenceDependencies,
): () => Promise<void> {
  const bearer = readAuthBearerToken(request);
  const credentials = dependencies.getCredentialResolver();
  const requestReference = credentials
    ? captureAuthority(credentials, admitted)
    : null;
  const captured = fingerprint(admitted, dependencies);

  return async () => {
    const tokens = dependencies.getTokenService();
    let current: AuthContext | null = null;
    try {
      current = requestReference
        ? credentials!.resolveAuthority(requestReference)
        : !credentials && bearer && tokens
          ? await tokens.resolveAuthContext(bearer)
          : null;
    } catch {
      current = null;
    }
    assertUnchanged(current, captured, dependencies, 'upload');
  };
}

/** Rehydrate authority synchronously inside a move/copy/delete transaction. */
export function createStorageMutationCommitFence(
  admitted: AuthContext,
  dependencies: StorageAuthorityFenceDependencies,
): () => void {
  const credentials = dependencies.getCredentialResolver();
  const requestReference = credentials
    ? captureAuthority(credentials, admitted)
    : null;
  const tokens = dependencies.getTokenService();
  const sessionReference = !credentials
    && tokens
    && typeof tokens.captureAuthContextAuthority === 'function'
    && typeof tokens.resolveAuthContextAuthority === 'function'
    ? tokens.captureAuthContextAuthority(admitted)
    : null;
  const captured = fingerprint(admitted, dependencies);

  return () => {
    let current: AuthContext | null = null;
    try {
      current = requestReference
        ? credentials!.resolveAuthority(requestReference)
        : sessionReference && tokens
          ? tokens.resolveAuthContextAuthority(sessionReference)
          : null;
    } catch {
      current = null;
    }
    assertUnchanged(current, captured, dependencies, 'mutation');
  };
}

function captureAuthority(
  credentials: AuthRequestCredentialResolver,
  context: AuthContext,
) {
  try {
    return credentials.captureAuthority(context);
  } catch {
    return null;
  }
}

function fingerprint(
  context: AuthContext,
  dependencies: StorageAuthorityFenceDependencies,
): string {
  return authContextAuthorityFingerprint(
    context,
    dependencies.getUserProperties(context.userId),
  );
}

function assertUnchanged(
  current: AuthContext | null,
  captured: string,
  dependencies: StorageAuthorityFenceDependencies,
  operation: 'upload' | 'mutation',
): void {
  const properties = current
    ? dependencies.getUserProperties(current.userId)
    : {};
  if (authContextAuthorityFingerprint(current, properties) === captured) return;
  throw new AuthError(
    operation === 'upload'
      ? 'Authorization changed during the upload; retry with the current session'
      : 'Authorization changed during the storage mutation; retry with current credentials',
    'AUTH_STATE_CHANGED',
    409,
  );
}
