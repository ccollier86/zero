/** Install the frozen candidate, then use only public package contracts in a fresh consumer. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
test('installed author backend and SDK compose safely and browser imports stay server-free', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'blog-author-package-'));
  const consumer = join(root, 'consumer');
  const archive =
    process.env.ZERO_BLOG_AUTHOR_PACKAGE_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    if (process.env.ZERO_BLOG_AUTHOR_PACKAGE_ARCHIVE) {
      if (!(await Bun.file(archive).exists()))
        throw new Error(
          'The supplied author qualification archive does not exist.',
        );
    } else
      await run(
        ['pm', 'pack', '--ignore-scripts', '--filename', archive],
        process.cwd(),
      );
    await Bun.write(
      join(consumer, 'package.json'),
      JSON.stringify({
        name: 'zero-author-public-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@zero/framework': `file:${archive}`,
          react: '19.2.4',
          'react-dom': '19.2.4',
        },
      }),
    );
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(
      join(consumer, 'photo.png'),
      await sharp({
        create: { width: 80, height: 80, channels: 3, background: '#334455' },
      })
        .png()
        .toBuffer(),
    );
    await Bun.write(
      join(consumer, 'browser.ts'),
      `export { createPublicBlogClient, BLOG_API } from '@zero/framework/blog/client';
      export { createClient } from '@zero/framework';`,
    );
    await run(
      ['install', '--ignore-scripts', '--backend=hardlink'],
      consumer,
      180000,
    );
    const output = await run(['verify.ts'], consumer, 120000);
    const result = JSON.parse(output.trim().split('\n').at(-1)!) as Record<
      string,
      any
    >;
    expect(result.name).toBe('Installed Public Author');
    expect(result.roleUnchanged).toBe(true);
    expect(result.privateFieldsAbsent).toBe(true);
    expect(result.scopedServer).toBe(true);
    expect(result.privateProfileEditable).toBe(true);
    expect(result.withdrawn).toBe(true);
    expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.docs).toBe(true);
    expect(result.publicPhotoServed).toBe(true);
    expect(result.avatarWithdrawn).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 300000);

async function run(
  args: string[],
  cwd: string,
  timeoutMs = 90000,
): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH,
      TMPDIR: SCRATCH,
      BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache',
    },
  });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    child.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (expired || code !== 0)
      throw new Error(
        `Installed author consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

const VERIFY = `
import { createApp, defineEndpoint } from '@zero/framework/server';
import { createClient } from '@zero/framework';
import { createPublicBlogClient } from '@zero/framework/blog/client';
import { resolveBlogConfig, type BlogConfig } from '@zero/framework/blog/server';
import { mkdir } from 'node:fs/promises';
const root = process.cwd(); await mkdir(root + '/app');
const blog: BlogConfig = {};
if (typeof resolveBlogConfig !== 'function') throw new Error('Missing public config resolver');
const app = await createApp({ db: { mode: 'memory' }, systemDb: { mode: 'memory' }, tables: {}, auth: { bootstrap: 'public' }, blog,
  appDir: root + '/app', outDir: root + '/out', generatedDir: root + '/generated', storageDir: root + '/storage',
  themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
  serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
  workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false, observability: { console: false, endpoint: false },
  serverExtensions: [defineEndpoint({ method: 'GET', path: '/proof/author', auth: 'user', handler: ({ zero }) => zero.blog!.capabilities() })],
});
app.listen({ hostname: '127.0.0.1', port: 0 });
const origin = 'http://127.0.0.1:' + app.server!.port;
const client = createClient({ url: origin, auth: true, autoConnect: false });
try {
  await client.register({ username: 'installed-author', email: 'private-installed@example.test', password: 'Synthetic-only-password-123' });
  const user = client.user!;
  const profile = await client.userProfile.get();
  const privateProfile = await client.userProfile.update({ expectedRevision: profile.revision, changes: { bio: 'Private account biography' } });
  const uploaded = await client.userAvatar.replace(new Blob([await Bun.file('./photo.png').arrayBuffer()], { type: 'image/png' }), privateProfile.revision);
  if (uploaded.publicAsset !== null) throw new Error('An upload must not publish the account photo.');
  const publicPhoto = await client.userAvatar.publish(uploaded.revision);
  const scoped = await client.fetch('/proof/author') as any;
  const assigned = await client.blog.authors.assign({ userId: user.userId, expectedRevision: 0 });
  const draft = await client.blog.authors.updateProfile(user.userId, { expectedRevision: assigned.revision, changes: { displayName: 'Installed Public Author', slug: 'installed-author', avatar: 'account' } });
  const published = await client.blog.authors.publishProfile(user.userId, draft.revision);
  const publicBlog = createPublicBlogClient(origin), author = await publicBlog.author('blog', 'installed-author');
  const photo = await fetch(origin + author.avatar!.deliveryPath);
  const publicPhotoServed = photo.status === 200 && photo.headers.get('content-type') === 'image/webp' && (await photo.arrayBuffer()).byteLength > 0;
  await client.blog.authors.withdrawProfile(user.userId, published.revision);
  let withdrawn = false; try { await publicBlog.author('blog', 'installed-author'); } catch { withdrawn = true; }
  await client.userAvatar.withdraw(publicPhoto.revision);
  const removedPhoto = await fetch(origin + author.avatar!.deliveryPath), avatarWithdrawn = removedPhoto.status === 404;
  await removedPhoto.text();
  const build = await Bun.build({ entrypoints: ['./browser.ts'], target: 'browser', format: 'esm' });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
  const docsRoot = './node_modules/@zero/framework/docs-next/';
  const docs = await Bun.file(docsRoot + 'backend/blog/index.md').exists()
    && await Bun.file(docsRoot + 'backend/blog/upgrade.md').exists()
    && (await Bun.file(docsRoot + 'backend/guardian/avatars.md').text()).includes('publicAccess');
  console.log(JSON.stringify({ name: author.name, roleUnchanged: client.user?.role === user.role,
    privateFieldsAbsent: !JSON.stringify(author).includes('private-installed') && !JSON.stringify(author).includes('Private account biography') && !('userId' in author),
    privateProfileEditable: privateProfile.values.bio === 'Private account biography', scopedServer: scoped.state === 'ready' && scoped.canManageAuthors,
    withdrawn, publicPhotoServed, avatarWithdrawn, browserBytes: build.outputs.reduce((sum, output) => sum + output.size, 0), docs }));
} finally { client.disconnect(); await app.stop(true); }
`;
