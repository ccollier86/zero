/** Actor-local aggregate counters and bounded receipt retention. Only verified server ticket fields reach the command. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { blogRecord } from './validation';
import { blogId, captureBlogQuery } from './content-validation';
import { captureContentActor, contentCommand, contentHash, fail } from './content-rows';
import type { Row } from '../sync/types';

export function recordBlogMetric(context: DatabaseWriteCommandContext, input: unknown) {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['siteId', 'postId', 'nonce', 'kind', 'observedAt', 'visibleMs', 'expiresAt', 'retentionDays']);
    const siteId = blogId(r.siteId), postId = blogId(r.postId), nonce = blogId(r.nonce), now = Date.now();
    if (!['view', 'engagement'].includes(String(r.kind)) || !Number.isSafeInteger(r.observedAt) || Math.abs(Number(r.observedAt) - now) > 600000
      || !Number.isSafeInteger(r.visibleMs) || Number(r.visibleMs) < 0 || Number(r.visibleMs) > 300000 || r.kind === 'view' && r.visibleMs !== 0
      || !Number.isSafeInteger(r.expiresAt) || Number(r.expiresAt) <= now || !Number.isSafeInteger(r.retentionDays) || Number(r.retentionDays) < 1 || Number(r.retentionDays) > 3660) fail('BLOG_INVALID_INPUT', 422);
    const post = context.db.get('blog_publications', postId);
    if (!post || post.site_id !== siteId) fail('BLOG_POST_NOT_FOUND', 404);
    const id = contentHash([siteId, postId, nonce, r.kind]), digest = contentHash([siteId, postId, nonce, r.kind, r.observedAt, r.visibleMs]);
    const prior = context.db.get('_blog_metric_receipts', id);
    if (prior) { if (prior.digest !== digest) fail('BLOG_METRIC_CONFLICT'); return { accepted: true, duplicate: true }; }
    const day = new Date(Number(r.observedAt)).toISOString().slice(0, 10), key = `${postId}:${day}`, old = context.db.get('_blog_metrics', key);
    const row = { id: key, site_id: siteId, post_id: postId, day, views: Number(old?.views ?? 0) + (r.kind === 'view' ? 1 : 0),
      engagements: Number(old?.engagements ?? 0) + (r.kind === 'engagement' ? 1 : 0), visible_ms: Number(old?.visible_ms ?? 0) + Number(r.visibleMs) };
    if (![row.views, row.engagements, row.visible_ms].every(Number.isSafeInteger)) fail('BLOG_CAPACITY', 429);
    if (old) context.db.update('_blog_metrics', key, row); else context.db.createStrict('_blog_metrics', row);
    context.db.createStrict('_blog_metric_receipts', { id, digest, expires_at: Number(r.expiresAt) + 60000, recorded_at: now,
      retention_day: new Date(now - Number(r.retentionDays) * 86400000).toISOString().slice(0, 10) });
    return { accepted: true, duplicate: false };
  });
}
export function queryBlogMetrics({ database }: DatabaseReadQueryContext, input: unknown) {
  const r = blogRecord(input, ['actor', 'query', 'retentionDays']), actor = captureContentActor(r.actor), q = blogRecord(r.query ?? {}, ['postId', 'since', 'until', 'limit', 'offset']);
  if (!Number.isSafeInteger(r.retentionDays) || Number(r.retentionDays) < 1 || Number(r.retentionDays) > 3660) fail('BLOG_INVALID_INPUT', 422);
  const page = captureBlogQuery({ limit: q.limit, offset: q.offset }), where = ['m.site_id=?'], values: (string | number)[] = [actor.siteId];
  // Enforce the visible retention window even when this site has no new observations to drive physical cleanup.
  where.push('m.day>=?'); values.push(new Date(Date.now() - Number(r.retentionDays) * 86400000).toISOString().slice(0, 10));
  if (!actor.manage) { where.push('p.created_by=?'); values.push(actor.actorId); }
  if (q.postId !== undefined) { where.push('m.post_id=?'); values.push(blogId(q.postId)); }
  for (const key of ['since', 'until'] as const) if (q[key] !== undefined) {
    const date = q[key];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('BLOG_INVALID_INPUT', 422);
    where.push(`m.day${key === 'since' ? '>=' : '<='}?`); values.push(date as string);
  }
  const from = '_blog_metrics m JOIN blog_posts p ON p.id=m.post_id AND p.site_id=m.site_id WHERE ' + where.join(' AND ');
  const total = database.query<{ n: number }>('SELECT count(*) AS n FROM ' + from).get(...values)!.n;
  const rows = database.query<Row>('SELECT m.* FROM ' + from + ' ORDER BY m.day DESC,m.post_id LIMIT ? OFFSET ?').all(...values, page.limit, page.offset);
  return { items: rows.map(row => ({ postId: row.post_id, day: row.day, views: row.views, engagements: row.engagements, visibleMs: row.visible_ms })), total,
    limit: page.limit, offset: page.offset, hasMore: page.offset + rows.length < total };
}
