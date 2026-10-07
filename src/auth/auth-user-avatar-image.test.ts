import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { normalizeAuthUserAvatar } from './auth-config-user-avatar';
import { normalizeUserAvatarImage } from './auth-user-avatar-image';

describe('Avatar raster admission on Bun', () => {
  test('validates optional policy without guessing storage readiness', () => {
    expect(normalizeAuthUserAvatar().enabled).toBe(false);
    expect(normalizeAuthUserAvatar({ enabled: true, shape: 'square' }).shape).toBe('square');
    expect(() => normalizeAuthUserAvatar({ maxPixels: Infinity })).toThrow('maxPixels');
    expect(() => normalizeAuthUserAvatar({ outputSize: 4096 })).toThrow('outputSize');
  });
  test('decodes actual bytes, strips metadata and normalizes a bounded square raster', async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#5577aa' } }).png().toBuffer();
    const normalized = await normalizeUserAvatarImage(source, normalizeAuthUserAvatar({ outputSize: 64 }));
    const actual = await sharp(normalized.bytes).metadata();
    expect(normalized).toMatchObject({ width: 64, height: 64, mimeType: 'image/webp' });
    expect(actual.format).toBe('webp'); expect(actual.width).toBe(64); expect(actual.height).toBe(64);
    expect(actual.exif).toBeUndefined();
  });
  test('rejects forged/truncated images, XML/SVG and pixel/byte-limit violations', async () => {
    const policy = normalizeAuthUserAvatar({ maxPixels: 256, maxUploadBytes: 1024, outputSize: 64 });
    for (const bytes of [new Uint8Array(), new Uint8Array(1025), new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
      new TextEncoder().encode('not a picture')]) {
      await expect(normalizeUserAvatarImage(bytes, policy)).rejects.toMatchObject({ code: 'AUTH_AVATAR_IMAGE_INVALID' });
    }
    const tooLarge = await sharp({ create: { width: 17, height: 17, channels: 3, background: '#112233' } }).png().toBuffer();
    await expect(normalizeUserAvatarImage(tooLarge, policy)).rejects.toMatchObject({ code: 'AUTH_AVATAR_IMAGE_INVALID' });
    await expect(normalizeUserAvatarImage(tooLarge.subarray(0, 40), policy)).rejects.toMatchObject({ code: 'AUTH_AVATAR_IMAGE_INVALID' });
  });
});
