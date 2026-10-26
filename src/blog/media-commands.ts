/** Actor-local media manifest state machine. Storage I/O and lease acquisition stay outside SQLite transactions. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { blogRecord } from './validation';
import { blogId } from './content-validation';
import { captureContentActor, contentCommand, fail, type ContentActor } from './content-rows';
import { captureBlogMediaInput, BLOG_MEDIA_MIMES } from './media-validation';
import type { BlogMediaAsset } from './media-types';

export function projectBlogMedia(row: Row): BlogMediaAsset {
  return { id: String(row.id), siteId: String(row.site_id), kind: row.kind as BlogMediaAsset['kind'], fileName: String(row.file_name), mimeType: String(row.mime_type),
    state: row.state as BlogMediaAsset['state'], createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), sizeBytes: row.size_bytes as number | null,
    width: row.width as number | null, height: row.height as number | null, previewPath: row.state === 'ready' ? `/api/blog/media/${encodeURIComponent(String(row.id))}/content` : null };
}
function mediaRow(context: DatabaseWriteCommandContext, actor: ContentActor, id: unknown): Row {
  const row = context.db.get('blog_media', blogId(id));
  if (!row || row.site_id !== actor.siteId || !actor.manage && row.owner_id !== actor.actorId) fail('BLOG_MEDIA_NOT_FOUND', 404);
  return row;
}
export function allocateBlogMedia(context: DatabaseWriteCommandContext, input: unknown) {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'input']), actor = captureContentActor(r.actor), id = blogId(r.id), media = captureBlogMediaInput(r.input), now = Date.now();
    const row = { id, site_id: actor.siteId, owner_id: actor.actorId, state: 'allocated', kind: media.kind, mime_type: media.mimeType, file_name: media.fileName,
      created_at: now, expires_at: now + 3600000, checksum: null, size_bytes: null, width: null, height: null, staging_cleanup: 0 };
    context.db.createStrict('blog_media', row); return projectBlogMedia(row);
  });
}
export function acceptBlogMedia(context: DatabaseWriteCommandContext, input: unknown) {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'checksum', 'sizeBytes', 'mimeType', 'width', 'height']), actor = captureContentActor(r.actor), row = mediaRow(context, actor, r.id);
    if (row.state !== 'allocated' || Number(row.expires_at) <= Date.now()) fail('BLOG_MEDIA_UNAVAILABLE', 422);
    if (typeof r.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(r.checksum) || !Number.isSafeInteger(r.sizeBytes) || Number(r.sizeBytes) < 1
      || typeof r.mimeType !== 'string' || !BLOG_MEDIA_MIMES[row.kind as keyof typeof BLOG_MEDIA_MIMES].includes(r.mimeType)) fail('BLOG_INVALID_INPUT', 422);
    for (const size of [r.width, r.height]) if (row.kind === 'image' ? !Number.isSafeInteger(size) || Number(size) < 1 : size !== null) fail('BLOG_INVALID_INPUT', 422);
    const next = { ...row, state: 'ready', checksum: r.checksum, size_bytes: r.sizeBytes, mime_type: r.mimeType, width: r.width, height: r.height, staging_cleanup: 1 };
    context.db.update('blog_media', String(row.id), next); return projectBlogMedia(next as Row);
  });
}
export function retireBlogMedia(context: DatabaseWriteCommandContext, input: unknown) {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'finish']), actor = captureContentActor(r.actor), row = mediaRow(context, actor, r.id);
    if (r.finish !== undefined && r.finish !== true) fail('BLOG_INVALID_INPUT', 422);
    if (row.state === 'removed') return { removed: true };
    if (r.finish === true && row.state !== 'removing') fail('BLOG_MEDIA_UNAVAILABLE', 422);
    try { context.db.update('blog_media', String(row.id), { state: r.finish === true ? 'removed' : 'removing', ...(r.finish ? { staging_cleanup: 0 } : {}) }); }
    catch (error) { if (error instanceof Error && error.message.includes('Blog media is referenced')) fail('BLOG_MEDIA_IN_USE'); throw error; }
    return r.finish === true ? { removed: true } : { removing: true };
  });
}
/** An admitted lease holder has removed only the temporary original, never the referenced immutable asset. */
export function cleanBlogMediaStage(context: DatabaseWriteCommandContext, input: unknown) {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id']), actor = captureContentActor(r.actor), row = mediaRow(context, actor, r.id);
    if (row.state === 'ready') context.db.update('blog_media', String(row.id), { staging_cleanup: 0 });
    return { cleaned: true };
  });
}
