/** Shared live Guardian actor projection for durable APIs and reserved ephemeral typing. No actor/scope is read from payload. */
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingAuthority } from './service';
import type { MessagingActor } from './realm-model';
import { messagingFail, messagingId } from './validation';
import { AuthError } from '../auth/types';
export function createMessagingActorResolver(authority: MessagingAuthority, config: ResolvedMessagingConfig): (write?: boolean) => MessagingActor {
  const original = authority.access.requireUser(), scopeId = serviceDataScopeKey(authority.scope);
  return (write = false) => {
    invokeSynchronousAuthCallback(authority.assertCurrentAuthoritySync, { component: 'messaging', invariant: 'live-authority', message: 'Messaging authority must be synchronous.' });
    const access = authority.access, current = access.requireUser();
    if (current.userId !== original.userId || current.credentialKind === 'api-key' || current.sessionKind === 'native' && (!current.scope?.includes('messaging:read') || write && !current.scope.includes('messaging:write'))) messagingFail('MESSAGING_FORBIDDEN', 403);
    access.requireAuthorizationScope();
    let staff = false;
    if (config.support && (current.sessionKind !== 'native' || current.scope?.includes('messaging:support'))) {
      try { access.authorize(config.support.staff); staff = true; } catch (error) { if (!(error instanceof AuthError) || error.status >= 500) throw error; }
    }
    const assistantPolicies: Record<string, string> = Object.create(null);
    for (const assistant of Object.values(config.assistants ?? {})) {
      try { if (assistant.access !== undefined) access.authorize(assistant.access); assistantPolicies[assistant.id] = assistant.policyHash; }
      catch (error) { if (!(error instanceof AuthError) || ![401, 403, 404].includes(error.status)) throw error; }
    }
    const groupPolicies: Record<string, string> = Object.create(null);
    for (const group of Object.values(config.groups ?? {})) {
      try { if (group.members !== undefined) access.authorize(group.members); groupPolicies[group.id] = group.policyHash; }
      catch (error) { if (!(error instanceof AuthError) || ![401, 403, 404].includes(error.status)) throw error; }
    }
    return { scopeId, id: messagingId(current.userId), kind: 'user', staff, assistantPolicies, groupPolicies };
  };
}
