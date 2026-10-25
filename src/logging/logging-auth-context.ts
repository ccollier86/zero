/** Attribution from verified Guardian context. Never accepts a browser actor or request URL. */
import type { AuthContext } from '../auth/types';
import type { LoggingContext } from './logging-contracts';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';

export function loggingAuthContext(auth: AuthContext, policyVersion: string): LoggingContext {
  if (!auth.userId || auth.sessionScopeKind === 'tenant' && !auth.tenantId) throw new LoggingError('LOGGING_FORBIDDEN', 'A committed logging scope is required.');
  const scope = auth.sessionScopeKind === 'tenant' || auth.tenantId
    ? { kind: 'tenant' as const, tenantId: auth.tenantId! }
    : { kind: 'application' as const, tenantId: null };
  return Object.freeze({ sourceId: 'request:' + loggingDigest([auth.userId, scope.kind, scope.tenantId]), origin: 'backend', scope,
    actor: Object.freeze({ kind: auth.credentialKind === 'api-key' ? 'service' : 'user',
      id: auth.credentialKind === 'api-key' ? auth.credentialId ?? auth.userId : auth.userId,
      sessionId: auth.sessionId ?? null, initiatorId: auth.credentialKind === 'api-key' ? auth.userId : null }),
    requestId: null, correlationId: null, policyVersion });
}
