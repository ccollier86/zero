import type {
  EphemeralTopicDecision,
  EphemeralTopicPolicy,
  EphemeralTopicPolicyContext,
} from './ephemeral-policy';
import {
  serviceDataScopeFromIdentity,
  serviceDataScopeKey,
  type ServiceDataScope,
} from '../auth/service-data-scope';

const PRESENCE_PREFIX = 'presence:';
const TYPING_PREFIX = 'typing:';
const USER_PREFIX = 'user:';

/** Narrow structural seam implemented by the app-local RoomService. */
export interface EphemeralRoomMembershipService {
  isMember(roomId: string, userId: string, scope?: ServiceDataScope): boolean;
}

export interface ManagedEphemeralTopicPolicyOptions {
  /** Reserved durable conversations must prove membership in their canonical Fabric file. */
  authorizeMessaging?: (context: EphemeralTopicPolicyContext, scope: ServiceDataScope) => Promise<EphemeralTopicDecision>;
  getRoomService: () => EphemeralRoomMembershipService | null;
  /** Explicit policy for non-reserved application collaboration topics. */
  customPolicy?: EphemeralTopicPolicy;
  /** Multi mode requires a complete tenant-bound Sync identity. */
  tenancyMode?: 'single' | 'multi';
}

/**
 * Build Zero's managed auth-enabled topic policy.
 *
 * Reserved room and personal namespaces cannot be weakened by the app policy;
 * custom policy runs only for otherwise unclassified topic names.
 */
export function createManagedEphemeralTopicPolicy(
  options: ManagedEphemeralTopicPolicyOptions,
): EphemeralTopicPolicy {
  return {
    async authorize(context) {
      const auth = context.authContext;
      if (!auth) {
        return deny(
          'EPHEMERAL_UNAUTHENTICATED',
          'Authentication is required for managed ephemeral topics',
        );
      }
      const scope = serviceDataScopeFromIdentity(
        auth,
        options.tenancyMode ?? 'single',
      );
      if (!scope) {
        return deny(
          'EPHEMERAL_FORBIDDEN',
          'The authenticated session has no valid authorization scope',
        );
      }
      // Managed activity is write-only through the separately admitted Sync
      // adapter. No custom policy can expose its private connection leases.
      if (context.topic === 'guardian:presence' || context.topic.startsWith('_guardian-presence:')) {
        return deny('EPHEMERAL_FORBIDDEN', 'Managed presence reports require the presence service');
      }

      if (context.topic.startsWith(PRESENCE_PREFIX)) {
        return authorizeRoomTopic('presence', PRESENCE_PREFIX, context, options, scope);
      }
      if (context.topic.startsWith('typing:messaging:')) {
        if (!options.authorizeMessaging) return deny('EPHEMERAL_POLICY_UNAVAILABLE', 'Managed messaging is unavailable');
        return options.authorizeMessaging(context, scope);
      }
      if (context.topic.startsWith(TYPING_PREFIX)) {
        return authorizeRoomTopic('typing', TYPING_PREFIX, context, options, scope);
      }
      if (context.topic.startsWith(USER_PREFIX)) {
        return authorizePersonalTopic(context, scope);
      }

      if (options.customPolicy) {
        const decision = await options.customPolicy.authorize(context);
        // App-owned logical namespaces are framework-scoped so a custom
        // policy cannot accidentally collide with reserved room/user state.
        return decision.ok && typeof decision.namespace === 'string'
          ? {
              ...decision,
              namespace: `${serviceDataScopeKey(scope)}:app:${decision.namespace}`,
            }
          : decision;
      }
      return deny(
        'EPHEMERAL_TOPIC_UNCLASSIFIED',
        'Ephemeral topic is not classified by server policy',
      );
    },
  };
}

function authorizeRoomTopic(
  kind: 'presence' | 'typing',
  prefix: string,
  context: EphemeralTopicPolicyContext,
  options: ManagedEphemeralTopicPolicyOptions,
  scope: ServiceDataScope,
): EphemeralTopicDecision {
  const auth = context.authContext!;
  const roomId = context.topic.slice(prefix.length);
  if (!roomId || roomId.includes(':')) {
    return deny('EPHEMERAL_FORBIDDEN', 'Room topic is not available');
  }

  const rooms = options.getRoomService();
  if (!rooms) {
    return deny(
      'EPHEMERAL_POLICY_UNAVAILABLE',
      'Room membership service is unavailable',
    );
  }
  if (!rooms.isMember(roomId, auth.userId, scope)) {
    return deny('EPHEMERAL_FORBIDDEN', 'Room topic is not available');
  }

  const actorKey = `user:${auth.userId}`;
  const sessionKey = kind === 'typing' && context.key?.startsWith(actorKey + ':session:')
    && /^[A-Za-z0-9_-]{8,80}$/.test(context.key.slice((actorKey + ':session:').length));
  if (context.operation !== 'subscribe' && context.key !== actorKey && !sessionKey) {
    return deny(
      'EPHEMERAL_KEY_NOT_OWNED',
      'Room presence and typing keys are derived from the authenticated user',
    );
  }

  if (sessionKey && context.operation === 'set') {
    if (!Number.isSafeInteger(context.ttl) || context.ttl! < 1000 || context.ttl! > 15000) return deny('EPHEMERAL_INVALID_TTL', 'Typing sessions require a 1000–15000ms expiry');
    const value = context.value;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.userId !== auth.userId) return deny('EPHEMERAL_FORBIDDEN', 'Typing identity must match the authenticated actor');
  }

  return {
    ok: true,
    namespace: `${serviceDataScopeKey(scope)}:room:${roomId}:${kind}`,
    keyOwnership: 'actor',
  };
}

function authorizePersonalTopic(
  context: EphemeralTopicPolicyContext,
  scope: ServiceDataScope,
): EphemeralTopicDecision {
  const auth = context.authContext!;
  const expectedPrefix = `${USER_PREFIX}${auth.userId}:`;
  if (!context.topic.startsWith(expectedPrefix)) {
    return deny('EPHEMERAL_FORBIDDEN', 'Personal topic belongs to another user');
  }
  const suffix = context.topic.slice(expectedPrefix.length);
  if (!suffix || suffix.includes('..')) {
    return deny('EPHEMERAL_FORBIDDEN', 'Personal topic is not available');
  }
  return {
    ok: true,
    namespace: `${serviceDataScopeKey(scope)}:user:${auth.userId}:${suffix}`,
    keyOwnership: 'actor',
  };
}

function deny(
  code: Extract<EphemeralTopicDecision, { ok: false }>['code'],
  reason: string,
): EphemeralTopicDecision {
  return { ok: false, code, reason };
}
