/** Bounded actor reads and indexed full-text search. Published and private documents use separate FTS indexes. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { blogRecord, blogRevision } from './validation';
import { blogArray, blogId, blogSlug, captureBlogQuery, blogSearchExpression } from './content-validation';
import { captureContentActor, postSummary, projectPost, projectTerm, fail, type PostRow } from './content-rows';

export function queryBlogPosts({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['actor', 'siteId', 'query', 'public']), publicRead = r.public === true;
  const actor = publicRead ? null : captureContentActor(r.actor), siteId = actor?.siteId ?? blogId(r.siteId), q = captureBlogQuery(r.query ?? {});
  if (publicRead && q.status !== undefined) fail('BLOG_INVALID_INPUT', 422);
  const table = publicRead ? 'blog_publications' : 'blog_posts', index = publicRead ? 'blog_public_search' : 'blog_draft_search';
  const where = ['p.site_id=?'], values: (string | number)[] = [siteId];
  if (actor && !actor.manage) { where.push('p.created_by=?'); values.push(actor.actorId); }
  if (q.status) { where.push('p.status=?'); values.push(q.status); }
  if (q.authorId) { where.push('p.author_id=?'); values.push(q.authorId); }
  for (const [kind, id] of [['category', q.categoryId], ['tag', q.tagId]] as const) if (id) {
    where.push('EXISTS(SELECT 1 FROM blog_post_terms t WHERE t.post_id=p.id AND t.site_id=p.site_id AND t.term_id=? AND t.kind=? AND t.published=?)'); values.push(id, kind, publicRead ? 1 : 0);
  }
  const expression = q.search ? blogSearchExpression(q.search) : '';
  if (q.search && !expression) return { items: [], total: 0, limit: q.limit, offset: q.offset, hasMore: false };
  let joined = '';
  if (expression) { joined = ` JOIN ${index} ON ${index}.rowid=p.rowid`; where.push(`${index} MATCH ?`); values.push(expression); }
  const from = `${table} p${joined} WHERE ${where.join(' AND ')}`;
  const total = database.query<{ count: number }>(`SELECT count(*) AS count FROM ${from}`).get(...values)!.count;
  const order = q.order === 'relevance' && expression ? `${index}.rank,p.id` : publicRead ? `p.published_at ${q.order === 'oldest' ? 'ASC' : 'DESC'},p.id` : `p.updated_at ${q.order === 'oldest' ? 'ASC' : 'DESC'},p.id`;
  const columns = publicRead
    ? "p.id,p.site_id,p.public_revision,p.published_at,p.updated_at,p.title,p.slug,p.excerpt,p.author_id,p.author_name,json_extract(p.content_json,'$.featuredImage') AS featured_json,json_extract(p.content_json,'$.categoryIds') AS category_ids,json_extract(p.content_json,'$.tagIds') AS tag_ids"
    : 'p.id,p.site_id,p.revision,p.public_revision,p.status,p.created_by,p.created_at,p.updated_at,p.published_at,p.title,p.slug,p.excerpt,p.author_id,p.draft_hash,p.published_hash';
  const rows = database.query<Row>(`SELECT ${columns} FROM ${from} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, q.limit, q.offset);
  const items = publicRead ? rows.map(row => ({ id: row.id, siteId: row.site_id, publicRevision: row.public_revision, publishedAt: row.published_at, updatedAt: row.updated_at,
    title: row.title, slug: row.slug, excerpt: row.excerpt, authorId: row.author_id, author: { id: row.author_id, name: row.author_name }, featuredImage: row.featured_json === null ? null : JSON.parse(String(row.featured_json)), categoryIds: JSON.parse(String(row.category_ids)), tagIds: JSON.parse(String(row.tag_ids)) })) : (rows as PostRow[]).map(postSummary);
  return { items, total, limit: q.limit, offset: q.offset, hasMore: q.offset + rows.length < total };
}
export function readBlogPost({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['actor', 'id']), actor = captureContentActor(r.actor);
  const row = database.query<PostRow>('SELECT * FROM blog_posts WHERE id=? AND site_id=?').get(blogId(r.id), actor.siteId);
  if (!row || !actor.manage && row.created_by !== actor.actorId) fail('BLOG_POST_NOT_FOUND', 404);
  return projectPost(row);
}
function publicPost(row: Row) {
  return { id: row.id, siteId: row.site_id, publicRevision: row.public_revision, publishedAt: row.published_at, updatedAt: row.updated_at,
    content: JSON.parse(String(row.content_json)), author: { id: row.author_id, name: row.author_name }, redirectTo: null };
}
export function readPublishedBlogPost({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'slug']), siteId = blogId(r.siteId), slug = blogSlug(r.slug);
  const row = database.query<Row>('SELECT p.* FROM blog_post_slugs s JOIN blog_publications p ON p.id=s.post_id AND p.site_id=s.site_id WHERE s.site_id=? AND s.slug=? AND s.published=1').get(siteId, slug);
  return row ? { ...publicPost(row), redirectTo: row.slug === slug ? null : row.slug } : null;
}
export function queryBlogTerms({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'kind', 'limit', 'offset', 'public']);
  const q = captureBlogQuery({ limit: r.limit ?? 50, offset: r.offset ?? 0 });
  if (r.kind !== undefined && r.kind !== 'category' && r.kind !== 'tag') fail('BLOG_INVALID_INPUT', 422);
  const where = ['t.site_id=?'], values: (string | number)[] = [blogId(r.siteId)];
  if (r.kind) { where.push('t.kind=?'); values.push(r.kind as string); }
  if (r.public === true) where.push('EXISTS(SELECT 1 FROM blog_post_terms pt JOIN blog_publications p ON p.id=pt.post_id AND p.site_id=pt.site_id WHERE pt.term_id=t.id AND pt.published=1)');
  const predicate = where.join(' AND '), total = database.query<{ count: number }>('SELECT count(*) AS count FROM blog_terms t WHERE ' + predicate).get(...values)!.count;
  const rows = database.query<Row>('SELECT t.* FROM blog_terms t WHERE ' + predicate + ' ORDER BY t.kind,t.name,t.id LIMIT ? OFFSET ?').all(...values, q.limit, q.offset);
  return { items: rows.map(projectTerm), total, limit: q.limit, offset: q.offset, hasMore: q.offset + rows.length < total };
}
export function queryBlogRevisions({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['actor', 'id', 'limit', 'offset']), actor = captureContentActor(r.actor), id = blogId(r.id);
  const post = database.query<PostRow>('SELECT * FROM blog_posts WHERE site_id=? AND id=?').get(actor.siteId, id);
  if (!post || !actor.manage && post.created_by !== actor.actorId) fail('BLOG_POST_NOT_FOUND', 404);
  const q = captureBlogQuery({ limit: r.limit ?? 20, offset: r.offset ?? 0 }), total = database.query<{ count: number }>('SELECT count(*) AS count FROM blog_revisions WHERE post_id=? AND site_id=?').get(id, actor.siteId)!.count;
  const found = database.query<Row>('SELECT * FROM blog_revisions WHERE post_id=? AND site_id=? ORDER BY revision DESC LIMIT ? OFFSET ?').all(id, actor.siteId, q.limit, q.offset);
  let bytes = 0, nodes = 0; const rows: Array<{ row: Row; content: unknown }> = [];
  for (const row of found) {
    bytes += new TextEncoder().encode(String(row.content_json)).byteLength; if (bytes > 768 * 1024) break;
    const content = JSON.parse(String(row.content_json)), queue = [content]; let count = 16;
    while (queue.length) { const next = queue.pop(); count++; if (next && typeof next === 'object') queue.push(...Object.values(next)); }
    if (nodes + count > 19000) break; nodes += count; rows.push({ row, content });
  }
  return { items: rows.map(({ row, content }) => ({ id: row.id, postId: id, revision: row.revision, actorId: row.actor_id, createdAt: row.created_at, action: row.action, content })), total, limit: q.limit, offset: q.offset, hasMore: q.offset + rows.length < total };
}
/** A single immutable revision lets the parent authorize the actual author being restored. */
export function readBlogRevision(context: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['actor', 'id', 'revision']), actor = captureContentActor(r.actor), id = blogId(r.id);
  readBlogPost(context, { actor, id });
  const row = context.database.query<Row>('SELECT content_json FROM blog_revisions WHERE post_id=? AND site_id=? AND revision=?').get(id, actor.siteId, blogRevision(r.revision));
  if (!row) fail('BLOG_REVISION_NOT_FOUND', 404);
  return JSON.parse(String(row.content_json));
}
/** Keyset sitemap batches contain no document bodies; noindex snapshots are never advertised. */
export function queryBlogSitemap({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'after']), siteId = blogId(r.siteId);
  const after = r.after === undefined ? '' : blogId(r.after);
  return database.query<{ id: string; slug: string; updated_at: number }>("SELECT id,slug,updated_at FROM blog_publications WHERE site_id=? AND id>? AND json_extract(content_json,'$.seo.noIndex')=0 ORDER BY id LIMIT 500")
    .all(siteId, after).map(row => ({ id: row.id, slug: row.slug, updatedAt: row.updated_at }));
}
/** Only indexable archives with an accepted publication participate in automatic discovery. */
export function queryBlogTaxonomySitemap({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'after']), siteId = blogId(r.siteId), after = r.after === undefined ? '' : blogId(r.after);
  return database.query<{ id: string; kind: 'category' | 'tag' }>('SELECT t.id,t.kind FROM blog_terms t WHERE t.site_id=? AND t.id>? AND t.no_index=0 AND EXISTS(SELECT 1 FROM blog_post_terms pt JOIN blog_publications p ON p.id=pt.post_id AND p.site_id=pt.site_id WHERE pt.term_id=t.id AND pt.site_id=t.site_id AND pt.published=1) ORDER BY t.id LIMIT 500').all(siteId, after);
}
/** An archive is public only while at least one accepted publication references the term. */
export function readPublicBlogTerm({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'id']);
  const row = database.query<Row>('SELECT t.* FROM blog_terms t WHERE t.site_id=? AND t.id=? AND EXISTS(SELECT 1 FROM blog_post_terms pt JOIN blog_publications p ON p.id=pt.post_id AND p.site_id=pt.site_id WHERE pt.term_id=t.id AND pt.site_id=t.site_id AND pt.published=1)')
    .get(blogId(r.siteId), blogId(r.id));
  if (!row) fail('BLOG_TAXONOMY_NOT_FOUND', 404);
  return projectTerm(row);
}
/** One bounded public batch avoids a request/actor round trip for every tag on a magazine page. */
export function readPublicBlogTerms({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = blogRecord(input, ['siteId', 'ids']), siteId = blogId(r.siteId), ids = [...new Set(blogArray(r.ids, 100).map(blogId))];
  if (!ids.length) return [];
  return database.query<Row>(`SELECT t.* FROM blog_terms t WHERE t.site_id=? AND t.id IN(${ids.map(() => '?').join(',')}) AND EXISTS(SELECT 1 FROM blog_post_terms pt JOIN blog_publications p ON p.id=pt.post_id AND p.site_id=pt.site_id WHERE pt.term_id=t.id AND pt.site_id=t.site_id AND pt.published=1) ORDER BY t.kind,t.name,t.id`)
    .all(siteId, ...ids).map(projectTerm);
}
