/** Public consumer acceptance against an official bundled server, repeated startup and matching retained source actors. */
import { createClient } from '@zero/framework';
import { createPublicBlogClient } from '@zero/framework/blog/client';
import { unlink } from 'node:fs/promises';
import { publishingAuditHeartbeat } from './audit-heartbeat';

async function checked(args: string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, ZERO_SYNTHETIC_PROVIDER_SECRET: 'fixture-only' } });
  const timer = setTimeout(() => child.kill(), 180000);
  try { const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Synthetic publishing command failed (${code}):\n${stdout}\n${stderr}`);
  } finally { clearTimeout(timer); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
if (!Bun.argv.includes('--resume')) await checked(['prepare.ts']);
await checked(['node_modules/@zero/framework/src/cli/run.ts', 'build']);
const expected = await Bun.file('./state/expected.json').json();
for (let generation = 0; generation < 2; generation++) {
  await unlink('./state/ready.json').catch(() => {});
  const server = Bun.spawn([process.execPath, '--no-env-file', 'dist/server.js'], { stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH, ZERO_SYNTHETIC_PROVIDER_SECRET: 'fixture-only' } });
  const stdout = new Response(server.stdout).text(), stderr = new Response(server.stderr).text();
  let client: ReturnType<typeof createClient> | undefined;
  let delivery: Awaited<ReturnType<typeof publishingAuditHeartbeat>> | undefined;
  try {
    const deadline = Date.now() + 60000;
    while (!await Bun.file('./state/ready.json').exists()) {
      if (server.exitCode !== null) throw new Error(`Bundled publishing boot failed:\n${await stdout}\n${await stderr}`);
      if (Date.now() > deadline) throw new Error('Bundled publishing boot timed out.');
      await Bun.sleep(100);
    }
    const { port } = await Bun.file('./state/ready.json').json(), origin = 'http://127.0.0.1:' + port;
    const anonymous = createPublicBlogClient(origin);
    assert((await anonymous.posts('blog', { search: 'orchid' })).total === 1, 'Installed public FTS must survive source-to-bundle and restart.');
    const html = await (await fetch(origin + '/blog/installed-publishing')).text();
    assert(html.includes('Installed SEO title') && html.includes('BlogPosting') && html.includes('zero-blog-toc-sidebar'), 'Installed managed SSR metadata and default reader are required.');
    client = createClient({ url: origin, auth: true, autoConnect: false }); await client.login('installed-publisher', 'Synthetic-publishing-only-123');
    assert(client.user!.userId === expected.userId, 'Identity must survive source-to-bundle and restart.');
    let rejected = false; try { await client.blog.posts.get(expected.postId); } catch (failure) { rejected = (failure as { status?: number }).status === 428; }
    assert(rejected, 'Strict private admission must still reject a session without current delivery proof.');
    const signedPublic = await client.fetch<Response>('/blog/installed-publishing', { json: false });
    assert(signedPublic.status === 200 && (await signedPublic.text()).includes('Installed SEO title'), 'A selected public HTML route must not become an audit gate for a signed-in reader.');
    delivery = await publishingAuditHeartbeat(client);
    const post = await client.blog.posts.get(expected.postId);
    assert(post.revision === expected.revision, 'Retained revision must survive source-to-bundle.');
    const preview = await client.blog.media.imagePreview(expected.mediaId); assert(preview.type === 'image/webp' && preview.size > 0, 'Installed native image transport and private preview are required.');
    const page = await client.logging.page('audit', { family: 'records', actorId: expected.userId });
    assert(page.events.length > 0, 'Blog transaction evidence must be retained and readable through the supported API.');
    const index = await (await fetch(origin + '/sitemap.xml')).text(); assert(index.includes('/blog/installed-publishing'), 'Installed public discovery is required.');
    assert((await client.blog.posts.revisions(expected.postId)).total === 2, 'Immutable history must survive restart.');
  } finally {
    try { await delivery?.stop(); } finally {
      client?.disconnect(); server.kill('SIGTERM');
      const timeout = setTimeout(() => server.kill('SIGKILL'), 10000);
      await server.exited; clearTimeout(timeout); await stdout; await stderr;
    }
  }
}
console.log(JSON.stringify({ publishingQualified: true, platform: process.platform, architecture: process.arch, generations: 2 }));
