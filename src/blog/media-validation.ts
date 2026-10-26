/** Closed private media input admission; MIME/type identity is checked again against actual bytes by Storage and image normalization. */
import { blogInvalid, blogRecord, blogText } from './validation';
import type { BlogMediaInput, BlogMediaKind } from './media-types';
export const BLOG_MEDIA_MIMES: Readonly<Record<BlogMediaKind, readonly string[]>> = Object.freeze({
  image: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  video: Object.freeze(['video/mp4', 'video/webm']),
  audio: Object.freeze(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm']),
});
/** Executable HTML/SVG and arbitrary external media locations are never upload types. */
export function captureBlogMediaInput(input: unknown): BlogMediaInput {
  const r = blogRecord(input, ['kind', 'fileName', 'mimeType']);
  if (!['image', 'video', 'audio'].includes(r.kind as string) || typeof r.mimeType !== 'string' || !BLOG_MEDIA_MIMES[r.kind as BlogMediaKind].includes(r.mimeType)) return blogInvalid();
  const fileName = blogText(r.fileName, 180);
  if (!fileName || /[\/\\]/u.test(fileName) || fileName === '.' || fileName === '..') return blogInvalid();
  return { kind: r.kind as BlogMediaKind, mimeType: r.mimeType, fileName };
}
