/** Capture an opaque Guardian session and the server-selected data scope; client body/query fields cannot choose either. */
import { AuthError, type AuthContext } from '../auth/types';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { requireRequestServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import type { MessagingPluginConfig } from './plugin';
export function currentMessagingRequest(config: MessagingPluginConfig, identity: AuthContext, request: Request) {
  const service = config.getService(), tokens = config.getTokenService();
  if (!service || !tokens) throw new AuthError('Messaging is unavailable.', 'MESSAGING_NOT_READY', 503);
  const reference = tokens.captureAuthContextAuthority(identity); if (!reference) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const kernel = config.authorization.getAuthorizationKernel?.() ?? null;
  const accessFor = (current: AuthContext) => createRequestAuthorizationAccess({ authContext: current, kernel,
    propertyStore: config.authorization.getPropertyStore?.(), roleAssignments: config.authorization.getRoleAssignments?.(), assertCurrentProfile: () => tokens.assertCurrentProfile() });
  const access = accessFor(identity), scope = requireRequestServiceDataScope(access, () => kernel);
  const assertCurrentAuthoritySync = () => {
    const current = tokens.resolveAuthContextAuthority(reference);
    if (!current || current.userId !== identity.userId || serviceDataScopeKey(requireRequestServiceDataScope(accessFor(current), () => kernel)) !== serviceDataScopeKey(scope)) throw new AuthError('Messaging authority changed.', 'AUTH_STATE_CHANGED', 409);
    config.getLoggingRuntime?.()?.admission.assertCurrent({ auth: current, properties: config.authorization.getPropertyStore?.()?.getProperties(current.userId) ?? {} }, request);
  };
  const authority = { access, scope, assertCurrentAuthoritySync };
  return { service, authority, facade: service.forAuthority(authority) };
}
