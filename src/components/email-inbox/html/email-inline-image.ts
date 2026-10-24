import { EMAIL_HTML_LIMITS, EmailHtmlError } from './email-html-policy';

/** Check the actual raster signature and dimensions, not an attachment's claimed MIME. */
export function emailInlineImage(bytes: Uint8Array): { contentType: string; width: number; height: number; url: string } {
  if (bytes.length > EMAIL_HTML_LIMITS.imageBytes || bytes.length < 12) throw new EmailHtmlError('Inline image is too large or invalid.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let contentType = '', width = 0, height = 0;
  if (bytes.length >= 24 && bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG'
    && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    contentType = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) {
    contentType = 'image/gif'; width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    contentType = 'image/jpeg';
    for (let i = 2, steps = 0; i + 8 < bytes.length && steps++ < 10_000;) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker! >= 208 && marker! <= 215)) continue;
      if (i + 2 > bytes.length) break;
      const size = view.getUint16(i);
      if (size < 2 || i + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker!)) {
        if (size < 7) break;
        height = view.getUint16(i + 3); width = view.getUint16(i + 5); break;
      }
      i += size;
    }
  } else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const type = String.fromCharCode(...bytes.slice(12, 16)); contentType = 'image/webp';
    if (type === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 47) {
      width = 1 + bytes[21]! + ((bytes[22]! & 63) << 8);
      height = 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 15) << 10);
    } else if (type === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    }
  }
  if (!width || !height || width > 20_000 || height > 20_000 || width * height > EMAIL_HTML_LIMITS.imagePixels) {
    throw new EmailHtmlError('Only bounded PNG, JPEG, GIF and WebP inline images are supported.');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { contentType, width, height, url: `data:${contentType};base64,${btoa(binary)}` };
}
