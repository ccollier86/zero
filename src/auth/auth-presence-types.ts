/** Guardian presence configuration and public observations; presence never grants authority. */
import type { ZeroAnimatedIconName } from '../components/animate-ui/icons/registry';

export const AUTH_PRESENCE_TONES = ['success', 'warning', 'destructive', 'muted', 'primary'] as const;
export type AuthPresenceTone = typeof AUTH_PRESENCE_TONES[number];
/** Bounded semantic status icons, all supplied by Zero's existing icon registry. */
export const AUTH_PRESENCE_ICON_KEYS = [
  'check', 'circle-check', 'clock', 'moon', 'pause', 'signal', 'radio', 'users',
  'message-circle', 'message-square', 'star', 'bell',
] as const satisfies readonly ZeroAnimatedIconName[];
export type AuthPresenceIcon = typeof AUTH_PRESENCE_ICON_KEYS[number];
export const AUTH_PRESENCE_BUILTIN_KEYS = ['available', 'idle', 'away', 'busy', 'offline', 'on-call'] as const;
export type AuthPresenceBuiltinStatus = typeof AUTH_PRESENCE_BUILTIN_KEYS[number];

/** Custom keys are stable catalog identities, not arbitrary styles or markup. */
export interface AuthPresenceCustomStatus {
  readonly key: string;
  readonly label: string;
  readonly tone: AuthPresenceTone;
  readonly icon?: AuthPresenceIcon;
}
/** Opt-in presence timing and manual-status catalog; distributed owners are not supported. */
export interface AuthPresenceConfig {
  readonly enabled?: boolean;
  readonly idleAfterMs?: number;
  readonly awayAfterMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly ownerCheckpointIntervalMs?: number;
  readonly ownerLeaseDurationMs?: number;
  readonly onCallEnabled?: boolean;
  readonly customStatuses?: readonly AuthPresenceCustomStatus[];
}
/** Detached normalized policy consumed by the app-local presence owner. */
export interface ResolvedAuthPresenceConfig {
  readonly enabled: boolean;
  readonly idleAfterMs: number;
  readonly awayAfterMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly ownerCheckpointIntervalMs: number;
  readonly ownerLeaseDurationMs: number;
  readonly onCallEnabled: boolean;
  readonly customStatuses: readonly AuthPresenceCustomStatus[];
}
/** The server's actual catalog includes derived states and explicit selectable intent. */
export interface AuthPresenceStatusDefinition extends AuthPresenceCustomStatus {
  readonly selectable: boolean;
}
/** User intent is independent from connection expiry and automatic inactivity. */
export interface AuthPresenceIntent {
  readonly status: string;
  readonly expiresAt: number | null;
  readonly revision: number;
}
/** Mutation input carries no user, tenant, trusted clock, device, or owner identity. */
export interface UpdateAuthPresenceIntentInput {
  readonly status: string;
  readonly expectedRevision: number;
  readonly expiresAfterMs?: number | null;
}
/** Freshness is explicit: cached status strings alone are not live presence evidence. */
export interface AuthPresenceObservation {
  readonly userId: string;
  readonly status: string;
  readonly connected: boolean;
  readonly revision: number;
  readonly ownerEpoch: number;
  readonly updatedAt: number;
  readonly freshUntil: number;
  readonly stale: boolean;
}
/** Actual server readiness, not an inference from frontend config. */
export interface AuthPresenceCapabilities {
  readonly enabled: boolean;
  readonly state: 'ready' | 'pending' | 'disabled';
  readonly topology: 'single-owner';
  readonly statuses: readonly AuthPresenceStatusDefinition[];
  readonly heartbeatIntervalMs: number;
  readonly idleAfterMs: number;
  readonly awayAfterMs: number;
  /** Server clock at capability projection; clients estimate subsequent time monotonically. */
  readonly serverTime: number;
  readonly ownerLeaseDurationMs: number;
  readonly canReportActivity: boolean;
  readonly canSetIntent: boolean;
}
