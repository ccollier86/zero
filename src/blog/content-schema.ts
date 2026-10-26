/** Fixed private Fabric schema. SYSTEM retains identities; Storage retains bytes; this realm owns editorial state. */
import type { TableSchema } from '../sync/types';
export const BLOG_CONTENT_TABLES: Record<string, TableSchema> = {
  _blog_owner: { id: 'TEXT PRIMARY KEY', owner_id: 'TEXT NOT NULL' },
  blog_posts: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL', public_revision: 'INTEGER NOT NULL', status: 'TEXT NOT NULL',
    created_by: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL', published_at: 'INTEGER',
    title: 'TEXT NOT NULL', slug: 'TEXT NOT NULL', excerpt: 'TEXT NOT NULL', author_id: 'TEXT NOT NULL', body: 'TEXT NOT NULL',
    draft_json: 'TEXT NOT NULL', draft_hash: 'TEXT NOT NULL', published_hash: 'TEXT' },
  blog_publications: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', public_revision: 'INTEGER NOT NULL', published_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL',
    title: 'TEXT NOT NULL', slug: 'TEXT NOT NULL', excerpt: 'TEXT NOT NULL', author_id: 'TEXT NOT NULL', author_name: 'TEXT NOT NULL', body: 'TEXT NOT NULL', content_json: 'TEXT NOT NULL', no_index: 'INTEGER NOT NULL' },
  blog_revisions: { id: 'TEXT PRIMARY KEY', post_id: 'TEXT NOT NULL', site_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL', actor_id: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL', action: 'TEXT NOT NULL', content_json: 'TEXT NOT NULL' },
  blog_post_slugs: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', slug: 'TEXT NOT NULL', post_id: 'TEXT NOT NULL', published: 'INTEGER NOT NULL' },
  blog_terms: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', slug: 'TEXT NOT NULL', name: 'TEXT NOT NULL', description: 'TEXT NOT NULL', parent_id: 'TEXT', revision: 'INTEGER NOT NULL', seo_title: 'TEXT', seo_description: 'TEXT', no_index: 'INTEGER NOT NULL' },
  blog_term_slugs: { id: 'TEXT PRIMARY KEY', term_id: 'TEXT NOT NULL' },
  blog_post_terms: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', post_id: 'TEXT NOT NULL', term_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', published: 'INTEGER NOT NULL' },
  blog_media: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', owner_id: 'TEXT NOT NULL', state: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', mime_type: 'TEXT NOT NULL',
    file_name: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL', expires_at: 'INTEGER NOT NULL', checksum: 'TEXT', size_bytes: 'INTEGER', width: 'INTEGER', height: 'INTEGER', staging_cleanup: 'INTEGER NOT NULL' },
  blog_post_media: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', post_id: 'TEXT NOT NULL', media_id: 'TEXT NOT NULL', published: 'INTEGER NOT NULL' },
  blog_activity: { id: 'TEXT PRIMARY KEY', actor_id: 'TEXT NOT NULL', site_id: 'TEXT NOT NULL', action: 'TEXT NOT NULL', post_id: 'TEXT', revision: 'INTEGER NOT NULL', created_at: 'INTEGER NOT NULL' },
  _blog_metric_receipts: { id: 'TEXT PRIMARY KEY', digest: 'TEXT NOT NULL', expires_at: 'INTEGER NOT NULL', recorded_at: 'INTEGER NOT NULL', retention_day: 'TEXT NOT NULL' },
  _blog_metrics: { id: 'TEXT PRIMARY KEY', site_id: 'TEXT NOT NULL', post_id: 'TEXT NOT NULL', day: 'TEXT NOT NULL', views: 'INTEGER NOT NULL', engagements: 'INTEGER NOT NULL', visible_ms: 'INTEGER NOT NULL' },
};
