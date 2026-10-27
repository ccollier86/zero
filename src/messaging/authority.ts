/** Shared live Guardian actor projection for durable APIs and reserved ephemeral typing. No actor/scope is read from payload. */
import { AuthError } from '../auth/types';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingAuthority } from './service';
import type { MessagingActor } from './realm-model';
import { messagingFail, messagingId } from './validation';
export function createMessagingActorResolver(authority: MessagingAuthority, config: ResolvedMessagingConfig): (write?: boolean) => MessagingActor {
  const original = authority.access.requireUser(), scopeId = serviceDataScopeKey(authority.scope);
  return (write = false) => {
    invokeSynchronousAuthCallback(authority.assertCurrentAuthoritySync, { component: 'messaging', invariant: 'live-authority', message: 'Messaging authority must be synchronous.' });
    const current = authority.access.requireUser();
    if (current.userId !== original.userId || current.credentialKind === 'api-key' || current.sessionKind === 'native' && (!current.scope?.includes('messaging:read') || write && !current.scope.includes('messaging:write'))) messagingFail('MESSAGING_FORBIDDEN', 403);
    authority.access.requireAuthorizationScope();
    let staff = false;
    if (config.support && (current.sessionKind !== 'native' || current.scope?.includes('messaging:support'))) {
      try { authority.access.authorize(config.support.staff); staff = true; } catch (error) { if (!(error instanceof AuthError) || error.status >= 500) throw error; }
    }
    return { scopeId, id: messagingId(current.userId), kind: 'user', staff };
  };
}
