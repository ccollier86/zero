/** Actor-local projection and business failures. No Guardian, transport or native connection capability is exposed. */
import { AuthError } from '../auth/types';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { BlogPostContent, BlogPostRecord, BlogPostSummary, BlogTaxonomyTerm } from './content-types';
import { blogId } from './content-validation';
import { blogRecord, blogRevision } from './validation';
import { blogActorRejection } from './content-errors';

export type PostRow = Row & { id: string; site_id: string; revision: number; public_revision: number; status: BlogPostRecord['status']; created_by: string; created_at: number; updated_at: number; published_at: number | null; title: string; slug: string; excerpt: string; author_id: string; body: string; draft_json: string; draft_hash: string; published_hash: string | null };
export interface ContentActor { siteId: string; actorId: string; manage: boolean; publish: boolean }
/** Only server composition can reach these registered commands; body-supplied authority is never passed through. */
export function captureContentActor(value: unknown): ContentActor {
  const r = blogRecord(value, ['siteId', 'actorId', 'manage', 'publish']);
  if (typeof r.manage !== 'boolean' || typeof r.publish !== 'boolean') fail('BLOG_FORBIDDEN', 403);
  return { siteId: blogId(r.siteId), actorId: blogId(r.actorId), manage: r.manage, publish: r.publish };
}
export function fail(code: string, status = 409): never { throw new AuthError('The blog operation was not accepted.', code, status); }
/** Domain rejection rolls back the entire command before returning its closed, payload-free outcome. */
export function contentCommand(context: DatabaseWriteCommandContext, run: () => unknown): unknown {
  try { return { ok: true, value: run() }; }
  catch (error) {
    if (error instanceof AuthError && error.code.startsWith('BLOG_')) blogActorRejection(error);
    throw error;
  }
}
export function postRow(context: DatabaseWriteCommandContext, actor: ContentActor, id: unknown, expectedRevision?: unknown): PostRow {
  const row = context.db.get('blog_posts', blogId(id)) as PostRow | null;
  if (!row || row.site_id !== actor.siteId) fail('BLOG_POST_NOT_FOUND', 404);
  if (!actor.manage && row.created_by !== actor.actorId) fail('BLOG_FORBIDDEN', 403);
  if (expectedRevision !== undefined && row.revision !== blogRevision(expectedRevision)) fail('BLOG_REVISION_CONFLICT');
  if (row.revision >= Number.MAX_SAFE_INTEGER - 1 || row.public_revision >= Number.MAX_SAFE_INTEGER - 1) fail('BLOG_CAPACITY', 429);
  return row;
}
export function postSummary(row: PostRow): BlogPostSummary {
  return { id: row.id, siteId: row.site_id, revision: row.revision, publicRevision: row.public_revision, status: row.status,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at,
    hasUnpublishedChanges: row.draft_hash !== row.published_hash, title: row.title, slug: row.slug, excerpt: row.excerpt, authorId: row.author_id };
}
export function projectPost(row: PostRow): BlogPostRecord {
  const { title: _title, slug: _slug, excerpt: _excerpt, authorId: _author, ...summary } = postSummary(row);
  return { ...summary, content: JSON.parse(row.draft_json) as BlogPostContent };
}
export function projectTerm(row: Row): BlogTaxonomyTerm {
  return { id: String(row.id), siteId: String(row.site_id), kind: row.kind as 'category', slug: String(row.slug), name: String(row.name), description: String(row.description),
    parentId: row.parent_id as string | null, revision: Number(row.revision), seoTitle: row.seo_title as string | null, seoDescription: row.seo_description as string | null, noIndex: row.no_index === 1 };
}
export function contentHash(value: unknown): string { return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex'); }
/** Safe lifecycle/revision evidence only; article text never enters the activity row. */
export function appendContentActivity(context: DatabaseWriteCommandContext, actor: ContentActor, action: string, postId: string | null, revision: number, now: number): void {
  context.db.createStrict('blog_activity', { id: crypto.randomUUID(), actor_id: actor.actorId, site_id: actor.siteId, action, post_id: postId, revision, created_at: now });
}
