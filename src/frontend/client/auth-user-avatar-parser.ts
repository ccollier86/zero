/** Bounded Guardian avatar metadata admission; delivery is an exact private path, never an arbitrary URL. */
import type { UserAvatarAsset, UserAvatarCapabilities, UserAvatarSnapshot, UserAvatarStage } from '../../auth/auth-user-avatar-types';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value: unknown, prefix: string) => typeof value === 'string' && new RegExp(`^${prefix}_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`).test(value);

/** Admit current server capabilities, including blocked/disabled presentation without inventing edit authority. */
export function isUserAvatarCapabilities(value: unknown): value is UserAvatarCapabilities {
  return record(value) && typeof value.state === 'string' && ['ready', 'blocked', 'disabled'].includes(value.state)
    && typeof value.enabled === 'boolean' && typeof value.editable === 'boolean'
    && (value.state === 'ready' ? value.enabled : value.editable === false)
    && (value.state !== 'disabled' || !value.enabled)
    && typeof value.shape === 'string' && ['circle', 'rounded', 'square'].includes(value.shape)
    && typeof value.size === 'string' && ['sm', 'default', 'lg'].includes(value.size)
    && typeof value.fallback === 'string' && ['initials', 'username', 'email', 'none'].includes(value.fallback)
    && integer(value.maxUploadBytes, 1024, 20 * 1024 * 1024)
    && integer(value.maxPixels, 256, 40_000_000) && integer(value.outputSize, 64, 1024);
}
/** Asset metadata only permits the matching Guardian endpoint; no signed provider URL reaches an image element. */
export function isUserAvatarAsset(value: unknown): value is UserAvatarAsset {
  return record(value) && id(value.id, 'ava') && value.mimeType === 'image/webp'
    && integer(value.width, 1, 1024) && integer(value.height, 1, 1024)
    && value.width === value.height && integer(value.byteLength, 1, 20 * 1024 * 1024)
    && value.deliveryPath === `/auth/profile/avatar/assets/${value.id}`;
}
export function isUserAvatarSnapshot(value: unknown): value is UserAvatarSnapshot {
  return record(value) && boundedString(value.userId, 512) && integer(value.revision, 1, Number.MAX_SAFE_INTEGER - 1)
    && isUserAvatarCapabilities(value.capabilities) && (value.asset === null || isUserAvatarAsset(value.asset));
}
/** A stage binds one immutable private storage grant to the exact avatar receipt and target path. */
export function isUserAvatarStage(value: unknown): value is UserAvatarStage {
  if (!record(value) || !id(value.id, 'avs') || typeof value.receipt !== 'string' || !/^[a-f0-9]{64}$/.test(value.receipt)
    || !integer(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1) || !integer(value.expiresAt, 1, Number.MAX_SAFE_INTEGER)
    || !record(value.upload)) return false;
  const upload = value.upload;
  return boundedString(upload.token, 16_384) && /^[A-Za-z0-9_.-]+$/.test(upload.token)
    && id(upload.grantId, 'sug') && id(upload.driveId, 'drv') && upload.path === `/avatars/stages/${value.id}`
    && integer(upload.expiresIn, 1, 86_400) && integer(upload.expiresAt, 1, Number.MAX_SAFE_INTEGER)
    && integer(upload.maxSize, 1024, 20 * 1024 * 1024) && upload.public === false && upload.overwrite === false
    && upload.flow === 'guardian-avatar' && record(upload.resource) && upload.resource.type === 'guardian-avatar-stage'
    && upload.resource.id === value.id && Array.isArray(upload.contentTypes) && upload.contentTypes.length > 0
    && upload.contentTypes.length <= 3 && new Set(upload.contentTypes).size === upload.contentTypes.length
    && upload.contentTypes.every(type => ['image/jpeg', 'image/png', 'image/webp'].includes(type));
}
export function isUserAvatarDirectoryEntry(value: unknown): value is { userId: string; displayName: string; asset: UserAvatarAsset | null } {
  return record(value) && boundedString(value.userId, 512) && boundedString(value.displayName, 512)
    && (value.asset === null || isUserAvatarAsset(value.asset));
}
