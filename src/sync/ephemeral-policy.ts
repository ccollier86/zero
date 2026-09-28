import type { JsonValue, SyncAuthContext } from './types';

export type EphemeralTopicOperation = 'subscribe' | 'set' | 'delete';
export type EphemeralWireOperation = EphemeralTopicOperation | 'unsubscribe';

/** Stable machine-readable errors returned over the ephemeral wire channel. */
export type EphemeralErrorCode =
  | 'EPHEMERAL_UNAUTHENTICATED'
  | 'EPHEMERAL_FORBIDDEN'
  | 'EPHEMERAL_TOPIC_UNCLASSIFIED'
  | 'EPHEMERAL_POLICY_UNAVAILABLE'
  | 'EPHEMERAL_POLICY_INVALID'
  | 'EPHEMERAL_INVALID_TOPIC'
  | 'EPHEMERAL_INVALID_KEY'
  | 'EPHEMERAL_INVALID_TTL'
  | 'EPHEMERAL_VALUE_TOO_LARGE'
  | 'EPHEMERAL_TOO_MANY_TOPICS'
  | 'EPHEMERAL_CAPACITY_EXCEEDED'
  | 'EPHEMERAL_KEY_NOT_OWNED';

/** Input presented to the app/framework topic policy for every protected operation. */
export interface EphemeralTopicPolicyContext {
  operation: EphemeralTopicOperation;
  /** Client-facing topic hint. It is never used directly as the internal namespace. */
  topic: string;
  key?: string;
  value?: JsonValue;
  ttl?: number;
  authContext: SyncAuthContext | null;
  connectionId: string;
}

export type EphemeralKeyOwnership = 'actor' | 'unrestricted';

/**
 * An allowed decision must derive a server-owned internal namespace.
 * `actor` ownership prevents one authenticated principal from replacing or
 * deleting a key first written by another principal.
 */
export interface EphemeralTopicAllowedDecision {
  ok: true;
  namespace: string;
  keyOwnership?: EphemeralKeyOwnership;
}

export interface EphemeralTopicDeniedDecision {
  ok: false;
  code: EphemeralErrorCode;
  reason: string;
}

export type EphemeralTopicDecision =
  | EphemeralTopicAllowedDecision
  | EphemeralTopicDeniedDecision;

/** Async policy boundary shared by built-in and app-owned collaboration topics. */
export interface EphemeralTopicPolicy {
  authorize(context: EphemeralTopicPolicyContext): Promise<EphemeralTopicDecision>;
}

/** Server-to-client failure for an ephemeral operation. */
export interface EphemeralErrorMessage {
  type: 'ephemeral.error';
  operation: EphemeralWireOperation;
  code: EphemeralErrorCode;
  message: string;
  topic?: string;
  key?: string;
  /** The server removed a formerly valid subscription; clients must purge it. */
  revoked?: boolean;
}

/** Historical public behavior for a standalone sync plugin without auth. */
export const allowLegacyEphemeralTopicPolicy: EphemeralTopicPolicy = {
  async authorize(context) {
    return {
      ok: true,
      namespace: `legacy:${context.topic}`,
      keyOwnership: 'unrestricted',
    };
  },
};

/** Fail-closed default when an authenticated sync plugin has no topic policy. */
export const denyEphemeralTopicPolicy: EphemeralTopicPolicy = {
  async authorize(context) {
    return context.authContext
      ? {
          ok: false,
          code: 'EPHEMERAL_TOPIC_UNCLASSIFIED',
          reason: 'Ephemeral topic is not classified by server policy',
        }
      : {
          ok: false,
          code: 'EPHEMERAL_UNAUTHENTICATED',
          reason: 'Authentication is required for ephemeral topics',
        };
  },
};
