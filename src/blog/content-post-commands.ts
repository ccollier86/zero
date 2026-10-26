/** Atomic actor-local draft/revision/publication commands. All asynchronous authority and media I/O stay outside. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { blogRecord, blogRevision, blogText } from './validation';
import { blogId, captureBlogPostContent, blogDocumentText, blogContentMedia } from './content-validation';
import { captureContentActor, contentCommand, postRow, projectPost, fail, appendContentActivity, contentHash, type PostRow, type ContentActor } from './content-rows';
import type { BlogPostContent } from './content-types';

function reserveSlug({ db }: DatabaseWriteCommandContext, siteId: string, slug: string, postId: string): void {
  const id = `${siteId}:${slug}`, prior = db.get('blog_post_slugs', id);
  if (prior && prior.post_id !== postId) fail('BLOG_SLUG_CONFLICT');
  if (!prior) db.createStrict('blog_post_slugs', { id, site_id: siteId, slug, post_id: postId, published: 0 });
}
function references(context: DatabaseWriteCommandContext, actor: ContentActor, postId: string, content: BlogPostContent, published: boolean): void {
  const { db } = context, slot = published ? 1 : 0;
  clearReferences(context, postId, published);
  for (const [kind, ids] of [['category', content.categoryIds], ['tag', content.tagIds]] as const) for (const id of ids) {
    const term = db.get('blog_terms', id);
    if (!term || term.site_id !== actor.siteId || term.kind !== kind) fail('BLOG_TAXONOMY_INVALID', 422);
    db.createStrict('blog_post_terms', { id: `${postId}:${slot}:${id}`, site_id: actor.siteId, post_id: postId, term_id: id, kind, published: slot });
  }
  const used = new Set<string>();
  for (const reference of blogContentMedia(content)) {
    const media = db.get('blog_media', reference.id);
    if (!media || media.site_id !== actor.siteId || media.state !== 'ready' || media.kind !== reference.kind || !actor.manage && media.owner_id !== actor.actorId) fail('BLOG_MEDIA_UNAVAILABLE', 422);
    if (used.has(reference.id)) continue; used.add(reference.id);
    db.createStrict('blog_post_media', { id: `${postId}:${slot}:${reference.id}`, site_id: actor.siteId, post_id: postId, media_id: reference.id, published: slot });
  }
}
/** Resolve bounded reference identities from this post's prior document, never scan every post's links. */
function clearReferences({ db }: DatabaseWriteCommandContext, postId: string, published: boolean): void {
  const prior = db.get(published ? 'blog_publications' : 'blog_posts', postId);
  if (!prior) return;
  const old = JSON.parse(String(published ? prior.content_json : prior.draft_json)) as BlogPostContent, slot = published ? 1 : 0;
  for (const id of [...old.categoryIds, ...old.tagIds]) db.delete('blog_post_terms', `${postId}:${slot}:${id}`);
  for (const id of new Set(blogContentMedia(old).map(value => value.id))) db.delete('blog_post_media', `${postId}:${slot}:${id}`);
}
function revision(context: DatabaseWriteCommandContext, actor: ContentActor, row: PostRow, action: string, now: number): void {
  context.db.createStrict('blog_revisions', { id: `${row.id}:${row.revision}`, site_id: actor.siteId, post_id: row.id, revision: row.revision,
    actor_id: actor.actorId, created_at: now, action, content_json: row.draft_json });
  appendContentActivity(context, actor, `post.${action}`, row.id, row.revision, now);
}
function fields(content: BlogPostContent) {
  return { title: content.title, slug: content.slug, excerpt: content.excerpt, author_id: content.authorId,
    body: blogDocumentText(content.document), draft_json: JSON.stringify(content), draft_hash: contentHash(content) };
}
export function createBlogPost(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'content']), actor = captureContentActor(r.actor), id = blogId(r.id), content = captureBlogPostContent(r.content), now = Date.now();
    reserveSlug(context, actor.siteId, content.slug, id);
    const row: PostRow = { id, site_id: actor.siteId, revision: 1, public_revision: 0, status: 'draft', created_by: actor.actorId, created_at: now, updated_at: now, published_at: null, published_hash: null, ...fields(content) };
    context.db.createStrict('blog_posts', row); references(context, actor, id, content, false); revision(context, actor, row, 'create', now);
    return projectPost(row);
  });
}
export function updateBlogPost(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision', 'content']), actor = captureContentActor(r.actor), row = postRow(context, actor, r.id, r.expectedRevision);
    if (row.status === 'trashed') fail('BLOG_POST_TRASHED');
    const content = captureBlogPostContent(r.content), now = Date.now();
    reserveSlug(context, actor.siteId, content.slug, row.id);
    if (content.slug !== row.slug) { const old = context.db.get('blog_post_slugs', `${actor.siteId}:${row.slug}`); if (old?.published === 0) context.db.delete('blog_post_slugs', String(old.id)); }
    references(context, actor, row.id, content, false);
    const next: PostRow = { ...row, ...fields(content), revision: row.revision + 1, updated_at: now };
    context.db.update('blog_posts', row.id, next); revision(context, actor, next, 'edit', now); return projectPost(next);
  });
}
export function publishBlogPost(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision', 'authorName']), actor = captureContentActor(r.actor), row = postRow(context, actor, r.id, r.expectedRevision);
    if (!actor.publish) fail('BLOG_FORBIDDEN', 403);
    const content = captureBlogPostContent(JSON.parse(row.draft_json));
    if (row.status === 'trashed' || !content.title || !blogDocumentText(content.document).trim()) fail('BLOG_POST_INCOMPLETE', 422);
    const authorName = blogText(r.authorName, 200); if (!authorName) fail('BLOG_POST_INCOMPLETE', 422);
    const now = Date.now(); references(context, actor, row.id, content, true);
    const published = { id: row.id, site_id: row.site_id, public_revision: row.public_revision + 1, published_at: row.published_at ?? now, updated_at: now,
      title: row.title, slug: row.slug, excerpt: row.excerpt, author_id: row.author_id, author_name: authorName, body: row.body, content_json: row.draft_json, no_index: content.seo.noIndex ? 1 : 0 };
    if (context.db.get('blog_publications', row.id)) context.db.update('blog_publications', row.id, published);
    else context.db.createStrict('blog_publications', published);
    context.db.update('blog_post_slugs', `${row.site_id}:${row.slug}`, { published: 1 });
    const next: PostRow = { ...row, revision: row.revision + 1, public_revision: published.public_revision, published_hash: row.draft_hash, status: 'published', updated_at: now, published_at: published.published_at };
    context.db.update('blog_posts', row.id, next); revision(context, actor, next, 'publish', now); return projectPost(next);
  });
}
export function changeBlogPostState(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision', 'action']), actor = captureContentActor(r.actor), row = postRow(context, actor, r.id, r.expectedRevision), action = r.action;
    if (action !== 'withdraw' && action !== 'trash') fail('BLOG_INVALID_INPUT', 422);
    if (action === 'withdraw' && !actor.publish) fail('BLOG_FORBIDDEN', 403);
    if (action === 'trash' && context.db.get('blog_publications', row.id)) fail('BLOG_WITHDRAW_REQUIRED');
    if (action === 'withdraw') {
      clearReferences(context, row.id, true);
      context.db.delete('blog_publications', row.id);
    }
    const now = Date.now(), next: PostRow = { ...row, revision: row.revision + 1, status: action === 'withdraw' ? 'withdrawn' : 'trashed', updated_at: now };
    context.db.update('blog_posts', row.id, next); revision(context, actor, next, action, now); return projectPost(next);
  });
}
export function restoreBlogPost(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision', 'revision']), actor = captureContentActor(r.actor), row = postRow(context, actor, r.id, r.expectedRevision);
    const old = context.db.get('blog_revisions', `${row.id}:${blogRevision(r.revision)}`);
    if (!old || old.site_id !== actor.siteId) fail('BLOG_REVISION_NOT_FOUND', 404);
    const content = captureBlogPostContent(JSON.parse(String(old.content_json))), now = Date.now();
    reserveSlug(context, actor.siteId, content.slug, row.id);
    if (content.slug !== row.slug) { const oldSlug = context.db.get('blog_post_slugs', `${actor.siteId}:${row.slug}`); if (oldSlug?.published === 0) context.db.delete('blog_post_slugs', String(oldSlug.id)); }
    references(context, actor, row.id, content, false);
    const next: PostRow = { ...row, ...fields(content), revision: row.revision + 1, status: row.status === 'trashed' ? 'draft' : row.status, updated_at: now };
    context.db.update('blog_posts', row.id, next); revision(context, actor, next, 'restore', now); return projectPost(next);
  });
}
