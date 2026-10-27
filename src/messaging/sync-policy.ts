/** Reserved conversation typing authorization. Reuses Guardian references and canonical membership on every publish and subscriber delivery. */
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_AUTH_STORE, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTHORIZATION_KERNEL, ZERO_AUTHORIZATION_ROLE_SERVICE } from '../runtime/service-keys';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { requireRequestServiceDataScope, serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import type { EphemeralTopicDecision, EphemeralTopicPolicyContext } from '../sync/ephemeral-policy';
import { ZERO_MESSAGING } from './service';
import { AuthError } from '../auth/types';
export async function authorizeMessagingTyping(runtime: ZeroAppRuntime, context: EphemeralTopicPolicyContext, scope: ServiceDataScope): Promise<EphemeralTopicDecision> {
  const deny = (): EphemeralTopicDecision => ({ ok: false, code: 'EPHEMERAL_FORBIDDEN', reason: 'Conversation typing is not available.' });
  const service = runtime.get(ZERO_MESSAGING), tokens = runtime.get(ZERO_AUTH_TOKEN_SERVICE), users = runtime.get(ZERO_AUTH_STORE), kernel = runtime.get(ZERO_AUTHORIZATION_KERNEL);
  const auth = context.authContext, matched = /^typing:messaging:([A-Za-z0-9][A-Za-z0-9_.:-]{0,199}?)(:staff)?$/.exec(context.topic);
  if (!service || !tokens || !users || !kernel || !auth || !matched) return deny();
  const reference = tokens.captureAuthContextAuthority(auth); if (!reference) return deny();
  const accessFor = () => {
    const current = tokens.resolveAuthContextAuthority(reference); if (!current) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
    return createRequestAuthorizationAccess({ authContext: current, kernel, propertyStore: users, roleAssignments: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE), assertCurrentProfile: () => tokens.assertCurrentProfile() });
  };
  try {
    const access = accessFor(), check = () => { if (serviceDataScopeKey(requireRequestServiceDataScope(accessFor(), () => kernel)) !== serviceDataScopeKey(scope)) throw new AuthError('Messaging scope changed.', 'AUTH_STATE_CHANGED', 409); };
    check();
    if (!await service.typingMember({ access, scope, assertCurrentAuthoritySync: check }, matched[1]!, Boolean(matched[2]), context.operation !== 'subscribe')) return deny();
    const actorKey = 'user:' + auth.userId, session = context.key?.startsWith(actorKey + ':session:') && /^[A-Za-z0-9_-]{8,80}$/.test(context.key.slice((actorKey + ':session:').length));
    if (context.operation !== 'subscribe' && !session) return { ok: false, code: 'EPHEMERAL_KEY_NOT_OWNED', reason: 'Typing uses the current user and tab key.' };
    if (context.operation === 'set') {
      if (!Number.isSafeInteger(context.ttl) || context.ttl! < 1000 || context.ttl! > 15000) return { ok: false, code: 'EPHEMERAL_INVALID_TTL', reason: 'Typing requires a short server expiry.' };
      const value = context.value;
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.userId !== auth.userId) return deny();
      const metadata = value.metadata;
      if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => key !== 'activity') || !['typing', 'recording', 'uploading'].includes(String(metadata.activity)))) return deny();
      if (Object.keys(value).some(key => !['userId', 'label', 'since', 'updatedAt', 'metadata'].includes(key)) || typeof value.label !== 'string' || value.label.length > 160 || !Number.isFinite(value.since) || !Number.isFinite(value.updatedAt)) return deny();
    }
    check(); return { ok: true, namespace: serviceDataScopeKey(scope) + ':messaging:' + matched[1] + (matched[2] ? ':staff' : '') + ':typing', keyOwnership: 'actor' };
  } catch (error) { if (error instanceof AuthError && error.status < 500) return deny(); throw error; }
}
