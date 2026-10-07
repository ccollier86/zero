/** Presence observations are admitted data, never authentication proof. */
import type { AuthPresenceCapabilities, AuthPresenceIntent, AuthPresenceObservation } from '../../auth/auth-presence-types';
import { AUTH_PRESENCE_TONES, AUTH_PRESENCE_ICON_KEYS } from '../../auth/auth-presence-types';
export interface GuardianPresenceOwnSnapshot {
  capabilities: AuthPresenceCapabilities;
  intent: AuthPresenceIntent;
  observation: AuthPresenceObservation | null;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
export function isAuthPresenceCapabilities(value: unknown): value is AuthPresenceCapabilities {
  if (!record(value) || typeof value.enabled !== 'boolean' || typeof value.state !== 'string' || !['ready', 'pending', 'disabled'].includes(value.state)
    || typeof value.canReportActivity !== 'boolean' || typeof value.canSetIntent !== 'boolean'
    || value.topology !== 'single-owner' || !integer(value.heartbeatIntervalMs, 1) || !integer(value.idleAfterMs, 1)
    || !integer(value.awayAfterMs, 1) || value.awayAfterMs < value.idleAfterMs
    || !integer(value.serverTime) || !integer(value.ownerLeaseDurationMs, 1) || !Array.isArray(value.statuses)
    || value.statuses.length > 22 || new Set(value.statuses.map(status => record(status) ? status.key : undefined)).size !== value.statuses.length) return false;
  return value.statuses.every(status => record(status) && typeof status.key === 'string'
    && /^[a-z][a-z0-9-]{0,47}$/.test(status.key) && typeof status.label === 'string' && status.label.length > 0 && status.label.length <= 80
    && typeof status.selectable === 'boolean' && AUTH_PRESENCE_TONES.includes(status.tone as never)
    && (status.icon === undefined || AUTH_PRESENCE_ICON_KEYS.includes(status.icon as never)));
}
export function isAuthPresenceObservation(value: unknown): value is AuthPresenceObservation {
  return record(value) && typeof value.userId === 'string' && typeof value.status === 'string'
    && typeof value.connected === 'boolean' && typeof value.stale === 'boolean'
    && integer(value.revision) && integer(value.ownerEpoch) && integer(value.updatedAt) && integer(value.freshUntil);
}
export function isGuardianPresenceOwnSnapshot(value: unknown): value is GuardianPresenceOwnSnapshot {
  if (!record(value) || !isAuthPresenceCapabilities(value.capabilities) || !record(value.intent)) return false;
  const statusKey = value.intent.status;
  return typeof statusKey === 'string' && value.capabilities.statuses.some(status => status.key === statusKey)
    && integer(value.intent.revision)
    && (value.intent.expiresAt === null || integer(value.intent.expiresAt))
    && (value.observation === null || isAuthPresenceObservation(value.observation));
}
