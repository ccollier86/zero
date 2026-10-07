/** Closed, disabled-by-default rollout; never infer legacy-account enrollment. */
import { assertOnlyKeys, assertOptionalBoolean, assertPlainRecord } from './auth-config-validation';
import type { AuthUserProfileCompletionConfig, ResolvedAuthUserProfileCompletionConfig } from './auth-user-profile-completion-types';

export function normalizeAuthUserProfileCompletion(input: AuthUserProfileCompletionConfig = {}): ResolvedAuthUserProfileCompletionConfig {
  assertPlainRecord(input, 'Profile completion config');
  assertOnlyKeys(input, ['enabled', 'onSignup', 'onInvitation', 'existingUsers', 'ttl'], 'Profile completion config');
  for (const key of ['enabled', 'onSignup', 'onInvitation'] as const) assertOptionalBoolean(input[key], `Profile completion ${key}`);
  const existing = input.existingUsers ?? 'none';
  if (existing !== 'none' && existing !== 'onSignIn') throw new Error('[auth] Profile completion existingUsers must be none or onSignIn.');
  const ttl = input.ttl ?? '10m';
  const match = typeof ttl === 'string' ? /^(\d{1,4})(s|m)$/.exec(ttl) : null;
  const ttlMs = match ? Number(match[1]) * (match[2] === 's' ? 1000 : 60000) : NaN;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60000 || ttlMs > 1800000) throw new Error('[auth] Profile completion ttl must be between 1m and 30m.');
  return Object.freeze({ enabled: input.enabled ?? false, onSignup: input.onSignup ?? true,
    onInvitation: input.onInvitation ?? true, existingUsers: existing, ttl, ttlMs });
}
