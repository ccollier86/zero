/** Actor-local category/tag lifecycle. Bounded ancestry and tracked reference guards protect articles and public archives. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { blogRecord, blogRevision } from './validation';
import { blogId, captureBlogTerm } from './content-validation';
import { captureContentActor, contentCommand, projectTerm, fail, appendContentActivity } from './content-rows';

export function writeBlogTerm(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision', 'term']), actor = captureContentActor(r.actor), id = blogId(r.id), term = captureBlogTerm(r.term);
    if (!actor.manage) fail('BLOG_FORBIDDEN', 403);
    const expected = blogRevision(r.expectedRevision, true), old = context.db.get('blog_terms', id);
    if (old && old.site_id !== actor.siteId) fail('BLOG_TAXONOMY_NOT_FOUND', 404);
    if (old ? old.revision !== expected : expected !== 0) fail('BLOG_REVISION_CONFLICT');
    if (old && old.kind !== term.kind) fail('BLOG_TAXONOMY_KIND_CONFLICT');
    let parent = term.parentId, depth = 0;
    while (parent) {
      if (parent === id || ++depth > 16) fail('BLOG_TAXONOMY_CYCLE', 422);
      const row = context.db.get('blog_terms', parent);
      if (!row || row.site_id !== actor.siteId || row.kind !== 'category') fail('BLOG_TAXONOMY_INVALID', 422);
      parent = row.parent_id as string | null;
    }
    const slugKey = `${actor.siteId}:${term.kind}:${term.slug}`, existing = context.db.get('blog_term_slugs', slugKey);
    if (existing && existing.term_id !== id) fail('BLOG_SLUG_CONFLICT');
    if (!existing) context.db.createStrict('blog_term_slugs', { id: slugKey, term_id: id });
    if (old && old.slug !== term.slug) context.db.delete('blog_term_slugs', `${actor.siteId}:${term.kind}:${old.slug}`);
    const row = { id, site_id: actor.siteId, kind: term.kind, slug: term.slug, name: term.name, description: term.description, parent_id: term.parentId,
      revision: Number(old?.revision ?? 0) + 1, seo_title: term.seoTitle, seo_description: term.seoDescription, no_index: term.noIndex ? 1 : 0 };
    if (row.revision >= Number.MAX_SAFE_INTEGER) fail('BLOG_CAPACITY', 429);
    if (old) context.db.update('blog_terms', id, row); else context.db.createStrict('blog_terms', row);
    appendContentActivity(context, actor, old ? 'term.edit' : 'term.create', null, row.revision, Date.now());
    return projectTerm(row);
  });
}
/** SQL foreign-key admission below is the final referenced/parent guard; no unbounded row scan. */
export function removeBlogTerm(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return contentCommand(context, () => {
    const r = blogRecord(input, ['actor', 'id', 'expectedRevision']), actor = captureContentActor(r.actor), id = blogId(r.id), expected = blogRevision(r.expectedRevision);
    if (!actor.manage) fail('BLOG_FORBIDDEN', 403);
    const old = context.db.get('blog_terms', id);
    if (!old || old.site_id !== actor.siteId) fail('BLOG_TAXONOMY_NOT_FOUND', 404);
    if (old.revision !== expected) fail('BLOG_REVISION_CONFLICT');
    try { context.db.delete('blog_terms', id); }
    catch (error) {
      if (error instanceof Error && error.message.includes('Blog taxonomy is referenced')) fail('BLOG_TAXONOMY_IN_USE');
      throw error;
    }
    context.db.delete('blog_term_slugs', `${actor.siteId}:${old.kind}:${old.slug}`);
    appendContentActivity(context, actor, 'term.remove', null, expected + 1, Date.now());
    return { removed: true };
  });
}
