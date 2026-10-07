/** Strict presence policy normalization; no frontend runtime, clocks, storage, or service startup. */
import { assertOnlyKeys, assertOptionalBoolean, assertPlainRecord } from './auth-config-validation';
import {
  AUTH_PRESENCE_BUILTIN_KEYS, AUTH_PRESENCE_ICON_KEYS, AUTH_PRESENCE_TONES,
  type AuthPresenceConfig, type AuthPresenceCustomStatus, type ResolvedAuthPresenceConfig,
} from './auth-presence-types';

const TIMING = {
  idleAfterMs: [300_000, 1_000, 86_400_000],
  awayAfterMs: [900_000, 1_000, 604_800_000],
  heartbeatIntervalMs: [10_000, 1_000, 60_000],
  leaseDurationMs: [30_000, 3_000, 300_000],
  ownerCheckpointIntervalMs: [10_000, 1_000, 60_000],
  ownerLeaseDurationMs: [45_000, 3_000, 300_000],
} as const;

/** Disabled by default; timings remain deterministic and valid even when disabled. */
export function normalizeAuthPresence(config: AuthPresenceConfig = {}): ResolvedAuthPresenceConfig {
  assertPlainRecord(config, 'Presence config');
  assertOnlyKeys(config, ['enabled', ...Object.keys(TIMING), 'onCallEnabled', 'customStatuses'], 'Presence config');
  assertOptionalBoolean(config.enabled, 'Presence enabled');
  assertOptionalBoolean(config.onCallEnabled, 'Presence onCallEnabled');
  const timing = {} as Record<keyof typeof TIMING, number>;
  for (const key of Object.keys(TIMING) as (keyof typeof TIMING)[]) {
    const [fallback, minimum, maximum] = TIMING[key], value = config[key] === undefined ? fallback : config[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`[auth] Presence ${key} must be an integer between ${minimum} and ${maximum}.`);
    }
    timing[key] = value;
  }
  if (timing.awayAfterMs < timing.idleAfterMs) {
    throw new Error('[auth] Presence awayAfterMs must not be less than idleAfterMs.');
  }
  if (timing.leaseDurationMs < timing.heartbeatIntervalMs * 3) {
    throw new Error('[auth] Presence leaseDurationMs must allow at least three heartbeat intervals.');
  }
  if (timing.ownerLeaseDurationMs < timing.ownerCheckpointIntervalMs * 3) {
    throw new Error('[auth] Presence ownerLeaseDurationMs must allow at least three checkpoint intervals.');
  }
  return Object.freeze({ enabled: config.enabled ?? false, ...timing,
    onCallEnabled: config.onCallEnabled ?? false,
    customStatuses: normalizeCustomStatuses(config.customStatuses === undefined ? [] : config.customStatuses),
  });
}

function normalizeCustomStatuses(input: readonly AuthPresenceCustomStatus[]): readonly AuthPresenceCustomStatus[] {
  if (!Array.isArray(input) || input.length > 16) {
    throw new Error('[auth] Presence customStatuses must be an array of at most 16 statuses.');
  }
  const keys = new Set<string>(AUTH_PRESENCE_BUILTIN_KEYS);
  return Object.freeze(input.map(value => {
    assertPlainRecord(value, 'Presence custom status');
    assertOnlyKeys(value, ['key', 'label', 'tone', 'icon'], 'Presence custom status');
    if (typeof value.key !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(value.key) || keys.has(value.key)) {
      throw new Error('[auth] Presence custom status keys must be unique non-reserved lowercase identifiers.');
    }
    keys.add(value.key);
    if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80) {
      throw new Error('[auth] Presence custom status labels must be nonempty strings of at most 80 characters.');
    }
    if (typeof value.tone !== 'string' || !(AUTH_PRESENCE_TONES as readonly string[]).includes(value.tone)) {
      throw new Error('[auth] Presence custom status tone must be a supported semantic tone.');
    }
    if (value.icon !== undefined && (typeof value.icon !== 'string'
      || !(AUTH_PRESENCE_ICON_KEYS as readonly string[]).includes(value.icon))) {
      throw new Error('[auth] Presence custom status icon must be a supported Zero status icon.');
    }
    return Object.freeze({ key: value.key, label: value.label.trim(), tone: value.tone,
      ...(value.icon === undefined ? {} : { icon: value.icon }) });
  }));
}
