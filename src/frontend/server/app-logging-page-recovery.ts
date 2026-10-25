/** Narrow cookie recovery capability for content-free SSR audit admission, not ordinary API authentication. */
import { resolvePageSessionCookie } from '../../auth/page-session';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_STORE, ZERO_AUTHORIZATION_KERNEL, ZERO_AUTHORIZATION_ROLE_SERVICE } from '../../runtime/service-keys';
import { createServerRequestServices } from './server-request-services';
import { getServerRouteServices } from './server-services';
import type { ScopedLogging } from '../../logging/logging-api-contracts';

export function loggingPageRecovery(runtime: ZeroAppRuntime, publicUrl?: string) {
  return async (request: Request): Promise<ScopedLogging | null> => {
    if (request.method !== 'POST' || request.headers.has('authorization') || request.headers.get('x-zero-logging-recovery') !== '1') return null;
    const expected = new URL(publicUrl ?? request.url).origin;
    if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') return null;
    const tokens = runtime.get(ZERO_AUTH_TOKEN_SERVICE);
    if (!tokens) return null;
    const resolved = await resolvePageSessionCookie(request, tokens);
    if (!resolved || resolved.auth.sessionKind === 'native') return null;
    const access = createRequestAuthorizationAccess({ authContext: resolved.auth,
      kernel: runtime.get(ZERO_AUTHORIZATION_KERNEL), propertyStore: runtime.get(ZERO_AUTH_STORE),
      roleAssignments: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE), assertCurrentProfile: () => tokens.assertCurrentProfile() });
    access.authorize({ user: 'required', credentials: ['session'] });
    return createServerRequestServices({ request, access, services: getServerRouteServices(runtime) }).logging;
  };
}
