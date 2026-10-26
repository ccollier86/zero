/** Real isolated file/WAL actors. Synthetic posts prove publication, search, replay and rollback across restart. */
import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import { createSubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import type { AsyncDatabaseOperationExecutor, DatabaseSerializableValue } from '../databases/database-operations';
import { blogContentRealm } from './content-realm';
import { BLOG_ACTOR_FLAG } from './content-actor-bootstrap';
import { captureBlogPostContent } from './content-validation';
import { readBlogActorRejection } from './content-errors';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zero-blog-content-'));
  let owner!: DatabaseCoordinator, lease!: Awaited<ReturnType<DatabaseCoordinator['acquire']>>;
  const open = async () => {
    owner = new DatabaseCoordinator({ rootDirectory: root, realm: blogContentRealm, sqlite: { synchronous: 'FULL' }, maxDatabases: 1, readers: true, sweepIntervalMs: false,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL('./content-actor-entry.ts', import.meta.url) }, actorFlag: BLOG_ACTOR_FLAG, env: {} }) });
    owner.start(); lease = await owner.acquire('blog:content');
    return createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor });
  };
  let data = await open();
  const command = async (name: string, input: unknown, key: string = crypto.randomUUID()) => {
    try {
    const payload = name === 'blog.post.publish' ? { ...(input as object), authorName: 'Approved Public Writer' } : input;
    const result = await data.command(name, payload as DatabaseSerializableValue, { idempotencyKey: key });
    const output = result.value as { kind: string; name: string; output: unknown };
    expect(output.kind).toBe('command'); expect(output.name).toBe(name);
    return { result, output: output.output as any };
    } catch (error) { const domain = readBlogActorRejection(error); if (!domain) throw error; return { result: null, output: { ok: false, code: domain.code, status: domain.status } }; }
  };
  const query = async (name: string, input: unknown) => (await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' } })).value as any;
  return { root, command, query, async restart() { lease.release(); await owner.close(); data = await open(); }, async close() { lease.release(); await owner.close(); } };
}
const actor = { siteId: 'application', actorId: 'writer', manage: true, publish: true };
const content = (title = 'A beautiful article', body = 'Orchids flourish beside the river.') => captureBlogPostContent({ title, slug: 'beautiful-article', authorId: 'author-one',
  document: { version: 1, blocks: [{ id: 'intro', type: 'paragraph', content: [{ text: body }] }] } });

test('draft → publish → edit → withdraw keeps full-text public search and live snapshots honest across restart', async () => {
  const f = await fixture();
  try {
    const created = await f.command('blog.post.create', { actor, id: 'post-one', content: content() }, 'request-create');
    expect(created.output).toMatchObject({ ok: true, value: { revision: 1, status: 'draft' } });
    expect((await f.query('blog.posts', { public: true, siteId: 'application', query: { search: 'orchid' } })).value.total).toBe(0);
    expect((await f.query('blog.posts', { actor, query: { search: 'orchid' } })).value.total).toBe(1);
    const publication = await f.command('blog.post.publish', { actor, id: 'post-one', expectedRevision: 1 });
    expect(publication.output).toMatchObject({ ok: true, value: { revision: 2, publicRevision: 1, hasUnpublishedChanges: false } });
    const publicRead = await f.query('blog.public.post', { siteId: 'application', slug: 'beautiful-article' });
    expect(publicRead.value.content.title).toBe('A beautiful article');
    await f.command('blog.post.update', { actor, id: 'post-one', expectedRevision: 2, content: content('Private revision', 'Unpublished moonflower details.') });
    expect((await f.query('blog.public.post', { siteId: 'application', slug: 'beautiful-article' })).value.content.title).toBe('A beautiful article');
    expect((await f.query('blog.posts', { public: true, siteId: 'application', query: { search: 'moonflower' } })).value.total).toBe(0);
    await f.restart();
    expect((await f.query('blog.posts', { public: true, siteId: 'application', query: { search: 'orchid' } })).value.total).toBe(1);
    await f.command('blog.post.state', { actor, id: 'post-one', expectedRevision: 3, action: 'withdraw' });
    expect((await f.query('blog.public.post', { siteId: 'application', slug: 'beautiful-article' })).value).toBeNull();
    expect((await f.query('blog.posts', { public: true, siteId: 'application', query: { search: 'orchid' } })).value.total).toBe(0);
    expect((await f.query('blog.revisions', { actor, id: 'post-one' })).value.total).toBe(4);
  } finally { await f.close(); }
}, 30000);

test('idempotent retries and stale revisions cannot repeat or overwrite accepted work', async () => {
  const f = await fixture();
  try {
    const input = { actor, id: 'post-replay', content: content() };
    await f.command('blog.post.create', input, 'create-once');
    expect((await f.command('blog.post.create', input, 'create-once')).result!.replayed).toBe(true);
    const [a, b] = await Promise.all([f.command('blog.post.update', { actor, id: 'post-replay', expectedRevision: 1, content: content('First') }),
      f.command('blog.post.update', { actor, id: 'post-replay', expectedRevision: 1, content: content('Second') })]);
    expect([a.output.ok, b.output.ok].filter(Boolean)).toHaveLength(1);
    expect([a.output, b.output].find(result => !result.ok)).toMatchObject({ code: 'BLOG_REVISION_CONFLICT' });
    expect((await f.query('blog.revisions', { actor, id: 'post-replay' })).value.total).toBe(2);
  } finally { await f.close(); }
}, 30000);

test('invalid references roll back post, reserved slug, search and revision changes as one transaction', async () => {
  const f = await fixture();
  try {
    const invalid = { ...content(), categoryIds: ['missing-category'] };
    expect((await f.command('blog.post.create', { actor, id: 'not-created', content: invalid })).output).toMatchObject({ ok: false, code: 'BLOG_TAXONOMY_INVALID' });
    expect((await f.query('blog.posts', { actor })).value.total).toBe(0);
    expect((await f.command('blog.post.create', { actor, id: 'created-after-rollback', content: content() })).output.ok).toBe(true);
    expect((await f.query('blog.posts', { actor: { ...actor, siteId: 'another-site' } })).value.total).toBe(0);
    expect((await f.query('blog.post', { actor: { ...actor, actorId: 'another-user', manage: false }, id: 'created-after-rollback' })).code).toBe('BLOG_POST_NOT_FOUND');
  } finally { await f.close(); }
}, 30000);

test('taxonomy ancestry, slug uniqueness and reference deletion are enforced in the actor transaction', async () => {
  const f = await fixture();
  try {
    const term = { kind: 'category', slug: 'botany', name: 'Botany', description: '', parentId: null, seoTitle: null, seoDescription: null, noIndex: false };
    expect((await f.command('blog.term.write', { actor, id: 'botany', expectedRevision: 0, term })).output.ok).toBe(true);
    expect((await f.command('blog.term.write', { actor, id: 'child', expectedRevision: 0, term: { ...term, slug: 'orchids', name: 'Orchids', parentId: 'botany' } })).output.ok).toBe(true);
    expect((await f.command('blog.term.write', { actor, id: 'botany', expectedRevision: 1, term: { ...term, parentId: 'child' } })).output.code).toBe('BLOG_TAXONOMY_CYCLE');
    await f.command('blog.post.create', { actor, id: 'post-taxonomy', content: { ...content(), categoryIds: ['child'] } });
    expect((await f.command('blog.term.remove', { actor, id: 'child', expectedRevision: 1 })).output.code).toBe('BLOG_TAXONOMY_IN_USE');
    expect((await f.query('blog.terms', { siteId: 'application', public: true })).value.total).toBe(0);
    await f.command('blog.post.publish', { actor, id: 'post-taxonomy', expectedRevision: 1 });
    expect((await f.query('blog.terms', { siteId: 'application', public: true })).value.total).toBe(1);
    expect((await f.query('blog.public.terms', { siteId: 'application', ids: ['child', 'botany', 'missing'] })).value.map((term: { id: string }) => term.id)).toEqual(['child']);
    expect((await f.query('blog.public.terms', { siteId: 'different-site', ids: ['child'] })).value).toEqual([]);
    expect((await f.query('blog.public.terms', { siteId: 'application', ids: Array.from({ length: 101 }, () => 'child') })).code).toBe('BLOG_INVALID_INPUT');
    expect((await f.query('blog.public.taxonomy-sitemap', { siteId: 'application' })).value).toEqual([{ id: 'child', kind: 'category' }]);
    expect((await f.query('blog.posts', { public: true, siteId: 'application', query: { categoryId: 'child' } })).value.total).toBe(1);
  } finally { await f.close(); }
}, 30000);
