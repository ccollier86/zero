import { readAuthBearerToken } from '../../../auth/auth-bearer-token';
import { authContextAuthorityFingerprint } from '../../../auth/auth-context-authority';
import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import {
  applicationServiceDataScope,
  requireRequestServiceDataScope,
  type ServiceDataScope,
} from '../../../auth/service-data-scope';
import { AuthError, type AuthContext } from '../../../auth/types';
import type { ServerRouteServices } from '../server-services';

export interface RequestAuthorityRevalidators {
  synchronous: () => void;
  asynchronous: () => Promise<void>;
}

export function resolveRequestScope(
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): ServiceDataScope | null {
  const kernel = services.auth.authorizationKernel;
  const tenantShaped = kernel?.tenancy.mode === 'multi'
    || access.context?.sessionScopeKind === 'tenant'
    || access.context?.tenantId !== undefined
    || access.context?.membershipId !== undefined;

  if (!tenantShaped) {
    // Retain historical single-tenant backend behavior, including public
    // action-token/webhook routes whose own proof is not an auth session.
    return applicationServiceDataScope();
  }

  try {
    return requireRequestServiceDataScope(
      access,
      () => services.auth.authorizationKernel,
    );
  } catch {
    return null;
  }
}

export function createAuthorityRevalidators(
  request: Request,
  access: RequestAuthorizationAccess,
  services: ServerRouteServices,
): RequestAuthorityRevalidators {
  const captured = authContextAuthorityFingerprint(
    access.context,
    access.context
      ? services.auth.store?.getProperties(access.context.userId) ?? {}
      : {},
  );
  const bearer = readAuthBearerToken(request);
  const tokens = services.auth.tokens;
  // Standalone/compatibility token-service adapters may implement only
  // `resolveAuthContext()`. They can still support asynchronous revalidation,
  // while synchronous mutations must continue to fail closed without the
  // durable capture/resolve pair.
  const reference = access.context
    && tokens
    && typeof tokens.captureAuthContextAuthority === 'function'
    && typeof tokens.resolveAuthContextAuthority === 'function'
    ? tokens.captureAuthContextAuthority(access.context)
    : null;

  const validateResolved = (current: AuthContext | null): void => {
    const properties = current
      ? services.auth.store?.getProperties(current.userId) ?? {}
      : {};
    if (authContextAuthorityFingerprint(current, properties) !== captured) {
      throw authorityChanged();
    }
  };

  const synchronous = (): void => {
    // Anonymous single-tenant server routes retain their explicit trusted
    // route semantics; there is no auth authority to revalidate.
    if (!access.context) return;
    if (!tokens || !reference) throw authorityChanged();
    let current: AuthContext | null = null;
    try {
      current = tokens.resolveAuthContextAuthority(reference);
    } catch {
      throw authorityChanged();
    }
    validateResolved(current);
  };

  const asynchronous = async (): Promise<void> => {
    if (!access.context) return;
    if (reference) {
      synchronous();
      return;
    }
    // Upgrade compatibility for an already-admitted legacy bearer which has
    // no durable parent reference. Synchronous mutations fail closed above.
    if (!bearer || !tokens) throw authorityChanged();

    let current: AuthContext | null = null;
    try {
      current = await tokens.resolveAuthContext(bearer);
    } catch {
      throw authorityChanged();
    }
    validateResolved(current);
  };

  return { synchronous, asynchronous };
}

function authorityChanged(): AuthError {
  return new AuthError(
    'Authorization changed during the request; retry with the current session',
    'AUTH_STATE_CHANGED',
    409,
  );
}
