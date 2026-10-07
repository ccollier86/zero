/** Avatar options normalize independently from storage installation and presentation. */
import type { AuthUserAvatarConfig, ResolvedAuthUserAvatarConfig } from './auth-user-avatar-types';
import { assertOnlyKeys, assertOptionalBoolean, assertPlainRecord } from './auth-config-validation';

export function normalizeAuthUserAvatar(input: boolean | AuthUserAvatarConfig = false): ResolvedAuthUserAvatarConfig {
  const config = typeof input === 'boolean' ? { enabled: input } : input;
  assertPlainRecord(config, 'User avatar config');
  assertOnlyKeys(config, ['enabled', 'editable', 'shape', 'size', 'fallback', 'maxUploadBytes', 'maxPixels', 'outputSize'], 'User avatar config');
  assertOptionalBoolean(config.enabled, 'User avatar enabled');
  assertOptionalBoolean(config.editable, 'User avatar editable');
  const shape = config.shape ?? 'circle', size = config.size ?? 'default', fallback = config.fallback ?? 'initials';
  if (!['circle', 'rounded', 'square'].includes(shape) || !['sm', 'default', 'lg'].includes(size)
    || !['initials', 'username', 'email', 'none'].includes(fallback)) throw new Error('[auth] User avatar presentation is invalid.');
  return Object.freeze({ enabled: config.enabled ?? false, editable: config.editable ?? true, shape, size, fallback,
    maxUploadBytes: bounded(config.maxUploadBytes, 8 * 1024 * 1024, 1024, 20 * 1024 * 1024, 'maxUploadBytes'),
    maxPixels: bounded(config.maxPixels, 16_000_000, 256, 40_000_000, 'maxPixels'),
    outputSize: bounded(config.outputSize, 512, 64, 1024, 'outputSize') });
}
function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`[auth] User avatar ${label} must be an integer from ${minimum} through ${maximum}.`);
  return result;
}
