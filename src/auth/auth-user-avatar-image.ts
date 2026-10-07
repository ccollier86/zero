/** Bounded raster decoding/normalization; no filesystem paths, SVG, URLs or browser assertions. */
import type { ResolvedAuthUserAvatarConfig } from './auth-user-avatar-types';
import { AuthError } from './types';

export interface NormalizedUserAvatarImage { bytes: Uint8Array; width: number; height: number; mimeType: 'image/webp' }
export async function normalizeUserAvatarImage(input: Uint8Array, policy: ResolvedAuthUserAvatarConfig): Promise<NormalizedUserAvatarImage> {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > policy.maxUploadBytes) throw invalidImage();
  // Detach caller-owned/shared bytes before any asynchronous native decode.
  const bytes = Uint8Array.from(input);
  // The optional decoder is not evaluated for ordinary auth/disabled avatars.
  // Normal Zero builds still package its real host-native addon and libvips.
  let sharp: typeof import('sharp')['default'];
  try { sharp = (await import('sharp')).default; }
  catch { throw new AuthError('Avatar image processing is unavailable. Verify the deployment native payload and restart the application.', 'AUTH_AVATAR_NOT_READY', 503); }
  try {
    const options = { limitInputPixels: policy.maxPixels, failOn: 'warning' as const, animated: false };
    const metadata = await sharp(bytes, options).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
      || metadata.width * metadata.height > policy.maxPixels || (metadata.pages ?? 1) !== 1) throw invalidImage();
    const { data, info } = await sharp(bytes, options).timeout({ seconds: 5 }).rotate()
      .resize(policy.outputSize, policy.outputSize, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (info.width !== policy.outputSize || info.height !== policy.outputSize || data.byteLength > policy.maxUploadBytes) throw invalidImage();
    return { bytes: Uint8Array.from(data), width: info.width, height: info.height, mimeType: 'image/webp' };
  } catch (cause) {
    if (cause instanceof AuthError) throw cause;
    // Native decoder messages may contain image metadata; never return/log them.
    throw invalidImage();
  }
}
function invalidImage(): AuthError {
  return new AuthError('Choose a valid JPEG, PNG or WebP image within the configured size limits.', 'AUTH_AVATAR_IMAGE_INVALID', 422);
}
