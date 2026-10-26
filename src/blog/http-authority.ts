/** Native blog HTTP authority capture. Reuses Guardian's opaque session reference; never accepts caller scope or actor fields. */
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { applicationServiceDataScope, requireRequestServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import { AuthError, type AuthContext } from '../auth/types';
import type { BlogPluginConfig } from './plugin';

/** Every final edge resolves the original session again, including revocation and selected-scope changes. */
export function currentBlogRequest(config: BlogPluginConfig, auth: AuthContext, request?: Request) {
  const service = config.getService(), tokens = config.getTokenService();
  if (!service || !tokens) throw new AuthError('Blog services are unavailable.', 'BLOG_NOT_READY', 503);
  const reference = tokens.captureAuthContextAuthority(auth);
  if (!reference) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  const kernel = config.authorization.getAuthorizationKernel?.() ?? null;
  const accessFor = (identity: AuthContext) => createRequestAuthorizationAccess({
    authContext: identity, kernel,
    propertyStore: config.authorization.getPropertyStore?.(),
    roleAssignments: config.authorization.getRoleAssignments?.(),
    assertCurrentProfile: () => tokens.assertCurrentProfile(),
  });
  const scopeFor = (identity: AuthContext) => service.ownership === 'application'
    ? applicationServiceDataScope() : requireRequestServiceDataScope(accessFor(identity), () => kernel);
  const scope = scopeFor(auth), access = accessFor(auth);
  const assertCurrentAuthoritySync = () => {
    const identity = tokens.resolveAuthContextAuthority(reference);
    if (!identity || identity.userId !== auth.userId || serviceDataScopeKey(scopeFor(identity)) !== serviceDataScopeKey(scope)) {
      throw new AuthError('Blog authority changed.', 'AUTH_STATE_CHANGED', 409);
    }
    if (request) config.getLoggingRuntime?.()?.admission.assertCurrent({ auth: identity,
      properties: config.authorization.getPropertyStore?.()?.getProperties(identity.userId) ?? {} }, request);
  };
  const authority = { access, scope, assertCurrentAuthoritySync };
  return { service, authority, facade: service.forAuthority(authority) };
}
