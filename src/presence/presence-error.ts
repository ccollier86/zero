/** Stable presence failures; public errors never contain lease IDs, contact data, or raw storage failures. */
import { AuthError } from '../auth/types';

export type PresenceErrorCode = 'AUTH_PRESENCE_DISABLED' | 'AUTH_PRESENCE_NOT_READY'
  | 'AUTH_PRESENCE_INVALID_INPUT' | 'AUTH_PRESENCE_REVISION_CONFLICT'
  | 'AUTH_PRESENCE_OWNER_LOST' | 'AUTH_PRESENCE_CAPACITY_EXCEEDED'
  | 'AUTH_PRESENCE_PROJECTION_INVALID';

/** Construct a bounded machine-readable auth-domain failure. */
export function presenceError(code: PresenceErrorCode): AuthError {
  const messages: Record<PresenceErrorCode, string> = {
    AUTH_PRESENCE_DISABLED: 'Presence is disabled',
    AUTH_PRESENCE_NOT_READY: 'Presence is not ready',
    AUTH_PRESENCE_INVALID_INPUT: 'Presence input is invalid',
    AUTH_PRESENCE_REVISION_CONFLICT: 'Your presence preference changed; review the current value before saving',
    AUTH_PRESENCE_OWNER_LOST: 'Presence owner is no longer current',
    AUTH_PRESENCE_CAPACITY_EXCEEDED: 'Presence connection capacity is exhausted',
    AUTH_PRESENCE_PROJECTION_INVALID: 'Presence projection is incompatible',
  };
  return new AuthError(messages[code], code, code === 'AUTH_PRESENCE_REVISION_CONFLICT' ? 409
    : code === 'AUTH_PRESENCE_INVALID_INPUT' ? 422 : code === 'AUTH_PRESENCE_DISABLED' ? 404 : 503);
}
