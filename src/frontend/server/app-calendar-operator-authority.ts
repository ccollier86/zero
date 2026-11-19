/** Private managed request fences. No request owner or implicit audit grant is manufactured here. */
import { readAuthAuthorityProperties } from '../../auth/auth-authority-properties';
import { invokeSynchronousAuthCallback } from '../../auth/auth-synchronous-callback';
import { serviceDataScopeKey } from '../../auth/service-data-scope';
import type { CalendarAuthority, CalendarRequestAuthority } from '../../calendar/authority';
import { CalendarError } from '../../calendar/error';
import type { CalendarIntegrationOperatorRequestReceipt } from '../../calendar/integration-operator-request-model';
import { runWithLoggingAttribution } from '../../logging/logging-attribution';
import { loggingAuthContext } from '../../logging/logging-auth-context';
import type { LoggingRuntime } from '../../logging/logging-runtime';
import { ZERO_AUTH_STORE, ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';

/** The captured Logging owner must be the exact source binding's owner, including when disabled. */
export function createManagedCalendarOperatorAuthority(runtime: ZeroAppRuntime, request: CalendarAuthority,
  loggingSnapshot: LoggingRuntime | null): CalendarAuthority {
  const assertGuardianSync = request.assertCurrentAuthoritySync.bind(request);
  const assertGuardian = request.assertCurrentAuthority.bind(request);
  const assertDelivery = () => {
    if ((runtime.get(ZERO_LOGGING_RUNTIME) ?? null) !== loggingSnapshot) throw new CalendarError('CALENDAR_NOT_READY');
    if (!loggingSnapshot) return;
    const auth = request.access.requireUser();
    loggingSnapshot.admission.assertCurrent({ auth,
      properties: readAuthAuthorityProperties(runtime.get(ZERO_AUTH_STORE), auth.userId) });
  };
  return Object.freeze({
    get access() { return request.access; },
    get scope() { return request.scope; },
    get signal() { return request.signal; },
    assertCurrentAuthoritySync() {
      invokeSynchronousAuthCallback(assertGuardianSync, { component: 'calendar',
        invariant: 'managed-operator-authority-is-synchronous', message: 'Calendar operator authority checks must not yield.' });
      assertDelivery();
    },
    async assertCurrentAuthority() { await assertGuardian(); assertDelivery(); },
  });
}

/** Enter human attribution for the source-local acceptance only, never subsequent control/recovery work. */
export async function runManagedCalendarOperatorAcceptance(loggingSnapshot: LoggingRuntime | null,
  request: CalendarAuthority, authority: CalendarRequestAuthority,
  operation: () => Promise<CalendarIntegrationOperatorRequestReceipt>): Promise<CalendarIntegrationOperatorRequestReceipt> {
  authority.guard();
  if (!loggingSnapshot) return operation();
  const auth = request.access.requireUser(), attribution = loggingAuthContext(auth, loggingSnapshot.config.policyVersion);
  const scope = authority.scope, scopeId = serviceDataScopeKey(scope);
  if (auth.userId !== authority.actor.userId || authority.actor.scopeId !== scopeId
    || serviceDataScopeKey(request.scope) !== scopeId || attribution.actor.kind !== 'user'
    || attribution.actor.id !== authority.actor.userId || attribution.scope.kind !== scope.scopeKind
    || attribution.scope.tenantId !== scope.tenantId) throw new CalendarError('CALENDAR_FORBIDDEN');
  authority.guard();
  return runWithLoggingAttribution(loggingSnapshot, attribution, authority.guard, operation);
}
