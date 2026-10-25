/** Public and authenticated author facades must not outlive their account/organization boundary. */
import { expect, test } from 'bun:test';
import { createBlogClient, createPublicBlogClient } from './blog-client';
import { captureBlogProfile } from '../../blog/validation';
const uuid = '00000000-0000-0000-0000-000000000000';
const record = () => ({
  id: 'bau_' + uuid,
  siteId: 'bls_' + uuid,
  userId: 'writer',
  status: 'active',
  revision: 1,
  profile: {
    displayName: 'Writer',
    slug: 'writer',
    byline: null,
    bio: null,
    website: null,
    socialLinks: [],
    avatar: null,
  },
  published: false,
  readiness: { ready: true, missing: [] },
  updatedAt: 1,
});
const capabilities = () => ({
  state: 'ready',
  canManageAuthors: true,
  canEditProfile: true,
  requirements: { name: true, avatar: false, bio: false },
  site: { id: 'bls_' + uuid, slug: 'blog', name: 'Blog', revision: 1 },
  self: record(),
});

test('commands and cursor reads use the shared SDK fetch with captured CAS and no caller-selected organization', async () => {
  const calls: any[] = [];
  const client = createBlogClient(async (path, init) => {
    calls.push({ path, init });
    return (
      path.endsWith('/config')
        ? capabilities()
        : path.includes('?')
          ? { items: [record()], nextCursor: null }
          : record()
    ) as any;
  });
  expect((await client.capabilities()).state).toBe('ready');
  await client.authors.list({ limit: 20, after: 'bau_' + uuid });
  const command = { expectedRevision: 1, changes: { displayName: 'New name' } };
  await client.authors.updateProfile('writer', command);
  command.changes.displayName = 'Later mutation';
  await client.authors.publishProfile('writer', 1);
  await client.authors.withdrawProfile('writer', 1);
  expect(calls.map((call) => [call.path, call.init.method])).toEqual([
    ['/api/blog/config', 'GET'],
    ['/api/blog/authors?limit=20&after=bau_' + uuid, 'GET'],
    ['/api/blog/authors/writer/profile', 'PATCH'],
    ['/api/blog/authors/writer/publication', 'POST'],
    ['/api/blog/authors/writer/publication', 'DELETE'],
  ]);
  expect(calls[2].init.body.changes.displayName).toBe('New name');
  expect(calls.every((call) => call.init.signal instanceof AbortSignal)).toBe(
    true,
  );
  client.clear();
});

test('late results and ignored-abort streams are retired on logout or organization change', async () => {
  let resolve!: (value: unknown) => void;
  const client = createBlogClient(
    async <T>() =>
      new Promise<T>((done) => {
        resolve = (value) => done(value as T);
      }),
  );
  const pending = client.authors.get('writer').catch((error) => error);
  client.clear();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  resolve(record());
  let cancelled = 0,
    seen = 0;
  const stream = createBlogClient(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: ' +
                  JSON.stringify({
                    version: 1,
                    value: { capabilities: capabilities() },
                  }) +
                  '\n\n',
              ),
            );
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ) as any,
  );
  const detach = stream.watch(() => {
    seen++;
  });
  await Bun.sleep(5);
  expect(seen).toBe(1);
  stream.clear();
  await Bun.sleep(5);
  expect(cancelled).toBe(1);
  detach();
  expect(seen).toBe(1);
});

test('malformed or oversized live packets cannot publish and public reads contain no account credentials', async () => {
  let errors = 0;
  const client = createBlogClient(
    async () =>
      new Response('data: {"version":2,"value":{}}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }) as any,
  );
  const detach = client.watch(
    () => {
      throw new Error('must not publish');
    },
    {
      onError() {
        errors++;
      },
    },
  );
  await Bun.sleep(5);
  detach();
  client.clear();
  expect(errors).toBe(1);
  const publicAuthor = {
    id: 'bau_' + uuid,
    siteId: 'bls_' + uuid,
    name: 'Public Writer',
    slug: 'writer',
    socialLinks: [],
  };
  let captured: RequestInit | undefined;
  const publicClient = createPublicBlogClient(
    'https://blog.test',
    async (_url, init) => {
      captured = init;
      return Response.json(publicAuthor);
    },
  );
  expect((await publicClient.author('blog', 'writer')).name).toBe(
    'Public Writer',
  );
  expect(captured?.credentials).toBe('omit');
  expect(new Headers(captured?.headers).has('Authorization')).toBe(false);
  const privateLeak = createPublicBlogClient('https://blog.test', async () =>
    Response.json({
      ...publicAuthor,
      email: 'private@example.test',
    }),
  );
  await expect(privateLeak.author('blog', 'writer')).rejects.toThrow('invalid');
  const tooLarge = createPublicBlogClient(
    'https://blog.test',
    async () => new Response(' '.repeat(65537)),
  );
  await expect(tooLarge.author('blog', 'writer')).rejects.toThrow('too large');
});

test('author social links reject sparse/accessor commands without executing application callbacks', () => {
  let reads = 0;
  const links = [{ label: 'Site', url: 'https://example.test' }];
  Object.defineProperty(links, '0', {
    get() {
      reads++;
      return { label: 'Site', url: 'https://example.test' };
    },
  });
  expect(() =>
    captureBlogProfile({
      expectedRevision: 1,
      changes: { socialLinks: links },
    }),
  ).toThrow();
  expect(() =>
    captureBlogProfile({
      expectedRevision: 1,
      changes: { socialLinks: new Array(2) },
    }),
  ).toThrow();
  expect(reads).toBe(0);
});
