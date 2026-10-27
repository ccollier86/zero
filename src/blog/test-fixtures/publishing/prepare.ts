/** Prepare real source-created SYSTEM/application/blog/logging/Storage state before compiled startup. Synthetic identities only. */
import { createApp } from '@zero/framework/server';
import { createClient } from '@zero/framework';
import sharp from 'sharp';
import config from './zero.config';
import { publishingAuditHeartbeat } from './audit-heartbeat';

const app = await createApp(config); app.listen({ hostname: '127.0.0.1', port: 0 });
const client = createClient({ url: 'http://127.0.0.1:' + app.server!.port, auth: true, autoConnect: false });
let delivery: Awaited<ReturnType<typeof publishingAuditHeartbeat>> | undefined;
try {
  await client.register({ username: 'installed-publisher', email: 'installed-publisher@example.test', password: 'Synthetic-publishing-only-123' });
  delivery = await publishingAuditHeartbeat(client);
  const assigned = await client.blog.authors.assign({ userId: client.user!.userId, expectedRevision: 0 });
  const profile = await client.blog.authors.updateProfile(client.user!.userId, { expectedRevision: assigned.revision, changes: { displayName: 'Installed Public Writer', slug: 'installed-publisher', avatar: null } });
  await client.blog.authors.publishProfile(client.user!.userId, profile.revision);
  const allocated = await client.blog.media.allocate({ kind: 'image', fileName: 'synthetic.png', mimeType: 'image/png' }, { requestId: 'allocate-source' });
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#526f67' } }).png().toBuffer();
  await delivery.confirm();
  const media = await client.blog.media.upload(allocated.id, new Blob([Uint8Array.from(bytes).buffer]), { requestId: 'upload-source' });
  const draft = await client.blog.posts.create({ title: 'Installed publishing works', slug: 'installed-publishing', authorId: assigned.id,
    excerpt: 'A retained source publication.', categoryIds: [], tagIds: [], featuredImage: { mediaId: media.id, alt: 'Synthetic green image' },
    document: { version: 1, blocks: [{ id: 'intro', type: 'heading', level: 2, content: [{ text: 'A durable beginning' }] }, { id: 'p1', type: 'paragraph', content: [{ text: 'Orchids flourish.', bold: true }] }] },
    seo: { title: 'Installed SEO title', description: 'Accepted public SEO text.', noIndex: false, socialImage: null } }, { requestId: 'create-source' });
  const published = await client.blog.posts.publish(draft.id, draft.revision, { requestId: 'publish-source' });
  await Bun.write('./state/expected.json', JSON.stringify({ userId: client.user!.userId, postId: published.id, mediaId: media.id, revision: published.revision }));
} finally { try { await delivery?.stop(); } finally { client.disconnect(); await app.stop(true); } }
