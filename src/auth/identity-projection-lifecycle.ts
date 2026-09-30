import type { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import type {
  IdentityProjectionLifecycleHook,
  IdentityProjectionTargetScope,
  MembershipIdentityAnchor,
} from './identity-projection-types';
import { requireIdentityProjectionId } from './identity-projection-validation';

export interface IdentityProjectionLifecycleRoute {
  readonly targetId: string;
  readonly scope: IdentityProjectionTargetScope;
}

export interface IdentityProjectionLifecycleRoutes {
  targetsForUser(userId: string): Iterable<string | IdentityProjectionLifecycleRoute>;
  targetsForMembership(
    anchor: MembershipIdentityAnchor,
  ): Iterable<string | IdentityProjectionLifecycleRoute>;
}

/**
 * Build synchronous Guardian lifecycle hooks over declarative target routing.
 * Enqueues join the caller's outer ReactiveDB transaction when stores share the
 * system database; no target I/O occurs while Guardian holds a SQLite lock.
 */
export function createIdentityProjectionLifecycleHook(
  outbox: IdentityProjectionOutboxStore,
  routes: IdentityProjectionLifecycleRoutes,
): IdentityProjectionLifecycleHook {
  return Object.freeze({
    userCreated(userId: string) {
      for (const route of uniqueRoutes(routes.targetsForUser(userId))) {
        if (route.scope) outbox.registerTarget(route.targetId, route.scope);
        outbox.enqueue(route.targetId, { kind: 'user', userId });
      }
    },
    membershipCreated(input: {
      membershipId: string;
      tenantId: string;
      userId: string;
    }) {
      const anchor: MembershipIdentityAnchor = Object.freeze({
        kind: 'membership',
        membershipId: input.membershipId,
        tenantId: input.tenantId,
        userId: input.userId,
      });
      for (const route of uniqueRoutes(routes.targetsForMembership(anchor))) {
        if (route.scope) outbox.registerTarget(route.targetId, route.scope);
        // The user delivery always precedes its dependent membership delivery.
        outbox.enqueue(route.targetId, { kind: 'user', userId: input.userId });
        outbox.enqueue(route.targetId, anchor);
      }
    },
  });
}

function uniqueRoutes(
  values: Iterable<string | IdentityProjectionLifecycleRoute>,
): Array<{ targetId: string; scope: IdentityProjectionTargetScope | null }> {
  if (!values || typeof values === 'string'
    || typeof values[Symbol.iterator] !== 'function') {
    throw new TypeError('Identity projection routes must return an iterable');
  }
  const routes = new Map<string, IdentityProjectionTargetScope | null>();
  let yielded = 0;
  for (const value of values) {
    yielded += 1;
    if (yielded > 2_048) {
      throw new RangeError('Identity projection lifecycle fan-out exceeds 2048 targets');
    }
    const targetIdInput = typeof value === 'string' ? value : value?.targetId;
    const scope = typeof value === 'string' ? null : value?.scope;
    if (typeof targetIdInput !== 'string'
      || (scope !== null
        && scope !== 'application'
        && scope !== 'tenant'
        && scope !== 'named')) {
      throw new TypeError('Identity projection route is invalid');
    }
    let targetId: string;
    try {
      targetId = requireIdentityProjectionId(targetIdInput, 'targetId');
    } catch {
      throw new TypeError('Identity projection route is invalid');
    }
    const previous = routes.get(targetId);
    if (previous && scope && previous !== scope) {
      throw new TypeError('Identity projection target has conflicting scopes');
    }
    routes.set(targetId, previous ?? scope);
  }
  return [...routes].map(([targetId, scope]) => ({ targetId, scope }));
}
