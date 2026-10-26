/** Bounded private-library and published-reference reads. No query returns physical paths or lease material. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { blogRecord } from './validation';
import { blogId, blogSlug, captureBlogQuery } from './content-validation';
import { captureContentActor, fail } from './content-rows';
import { projectBlogMedia } from './media-commands';

export function readBlogMedia({ database }: DatabaseReadQueryContext, input: unknown) {
  const r = blogRecord(input, ['actor', 'id']), actor = captureContentActor(r.actor);
  const row = database.query<Row>('SELECT * FROM blog_media WHERE id=? AND site_id=?').get(blogId(r.id), actor.siteId);
  if (!row || !actor.manage && row.owner_id !== actor.actorId) fail('BLOG_MEDIA_NOT_FOUND', 404);
  return { asset: projectBlogMedia(row), checksum: row.checksum };
}
export function listBlogMedia({ database }: DatabaseReadQueryContext, input: unknown) {
  const r = blogRecord(input, ['actor', 'query']), actor = captureContentActor(r.actor), q = blogRecord(r.query ?? {}, ['kind', 'limit', 'offset']);
  const page = captureBlogQuery({ limit: q.limit, offset: q.offset }), values: (string | number)[] = [actor.siteId], where = ["site_id=?", "state!='removed'"];
  if (!actor.manage) { where.push('owner_id=?'); values.push(actor.actorId); }
  if (q.kind !== undefined) { if (!['image', 'audio', 'video'].includes(String(q.kind))) fail('BLOG_INVALID_INPUT', 422); where.push('kind=?'); values.push(String(q.kind)); }
  const predicate = where.join(' AND '), total = database.query<{ n: number }>('SELECT count(*) AS n FROM blog_media WHERE ' + predicate).get(...values)!.n;
  const rows = database.query<Row>('SELECT * FROM blog_media WHERE ' + predicate + ' ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(...values, page.limit, page.offset);
  return { items: rows.map(projectBlogMedia), total, limit: page.limit, offset: page.offset, hasMore: page.offset + rows.length < total };
}
export function publicBlogMedia({ database }: DatabaseReadQueryContext, input: unknown) {
  const r = blogRecord(input, ['siteId', 'postSlug', 'id']);
  const row = database.query<Row>("SELECT m.* FROM blog_media m JOIN blog_post_media pm ON pm.media_id=m.id AND pm.site_id=m.site_id AND pm.published=1 JOIN blog_publications p ON p.id=pm.post_id AND p.site_id=pm.site_id WHERE m.site_id=? AND p.slug=? AND m.id=? AND m.state='ready'").get(blogId(r.siteId), blogSlug(r.postSlug), blogId(r.id));
  if (!row) fail('BLOG_MEDIA_NOT_FOUND', 404);
  return { asset: projectBlogMedia(row), checksum: row.checksum };
}
/** Framework-private recovery projection; external routes cannot choose or execute named realm queries. */
export function pendingBlogMedia({ database }: DatabaseReadQueryContext) {
  return database.query<Row>("SELECT id,site_id,owner_id,state,checksum FROM blog_media WHERE state='removing' OR (state='allocated' AND expires_at<=?) OR (state='ready' AND staging_cleanup=1) ORDER BY created_at,id LIMIT 25").all(Date.now());
}
/** One known expiry schedules future work without repeatedly polling an idle database. */
export function nextBlogMediaExpiry({ database }: DatabaseReadQueryContext) {
  return database.query<{ expiresAt: number }>("SELECT expires_at AS expiresAt FROM blog_media WHERE state='allocated' AND expires_at>? ORDER BY expires_at LIMIT 1").get(Date.now()) ?? null;
}
