/** Internal live request admission. No actor, tenant, principal or capability comes from command input. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { authContextAuthorityFingerprint } from '../auth/auth-context-authority';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { AccessRequirement } from '../auth/authorization-kernel';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarActor } from './contracts';
import { CalendarError } from './error';
import { calendarHash, calendarKey } from './validation';

export interface CalendarAuthority {
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
  /** Canonically rehydrate/fence the captured Guardian authority, including policy properties. */
  assertCurrentAuthoritySync(): void;
  assertCurrentAuthority(): Promise<void>;
  readonly signal?: AbortSignal;
}

export interface CalendarRequestAuthority {
  readonly actor: CalendarActor;
  readonly scope: ServiceDataScope;
  readonly signal: AbortSignal;
  /** Synchronous final read/commit/publication fence, never an asynchronous policy callback. */
  guard(): void;
  /** Revalidate after every wait before returning private data or starting another operation. */
  confirm(): Promise<void>;
}

type CalendarPolicy = Pick<ResolvedCalendarConfig, 'createOwn' | 'manage'>;
const SESSION_ACCESS = Object.freeze({ user: 'required' as const, credentials: Object.freeze(['session'] as const) });

/** This is an actor-only browser boundary, not a source/service credential or a mounted runtime. */
export async function admitCalendarRequest(request: CalendarAuthority, config: CalendarPolicy,
  closing: AbortSignal, supplied?: AbortSignal): Promise<CalendarRequestAuthority> {
  if (!(closing instanceof AbortSignal) || supplied !== undefined && !(supplied instanceof AbortSignal)
    || request.signal !== undefined && !(request.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const signal = AbortSignal.any([closing, ...[request.signal, supplied].filter((item): item is AbortSignal => item !== undefined)]);
  const scope = request.scope, scopeId = serviceDataScopeKey(scope);
  // Resolved config is detached/frozen by configuration admission. Capture its policies, not a mutable caller bag.
  const createOwnPolicy = config.createOwn, managePolicy = config.manage;
  const project = () => {
    signal.throwIfAborted();
    invokeSynchronousAuthCallback(() => request.assertCurrentAuthoritySync(), {
      component: 'calendar', invariant: 'current-authority-is-synchronous',
      message: 'Calendar authority checks must not yield.',
    });
    const access = request.access;
    // Re-conceal an API key even if another policy previously admitted it on this same facade.
    access.authorize(SESSION_ACCESS);
    const context = access.requireUser();
    if ((context.credentialKind ?? 'session') !== 'session'
      || context.sessionKind !== undefined && context.sessionKind !== 'web') throw new CalendarError('CALENDAR_FORBIDDEN');
    const authorization = access.requireAuthorizationScope();
    if (serviceDataScopeKey(request.scope) !== scopeId || authorization.scopeKind !== scope.scopeKind
      || authorization.scopeId !== scope.scopeId || scope.scopeKind === 'application' && (
        scope.scopeId !== 'application' || scope.tenantId !== null || context.sessionScopeKind === 'tenant'
        || context.tenantId !== undefined || context.membershipId !== undefined
      ) || scope.scopeKind === 'tenant' && (
        scope.scopeId !== scope.tenantId || access.requireTenant().tenantId !== scope.tenantId
      )) throw new CalendarError('CALENDAR_FORBIDDEN');
    return {
      identity: authContextAuthorityFingerprint(context), revision: authorization.revision,
      actor: Object.freeze({ scopeId, userId: calendarKey(context.userId),
        // Stable receipt namespace across browser renewal; mutable grants never choose its identity.
        principal: calendarHash([context.userId, context.credentialKind ?? 'session', context.credentialId ?? null,
          context.sessionKind ?? 'web', context.clientId ?? null]),
        manageAll: allows(access, managePolicy), createOwn: allows(access, createOwnPolicy),
      }),
    };
  };
  // Capture before the first await: a replaced account/session/scope must not retarget an in-flight request.
  const captured = project();
  const guard = () => {
    const current = project();
    if (current.identity !== captured.identity || current.revision !== captured.revision
      || current.actor.manageAll !== captured.actor.manageAll || current.actor.createOwn !== captured.actor.createOwn) {
      throw new CalendarError('CALENDAR_FORBIDDEN');
    }
  };
  await request.assertCurrentAuthority();
  guard();
  return Object.freeze({ actor: captured.actor, scope, signal, guard,
    async confirm() { guard(); await request.assertCurrentAuthority(); guard(); },
  });
}

function allows(access: RequestAuthorizationAccess, requirement: AccessRequirement): boolean {
  // Guardian's false scalar means public access; calendar false is an explicit deny sentinel.
  if (requirement === false) return false;
  try { access.authorize(requirement); return true; }
  catch (error) {
    if (!(error instanceof AuthError) || ![401, 403].includes(error.status)) throw error;
    return false;
  }
}
