/** Real managed startup + native HTTP + file/WAL actors. All identities and content are synthetic, with no production service access. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint, defineZeroPlugin } from '../frontend/server/server-extensions';
import type { ServerRouteServices } from '../frontend/server/server-services';
import type { AppConfig } from '../frontend/server/types';
import { createClient } from '../frontend/client/sdk';
import { createPublicBlogClient } from '../frontend/client/blog-client';
import sharp from 'sharp';
import type { BlogPostContent } from './content-types';

const PASSWORD = 'Synthetic-blog-only-password-123';
async function fixture(features: { metrics?: boolean; compliance?: boolean; tenancy?: 'single' | 'multi'; advanced?: boolean } = {}) {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-managed-');
  await mkdir(join(root, 'app'));
  let zero!: ServerRouteServices;
  const configuration: AppConfig = {
    projectRoot: root, db: { mode: 'file' as const, path: join(root, 'app.db'), synchronous: 'FULL' }, systemDb: { mode: 'file' as const, path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {},
    auth: { bootstrap: 'public' as const, tenancy: features.tenancy ?? 'single', authorization: { mode: features.advanced ? 'advanced' : 'simple' } }, blog: { pages: false, authors: { requireAvatar: false }, content: { metrics: { enabled: features.metrics === true } } },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    logging: { preset: features.compliance ? 'compliance' : 'detailed', rootDirectory: join(root, 'logs') },
    serverResourcesDir: false as const, serverPluginsDir: false as const, serverMiddlewareDir: false as const, serverEndpointsDir: false as const, serverRoutesDir: false as const,
    workflows: false as const, email: false as const, stateSync: false, ai: false as const, vector: false as const, pdf: false as const, kv: false as const,
    observability: { console: false, endpoint: false },
    serverExtensions: [defineZeroPlugin({ name: 'blog-content-proof', setup(context) { zero = context.zero; } }),
      defineEndpoint({ method: 'GET', path: '/proof/publishing', auth: 'user', handler: ({ zero }) => zero.blog!.posts.capabilities() })],
  };
  let app = await createApp(configuration);
  const start = () => { app.listen({ hostname: '127.0.0.1', port: 0 }); return `http://127.0.0.1:${app.server!.port}`; };
  let origin = start();
  const client = () => createClient({ url: origin, auth: true, autoConnect: false });
  return {
    root, client, get origin() { return origin; }, get zero() { return zero; },
    async restart() { await app.stop(true); app = await createApp(configuration); origin = start(); },
    async close() { await app.stop(true); },
  };
}
function content(authorId: string, title = 'Orchids in the garden', text = 'Beautiful orchids bloom beside the river.'): BlogPostContent {
  return { title, slug: 'orchids', authorId, excerpt: 'A short introduction.', categoryIds: [], tagIds: [], featuredImage: null,
    seo: { title: null, description: null, noIndex: false, socialImage: null }, document: { version: 1, blocks: [{ id: 'intro', type: 'paragraph', content: [{ text }] }] } };
}
async function enroll(client: ReturnType<typeof createClient>, name: string) {
  await client.register({ username: name, email: `${name}@example.test`, password: PASSWORD });
  const logging = await client.logging.collectionPolicy();
  if (logging.delivery) await client.logging.observe([], { policyVersion: logging.delivery.policyVersion });
  const assigned = await client.blog.authors.assign({ userId: client.user!.userId, expectedRevision: 0 });
  const draft = await client.blog.authors.updateProfile(client.user!.userId, { expectedRevision: assigned.revision, changes: { displayName: 'Approved Public Writer', slug: name, avatar: null } });
  await client.blog.authors.publishProfile(client.user!.userId, draft.revision);
  return assigned.id;
}

test('managed public facades preserve publication, private drafts, idempotency, actor logs and restart', async () => {
  const f = await fixture(); let editor = f.client();
  try {
    const authorId = await enroll(editor, 'managed-writer'), posts = editor.blog.posts;
    expect(await posts.capabilities()).toMatchObject({ state: 'ready', canCreate: true, canPublishOwn: true });
    expect(await editor.fetch('/proof/publishing')).toMatchObject({ state: 'ready', canCreate: true });
    const input = content(authorId), draft = await posts.create(input, { requestId: 'create-one' });
    expect((await posts.create(input, { requestId: 'create-one' })).id).toBe(draft.id);
    const anonymous = createPublicBlogClient(f.origin);
    expect((await anonymous.posts('blog', { search: 'orchid' })).total).toBe(0);
    const published = await posts.publish(draft.id, draft.revision, { requestId: 'publish-one' });
    expect((await anonymous.post('blog', 'orchids')).author.name).toBe('Approved Public Writer');
    const edited = await posts.update(draft.id, published.revision, content(authorId, 'Private heading', 'Confidential draft moonflowers.'), { requestId: 'edit-one' });
    expect((await anonymous.post('blog', 'orchids')).content.title).toBe('Orchids in the garden');
    expect((await anonymous.posts('blog', { search: 'moonflower' })).total).toBe(0);
    expect((await posts.list({ search: 'moonflower' })).total).toBe(1);
    await expect(posts.update(draft.id, 1, input, { requestId: 'stale-write' })).rejects.toBeDefined();
    expect((await posts.revisions(draft.id)).total).toBe(3);
    await f.zero.logging!.flush();
    const audit = await f.zero.logging!.page('audit', { kind: 'platform' }, { family: 'records', actorId: editor.user!.userId });
    expect(audit.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('Confidential draft');
    editor.disconnect(); await f.restart(); editor = f.client();
    await editor.login('managed-writer', PASSWORD);
    expect((await editor.blog.posts.get(draft.id)).revision).toBe(edited.revision);
    expect((await createPublicBlogClient(f.origin).posts('blog', { search: 'orchid' })).total).toBe(1);
    await editor.blog.posts.withdraw(draft.id, edited.revision, { requestId: 'withdraw-one' });
    expect((await createPublicBlogClient(f.origin).posts('blog')).total).toBe(0);
    await expect(createPublicBlogClient(f.origin).post('blog', 'orchids')).rejects.toBeDefined();
  } finally { editor.disconnect(); await f.close(); }
}, 90000);

test('unassigned users, forged authority, missing request identity and unpublished author profiles fail closed', async () => {
  const f = await fixture(), manager = f.client();
  try {
    const authorId = await enroll(manager, 'manager-writer');
    await manager.logout();
    await manager.register({ username: 'unassigned', email: 'unassigned@example.test', password: PASSWORD });
    expect((await manager.blog.posts.capabilities()).canCreate).toBe(false);
    await expect(manager.blog.posts.create(content(authorId), { requestId: 'forbidden' })).rejects.toBeDefined();
    await manager.logout(); await manager.login('manager-writer', PASSWORD);
    await expect(manager.fetch('/api/blog/posts', { method: 'POST', body: { ...content(authorId), actor: { manage: true } }, headers: { 'Idempotency-Key': 'forged' } })).rejects.toBeDefined();
    await expect(manager.fetch('/api/blog/posts', { method: 'POST', body: content(authorId) })).rejects.toBeDefined();
    const before = await manager.blog.posts.list(); expect(before.total).toBe(0);
    const me = manager.user!.userId, profile = await manager.blog.authors.get(me);
    await manager.blog.authors.withdrawProfile(me, profile.revision);
    const draft = await manager.blog.posts.create(content(authorId), { requestId: 'draft-permitted' });
    await expect(manager.blog.posts.publish(draft.id, draft.revision, { requestId: 'public-forbidden' })).rejects.toBeDefined();
    expect((await createPublicBlogClient(f.origin).posts('blog')).total).toBe(0);
  } finally { manager.disconnect(); await f.close(); }
}, 90000);

test('real private image upload normalizes bytes, published references gate anonymous delivery, and referenced media cannot be removed', async () => {
  const f = await fixture(), client = f.client();
  try {
    const authorId = await enroll(client, 'media-writer');
    const allocated = await client.blog.media.allocate({ kind: 'image', fileName: 'synthetic-garden.png', mimeType: 'image/png' }, { requestId: 'allocate-image' });
    const image = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#345678' } }).png().toBuffer();
    const ready = await client.blog.media.upload(allocated.id, new Blob([Uint8Array.from(image).buffer], { type: 'image/png' }), { requestId: 'upload-image' });
    expect(ready).toMatchObject({ id: allocated.id, state: 'ready', mimeType: 'image/webp', width: 90, height: 60 });
    const browserPreview = await client.blog.media.imagePreview(ready.id);
    expect(browserPreview.type).toBe('image/webp'); expect(browserPreview.size).toBe(ready.sizeBytes!);
    const preview = await client.fetch<Response>(ready.previewPath!, { json: false });
    expect(preview.status).toBe(200); expect(preview.headers.get('Content-Type')).toBe('image/webp');
    await preview.arrayBuffer();
    const publicPath = `/api/blog/public/blog/posts/orchids/media/${ready.id}`;
    expect((await fetch(f.origin + publicPath)).status).toBe(404);
    const input = { ...content(authorId), featuredImage: { mediaId: ready.id, alt: 'A synthetic blue rectangle' } };
    const draft = await client.blog.posts.create(input, { requestId: 'image-post' });
    await expect(client.blog.media.remove(ready.id, { requestId: 'reject-remove' })).rejects.toBeDefined();
    const published = await client.blog.posts.publish(draft.id, draft.revision, { requestId: 'image-publish' });
    const delivered = await fetch(f.origin + publicPath); expect(delivered.status).toBe(200);
    expect(delivered.headers.get('Cache-Control')).toContain('no-store');
    expect((await delivered.arrayBuffer()).byteLength).toBe(ready.sizeBytes!);
    const partial = await fetch(f.origin + publicPath, { headers: { Range: 'bytes=0-15' } });
    expect(partial.status).toBe(206); expect(partial.headers.get('Content-Range')).toBe(`bytes 0-15/${ready.sizeBytes}`);
    expect((await partial.arrayBuffer()).byteLength).toBe(16);
    await client.blog.posts.withdraw(draft.id, published.revision, { requestId: 'image-withdraw' });
    expect((await fetch(f.origin + publicPath)).status).toBe(404);
    expect((await client.blog.media.list()).items[0]!.id).toBe(ready.id);
    await expect(client.blog.media.allocate({ kind: 'image', fileName: 'bad.svg', mimeType: 'image/svg+xml' }, { requestId: 'svg-reject' })).rejects.toBeDefined();
  } finally { client.disconnect(); await f.close(); }
}, 90000);

test('live publishing snapshots coalesce committed changes and stop at SDK identity retirement', async () => {
  const f = await fixture(), client = f.client(); let stop: (() => void) | undefined;
  try {
    const authorId = await enroll(client, 'live-publishing');
    const snapshots: number[] = [], errors: unknown[] = [];
    let accepted!: () => void;
    const changed = new Promise<void>(resolve => { accepted = resolve; });
    stop = client.blog.watchPosts(page => { snapshots.push(page.total); if (page.total === 1) accepted(); }, { onError: error => errors.push(error) });
    await client.blog.posts.create(content(authorId), { requestId: 'live-create' });
    await Promise.race([changed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No accepted publishing projection.')), 5000))]);
    expect(snapshots.at(-1)).toBe(1); expect(errors).toEqual([]);
    client.blog.clear(); const before = snapshots.length;
    await Bun.sleep(100); expect(snapshots.length).toBe(before);
  } finally { stop?.(); client.disconnect(); await f.close(); }
}, 90000);

test('optional aggregate observations are signed, replay-safe, bounded and separate from author/account audit data', async () => {
  const f = await fixture({ metrics: true }), client = f.client();
  let stopPost: (() => void) | undefined, stopMetrics: (() => void) | undefined;
  try {
    const authorId = await enroll(client, 'metric-writer');
    const draft = await client.blog.posts.create(content(authorId), { requestId: 'metric-post' });
    const published = await client.blog.posts.publish(draft.id, draft.revision, { requestId: 'metric-publish' });
    const publicBlog = createPublicBlogClient(f.origin), ticket = await publicBlog.metricTicket('blog', 'orchids');
    let changedPost!: () => void, changedMetrics!: () => void;
    const postChanged = new Promise<void>(resolve => { changedPost = resolve; }), metricsChanged = new Promise<void>(resolve => { changedMetrics = resolve; });
    const observed: number[] = [], revisions: number[] = [], errors: unknown[] = [];
    stopPost = client.blog.watchPost(draft.id, value => { revisions.push(value.revision); if (value.revision > published.revision) changedPost(); }, { onError: error => errors.push(error) });
    stopMetrics = client.blog.watchMetrics(value => { const views = value.items[0]?.views ?? 0; observed.push(views); if (views === 1) changedMetrics(); }, { query: { postId: draft.id }, onError: error => errors.push(error) });
    const observation = { kind: 'view' as const, observedAt: Date.now(), visibleMs: 0 };
    await publicBlog.observe('blog', 'orchids', ticket.ticket, observation);
    await publicBlog.observe('blog', 'orchids', ticket.ticket, observation);
    await Promise.race([metricsChanged, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No live metric projection.')), 5000))]);
    expect(observed.at(-1)).toBe(1);
    expect((await client.blog.metrics.page({ postId: draft.id })).items[0]!.views).toBe(1);
    await expect(publicBlog.observe('blog', 'orchids', ticket.ticket.slice(0, -2) + 'ab', observation)).rejects.toBeDefined();
    await expect(publicBlog.observe('blog', 'orchids', ticket.ticket, { ...observation, visibleMs: 1000000000 })).rejects.toBeDefined();
    const page = await client.blog.metrics.page();
    expect(JSON.stringify(page)).not.toContain(client.user!.userId);
    expect(JSON.stringify(page)).not.toContain('metric-writer@example.test');
    await client.blog.posts.withdraw(draft.id, published.revision, { requestId: 'metric-withdraw' });
    await Promise.race([postChanged, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No exact-record live projection.')), 5000))]);
    expect(revisions.at(-1)).toBeGreaterThan(published.revision); expect(errors).toEqual([]);
    await expect(publicBlog.observe('blog', 'orchids', ticket.ticket, { kind: 'engagement', observedAt: Date.now(), visibleMs: 1 })).rejects.toBeDefined();
  } finally { stopPost?.(); stopMetrics?.(); client.disconnect(); await f.close(); }
}, 90000);

test('strict delivery remains required for private publishing but never gates an actually selected public route', async () => {
  const f = await fixture({ compliance: true }), client = f.client();
  try {
    const authorId = await enroll(client, 'strict-blogger');
    const draft = await client.blog.posts.create(content(authorId), { requestId: 'strict-draft' });
    await client.blog.posts.publish(draft.id, draft.revision, { requestId: 'strict-publish' });
    f.zero.logging!.admission.invalidate();
    await expect(client.blog.posts.list()).rejects.toMatchObject({ status: 428 });
    expect(await client.fetch('/api/blog/public/blog/posts/orchids')).toMatchObject({ content: { title: 'Orchids in the garden' } });
    await expect(client.fetch('/proof/publishing')).rejects.toMatchObject({ status: 428 });
    const policy = await client.logging.collectionPolicy();
    await client.logging.observe([], { policyVersion: policy.delivery!.policyVersion });
    expect((await client.blog.posts.list()).total).toBe(1);
  } finally { client.disconnect(); await f.close(); }
}, 90000);

for (const tenancy of ['single', 'multi'] as const) for (const advanced of [false, true]) {
  test(`application-owned publishing preserves author boundaries in ${tenancy}/${advanced ? 'advanced' : 'simple'} across different customer organizations`, async () => {
    const f = await fixture({ tenancy, advanced }), client = f.client();
    try {
      await client.register({ username: 'matrix-manager', email: 'matrix-manager@example.test', password: PASSWORD, ...(tenancy === 'multi' ? { organizationName: 'Manager organization' } : {}) });
      const managerId = client.user!.userId;
      await client.logout();
      await client.register({ username: 'matrix-writer', email: 'matrix-writer@example.test', password: PASSWORD, ...(tenancy === 'multi' ? { organizationName: 'Writer organization' } : {}) });
      const writerId = client.user!.userId, writerRole = client.user!.role;
      await client.logout(); await client.login('matrix-manager', PASSWORD);
      const assignment = await client.blog.authors.assign({ userId: writerId, expectedRevision: 0 });
      const profile = await client.blog.authors.updateProfile(writerId, { expectedRevision: assignment.revision, changes: { displayName: 'Public Matrix Writer', slug: 'matrix-writer', avatar: null } });
      await client.blog.authors.publishProfile(writerId, profile.revision);
      const managersPost = await client.blog.posts.create(content(assignment.id), { requestId: 'manager-created' });
      expect(managersPost.createdBy).toBe(managerId);
      await client.logout(); await client.login('matrix-writer', PASSWORD);
      expect(client.user!.role).toBe(writerRole);
      expect((await client.blog.capabilities()).site!.slug).toBe('blog');
      expect((await client.blog.posts.capabilities())).toMatchObject({ canCreate: true, canManage: false });
      await expect(client.blog.posts.get(managersPost.id)).rejects.toBeDefined();
      await expect(client.blog.posts.update(managersPost.id, managersPost.revision, content(assignment.id), { requestId: 'overwrite-manager' })).rejects.toBeDefined();
      const mine = await client.blog.posts.create({ ...content(assignment.id), slug: 'my-article' }, { requestId: 'own-post' });
      expect((await client.blog.posts.list()).items.map(post => post.id)).toEqual([mine.id]);
      await client.blog.posts.publish(mine.id, mine.revision, { requestId: 'own-publish' });
      expect((await createPublicBlogClient(f.origin).post('blog', 'my-article')).author.name).toBe('Public Matrix Writer');
      await expect(client.blog.authors.assign({ userId: managerId, expectedRevision: 0 })).rejects.toBeDefined();
    } finally { client.disconnect(); await f.close(); }
  }, 90000);
}
