/** Minimal browser raster export for react-easy-crop's pixel box. No masking engine, rotation, URLs or transport policy. */
import type { Area } from 'react-easy-crop';
import type { UserAvatarCapabilities } from '../../auth/auth-user-avatar-types';

/** Export the library's square pixel crop to bounded WebP; Sharp remains authoritative for image admission. */
export async function exportAvatarCrop(image: Blob, area: Area, policy: UserAvatarCapabilities, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || !image.size || image.size > policy.maxUploadBytes
    || ![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0
    || area.width < 1 || area.height < 1 || Math.abs(area.width - area.height) > 1) throw invalidImage();
  const source = URL.createObjectURL(image), element = new Image();
  const abort = () => { element.src = ''; };
  signal.addEventListener('abort', abort, { once: true });
  try {
    element.src = source; await element.decode(); signal.throwIfAborted();
    if (!element.naturalWidth || !element.naturalHeight || element.naturalWidth * element.naturalHeight > policy.maxPixels
      || area.x + area.width > element.naturalWidth + 1 || area.y + area.height > element.naturalHeight + 1) throw invalidImage();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = policy.outputSize;
    const context = canvas.getContext('2d'); if (!context) throw invalidImage();
    context.drawImage(element, area.x, area.y, area.width, area.height, 0, 0, policy.outputSize, policy.outputSize);
    const result = await new Promise<Blob>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      canvas.toBlob(blob => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(signal.reason);
        else if (!blob || blob.type !== 'image/webp' || !blob.size || blob.size > policy.maxUploadBytes) reject(invalidImage());
        else resolve(blob);
      }, 'image/webp', .85);
    });
    signal.throwIfAborted(); return result;
  } finally { signal.removeEventListener('abort', abort); element.src = ''; URL.revokeObjectURL(source); }
}
function invalidImage() { return Object.assign(new Error('Choose a valid JPEG, PNG or WebP within the configured limits.'), { code: 'AUTH_AVATAR_IMAGE_INVALID' }); }
