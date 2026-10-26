/** Side-effect-free private publishing realm, imported independently by parent and actor. No app boot or credentials. */
import { defineDatabaseRealm } from '../databases/database-realm';
import { quoteSqlIdentifier } from '../sync/identity';
import { AuthError } from '../auth/types';
import { BLOG_CONTENT_TABLES } from './content-schema';
import { createBlogPost, updateBlogPost, publishBlogPost, changeBlogPostState, restoreBlogPost } from './content-post-commands';
import { writeBlogTerm, removeBlogTerm } from './content-taxonomy-commands';
import { queryBlogPosts, readBlogPost, readPublishedBlogPost, queryBlogTerms, queryBlogRevisions, readBlogRevision, queryBlogSitemap, queryBlogTaxonomySitemap, readPublicBlogTerm, readPublicBlogTerms } from './content-queries';
import type { DatabaseReadQueryHandler } from '../databases/database-realm';
import { contentCommand, fail } from './content-rows';
import { blogRecord } from './validation';
import { blogId } from './content-validation';
import { allocateBlogMedia, acceptBlogMedia, retireBlogMedia, cleanBlogMediaStage } from './media-commands';
import { readBlogMedia, listBlogMedia, publicBlogMedia, pendingBlogMedia, nextBlogMediaExpiry } from './media-queries';
import { recordBlogMetric, queryBlogMetrics } from './metrics-realm';

/** Query failures use the same closed business outcome as writes; framework failures still fail the actor request. */
function query(handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler {
  return (context, input) => {
    try { return { ok: true, value: handler(context, input) } as never; }
    catch (error) {
      if (error instanceof AuthError && error.code.startsWith('BLOG_')) return { ok: false, code: error.code, status: error.status };
      throw error;
    }
  };
}
export const blogContentRealm = defineDatabaseRealm({
  name: 'zero-blog-content', version: '1', tables: BLOG_CONTENT_TABLES,
  migrations: [{ version: '001', description: 'Versioned private drafts, public snapshots, taxonomies, media and indexed search', safety: 'safe',
    up(database) {
      for (const [table, columns] of Object.entries(BLOG_CONTENT_TABLES)) database.run('CREATE TABLE IF NOT EXISTS ' + quoteSqlIdentifier(table) + ' (' + Object.entries(columns).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition).join(',') + ')');
      database.run('CREATE INDEX blog_post_page ON blog_posts(site_id,updated_at DESC,id)');
      database.run('CREATE INDEX blog_post_owner_page ON blog_posts(site_id,created_by,updated_at DESC,id)');
      database.run('CREATE INDEX blog_post_status_page ON blog_posts(site_id,status,updated_at DESC,id)');
      database.run('CREATE UNIQUE INDEX blog_public_slug ON blog_publications(site_id,slug)');
      database.run('CREATE INDEX blog_public_page ON blog_publications(site_id,published_at DESC,id)');
      database.run('CREATE INDEX blog_revision_page ON blog_revisions(site_id,post_id,revision DESC)');
      database.run('CREATE INDEX blog_term_page ON blog_terms(site_id,kind,name,id)');
      database.run('CREATE INDEX blog_term_parent ON blog_terms(parent_id)');
      database.run('CREATE INDEX blog_terms_by_term ON blog_post_terms(site_id,term_id,published,post_id)');
      database.run('CREATE INDEX blog_media_by_asset ON blog_post_media(site_id,media_id,published,post_id)');
      database.run('CREATE INDEX blog_media_library ON blog_media(site_id,state,created_at DESC,id)');
      database.run('CREATE INDEX blog_media_recovery ON blog_media(state,expires_at,created_at,id)');
      database.run('CREATE INDEX blog_metric_expiry ON _blog_metric_receipts(expires_at)');
      database.run('CREATE INDEX blog_metric_page ON _blog_metrics(site_id,post_id,day)');
      database.run('CREATE INDEX blog_metric_day ON _blog_metrics(day,id)');
      database.run("CREATE TRIGGER blog_metric_retention AFTER INSERT ON _blog_metric_receipts BEGIN DELETE FROM _blog_metric_receipts WHERE id IN(SELECT id FROM _blog_metric_receipts WHERE expires_at<NEW.recorded_at ORDER BY expires_at LIMIT 1000); DELETE FROM _blog_metrics WHERE id IN(SELECT id FROM _blog_metrics WHERE day<NEW.retention_day ORDER BY day LIMIT 1000); END");
      database.run("CREATE TRIGGER blog_revision_no_update BEFORE UPDATE ON blog_revisions BEGIN SELECT RAISE(ABORT,'Blog revisions are append-only'); END");
      database.run("CREATE TRIGGER blog_revision_no_delete BEFORE DELETE ON blog_revisions BEGIN SELECT RAISE(ABORT,'Blog revisions are append-only'); END");
      database.run("CREATE TRIGGER blog_term_delete_guard BEFORE DELETE ON blog_terms WHEN EXISTS(SELECT 1 FROM blog_post_terms WHERE term_id=OLD.id) OR EXISTS(SELECT 1 FROM blog_terms WHERE parent_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Blog taxonomy is referenced'); END");
      database.run("CREATE TRIGGER blog_media_delete_guard BEFORE DELETE ON blog_media WHEN EXISTS(SELECT 1 FROM blog_post_media WHERE media_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Blog media is referenced'); END");
      database.run("CREATE TRIGGER blog_media_retire_guard BEFORE UPDATE OF state ON blog_media WHEN NEW.state!='ready' AND EXISTS(SELECT 1 FROM blog_post_media WHERE media_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Blog media is referenced'); END");
      for (const [content, search] of [['blog_posts', 'blog_draft_search'], ['blog_publications', 'blog_public_search']]) {
        database.run(`CREATE VIRTUAL TABLE ${search} USING fts5(title,excerpt,body,content='${content}',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2',prefix='2 3')`);
        database.run(`INSERT INTO ${search}(${search},rank) VALUES('rank','bm25(8.0,3.0,1.0)')`);
        database.run(`CREATE TRIGGER ${search}_insert AFTER INSERT ON ${content} BEGIN INSERT INTO ${search}(rowid,title,excerpt,body) VALUES(NEW.rowid,NEW.title,NEW.excerpt,NEW.body); END`);
        database.run(`CREATE TRIGGER ${search}_delete AFTER DELETE ON ${content} BEGIN INSERT INTO ${search}(${search},rowid,title,excerpt,body) VALUES('delete',OLD.rowid,OLD.title,OLD.excerpt,OLD.body); END`);
        database.run(`CREATE TRIGGER ${search}_update AFTER UPDATE OF title,excerpt,body ON ${content} BEGIN INSERT INTO ${search}(${search},rowid,title,excerpt,body) VALUES('delete',OLD.rowid,OLD.title,OLD.excerpt,OLD.body); INSERT INTO ${search}(rowid,title,excerpt,body) VALUES(NEW.rowid,NEW.title,NEW.excerpt,NEW.body); END`);
      }
    },
  }],
  commands: { 'blog.owner.bind': (context, input) => contentCommand(context, () => {
    const ownerId = blogId(blogRecord(input, ['ownerId']).ownerId), row = context.db.get('_blog_owner', 'application');
    if (row && row.owner_id !== ownerId) fail('BLOG_CONTENT_OWNER_CONFLICT');
    if (!row) context.db.createStrict('_blog_owner', { id: 'application', owner_id: ownerId });
    return { bound: true };
  }), 'blog.post.create': createBlogPost, 'blog.post.update': updateBlogPost, 'blog.post.publish': publishBlogPost,
    'blog.post.state': changeBlogPostState, 'blog.post.restore': restoreBlogPost, 'blog.term.write': writeBlogTerm, 'blog.term.remove': removeBlogTerm,
    'blog.media.allocate': allocateBlogMedia, 'blog.media.accept': acceptBlogMedia, 'blog.media.retire': retireBlogMedia, 'blog.media.clean': cleanBlogMediaStage, 'blog.metrics.record': recordBlogMetric },
  queries: { 'blog.posts': query(queryBlogPosts), 'blog.post': query(readBlogPost), 'blog.public.post': query(readPublishedBlogPost), 'blog.public.sitemap': query(queryBlogSitemap), 'blog.public.taxonomy-sitemap': query(queryBlogTaxonomySitemap), 'blog.public.term': query(readPublicBlogTerm), 'blog.public.terms': query(readPublicBlogTerms), 'blog.terms': query(queryBlogTerms), 'blog.revisions': query(queryBlogRevisions), 'blog.revision': query(readBlogRevision),
    'blog.media': query(readBlogMedia), 'blog.media.list': query(listBlogMedia), 'blog.media.public': query(publicBlogMedia), 'blog.media.pending': query(pendingBlogMedia), 'blog.media.next-expiry': query(nextBlogMediaExpiry), 'blog.metrics': query(queryBlogMetrics),
    'blog.public.identity': query(({ database }, input) => {
      const r = blogRecord(input, ['siteId', 'slug']);
      const row = database.query('SELECT id,public_revision FROM blog_publications WHERE site_id=? AND slug=?').get(blogId(r.siteId), blogId(r.slug));
      if (!row) fail('BLOG_POST_NOT_FOUND', 404); return row;
    }) },
});
