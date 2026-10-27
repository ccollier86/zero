/** Existing-project upgrades use the managed composition, normal migrations and public facades. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { Migrator } from '../../migrations/migrator';
import { migrations } from '../../migrations';
import sharp from 'sharp';
import { createApp } from './app-factory';
import { defineEndpoint, defineZeroPlugin } from './server-extensions';
import type { AppConfig } from './types';
import type { ServerRouteServices } from './server-services';

function config(root: string, extra: Partial<AppConfig>): AppConfig {
  return {
    projectRoot: root,
    db: { mode: 'file', path: join(root, 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'system.db') },
    tables: {},
    auth: { bootstrap: 'public' },
    appDir: join(root, 'app'),
    outDir: join(root, 'out'),
    generatedDir: join(root, 'generated'),
    storageDir: join(root, 'storage'),
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    workflows: false,
    email: false,
    stateSync: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
    observability: { console: false, endpoint: false },
    ...extra,
  };
}
function requests(app: Awaited<ReturnType<typeof createApp>>) {
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server!.port}`;
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : text,
    };
  };
  return { request, origin };
}

test('a minimal existing project can enable authors without changing identities, roles, login or application data', async () => {
  const root = await mkdtemp(
    '/Volumes/code-bank/tmp/scratch/zero-platform/blog-upgrade-',
  );
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    zero!: ServerRouteServices;
  const capture = defineZeroPlugin({
    name: 'blog-upgrade-fixture',
    setup(context) {
      zero = context.zero;
    },
  });
  try {
    await mkdir(join(root, 'app'));
    app = await createApp(config(root, { serverExtensions: [capture] }));
    let http = requests(app);
    const registration = await http.request('POST', '/auth/register', {
      username: 'existing-author',
      email: 'private-author@example.test',
      password: 'Synthetic-only-password-123',
    });
    expect(registration.status).toBe(200);
    const id = registration.body.user.userId,
      before = zero.auth.store!.getUserById(id)!;
    const credentialsBefore = zero
      .system!.db.prepare('SELECT * FROM _credentials WHERE user_id=?')
      .get(id);
    expect(credentialsBefore).toMatchObject({
      user_id: id,
      password_hash: expect.any(String),
    });
    expect(zero.blog).toBeNull();
    zero.db.exec(
      'CREATE TABLE application_upgrade_proof (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    zero.db
      .prepare('INSERT INTO application_upgrade_proof VALUES (?,?)')
      .run('keep', 'unchanged');
    await app.stop(true);
    app = undefined;

    app = await createApp(
      config(root, {
        // This headless legacy-profile fixture has no browser dependency tree.
        // Full default publishing/pages are qualified by the installed app suite.
        blog: { content: false, pages: false },
        logging: { rootDirectory: join(root, 'logs') },
        serverExtensions: [
          capture,
          defineEndpoint({
            path: '/proof/blog-capabilities',
            method: 'GET',
            auth: 'user',
            handler: ({ zero }) => zero.blog!.capabilities(),
          }),
        ],
      }),
    );
    http = requests(app);
    expect(
      (
        await http.request(
          'GET',
          '/auth/me',
          undefined,
          registration.body.accessToken,
        )
      ).status,
    ).toBe(200);
    const login = await http.request('POST', '/auth/login', {
      username: 'existing-author',
      password: 'Synthetic-only-password-123',
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const token = login.body.accessToken;
    const after = zero.auth.store!.getUserById(id)!;
    expect(after.userId).toBe(before.userId);
    expect(
      zero
        .system!.db.prepare('SELECT * FROM _credentials WHERE user_id=?')
        .get(id),
    ).toEqual(credentialsBefore);
    expect(after.role).toBe(before.role);
    expect(
      zero.db.prepare('SELECT * FROM application_upgrade_proof').get(),
    ).toEqual({ id: 'keep', value: 'unchanged' });
    expect(
      zero.db
        .prepare("SELECT name FROM sqlite_master WHERE name='_blog_authors'")
        .get(),
    ).toBeNull();
    expect(
      (await http.request('GET', '/api/blog/authors', undefined, token)).body
        .items,
    ).toEqual([]);
    expect(
      (await http.request('GET', '/proof/blog-capabilities', undefined, token))
        .body,
    ).toMatchObject({ state: 'ready', canManageAuthors: true, self: null });
    const profile = await http.request(
      'GET',
      '/auth/profile',
      undefined,
      token,
    );
    expect(profile.status).toBe(200);
    expect(profile.body.capabilities.fields.bio.enabled).toBe(true);
    const assignment = await http.request(
      'POST',
      '/api/blog/authors',
      { userId: id, expectedRevision: 0 },
      token,
    );
    expect(assignment.status).toBe(200);
    expect(assignment.body.readiness.missing).toEqual([
      'displayName',
      'avatar',
    ]);
    const updated = await http.request(
      'PATCH',
      `/api/blog/authors/${id}/profile`,
      {
        expectedRevision: 1,
        changes: {
          displayName: 'Public Author',
          slug: 'public-author',
          bio: 'Only this biography is public.',
          avatar: 'account',
        },
      },
      token,
    );
    expect(updated.status).toBe(200);
    const stage = await http.request(
      'POST',
      '/auth/profile/avatar/stages',
      { expectedRevision: profile.body.revision },
      token,
    );
    expect(stage.status, JSON.stringify(stage.body)).toBe(200);
    const image = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    const upload = await fetch(
      http.origin +
        '/storage/upload-grants/' +
        encodeURIComponent(stage.body.upload.token),
      {
        method: 'PUT',
        body: image,
        headers: { 'Content-Type': 'image/png' },
      },
    );
    expect(upload.status, await upload.text()).toBe(201);
    const finalized = await http.request(
      'POST',
      `/auth/profile/avatar/stages/${stage.body.id}/finalize`,
      { receipt: stage.body.receipt },
      token,
    );
    expect(finalized.status).toBe(200);
    expect(finalized.body.publicAsset).toBeNull();
    const publicImage = await http.request(
      'POST',
      '/auth/profile/avatar/publication',
      { expectedRevision: finalized.body.revision },
      token,
    );
    expect(publicImage.status, JSON.stringify(publicImage.body)).toBe(200);
    expect(
      (
        await http.request(
          'POST',
          `/api/blog/authors/${id}/publication`,
          { expectedRevision: 2 },
          token,
        )
      ).status,
    ).toBe(200);
    const published = await http.request(
      'GET',
      '/api/blog/public/blog/authors/public-author',
    );
    expect(published.body).toMatchObject({
      name: 'Public Author',
      bio: 'Only this biography is public.',
    });
    expect(JSON.stringify(published.body)).not.toContain(
      'private-author@example.test',
    );
    expect(JSON.stringify(published.body)).not.toContain(id);
    const photo = await fetch(http.origin + published.body.avatar.deliveryPath);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('cache-control')).toContain('no-store');
    await photo.arrayBuffer();
    const events = zero
      .system!.db.prepare(
        "SELECT action FROM _auth_audit_events WHERE action LIKE 'blog.%' OR action LIKE 'profile.avatar.%'",
      )
      .all();
    expect(events.length).toBe(4);
    await zero.logging!.flush();
    const logged = await zero.logging!.page(
      'audit',
      { kind: 'platform' },
      { action: 'blog.author-profile-published' },
    );
    expect(logged.events).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(
      'Only this biography is public.',
    );
  } finally {
    await app?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test('expanded profiles and public avatars can be enabled by themselves with no blog enrollment or routes', async () => {
  const root = await mkdtemp(
    '/Volumes/code-bank/tmp/scratch/zero-platform/profile-only-upgrade-',
  );
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp(
      config(root, {
        auth: {
          bootstrap: 'public',
          userProfile: {
            fields: {
              preferredName: true,
              bio: true,
              website: true,
              socialLinks: true,
            },
            avatars: { enabled: true, publicAccess: true },
          },
        },
      }),
    );
    const { request } = requests(app);
    const registered = await request('POST', '/auth/register', {
      username: 'profile-only',
      email: 'profile-only@example.test',
      password: 'Synthetic-only-password-123',
    });
    expect(registered.status).toBe(200);
    const token = registered.body.accessToken;
    const profile = await request('GET', '/auth/profile', undefined, token);
    expect(profile.status).toBe(200);
    const edited = await request(
      'PATCH',
      '/auth/profile',
      {
        expectedRevision: profile.body.revision,
        changes: { bio: 'Private biography', preferredName: 'Preferred' },
      },
      token,
    );
    expect(edited.status).toBe(200);
    const avatar = await request(
      'GET',
      '/auth/profile/avatar',
      undefined,
      token,
    );
    expect(avatar.body.capabilities).toMatchObject({
      publicAccess: true,
      publicState: 'ready',
    });
    expect(avatar.body.publicAsset).toBeNull();
    expect(
      (await request('GET', '/api/blog/config', undefined, token)).status,
    ).toBe(404);
  } finally {
    await app?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test('an existing pre-feature SYSTEM database with migrate:false stays unmodified and reports blocked authors without breaking login', async () => {
  const root = await mkdtemp(
    '/Volumes/code-bank/tmp/scratch/zero-platform/blog-migration-disabled-',
  );
  let app: Awaited<ReturnType<typeof createApp>> | undefined,
    zero!: ServerRouteServices;
  try {
    await mkdir(join(root, 'app'));
    const raw = new Database(join(root, 'system.db'));
    const migrator = new Migrator({
      database: raw,
      dbPath: join(root, 'system.db'),
      migrations,
      createBackups: true,
      backupDir: join(root, 'backups'),
      log() {},
    });
    try {
      migrator.run('044');
    } finally {
      migrator.dispose();
      raw.close();
    }
    app = await createApp(
      config(root, {
        blog: { content: false, pages: false },
        migrate: false,
        serverExtensions: [
          defineZeroPlugin({
            name: 'blog-migration-disabled',
            setup(context) {
              zero = context.zero;
            },
          }),
        ],
      }),
    );
    const { request } = requests(app);
    const registered = await request('POST', '/auth/register', {
      username: 'migration-disabled',
      email: 'migration-disabled@example.test',
      password: 'Synthetic-only-password-123',
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    const token = registered.body.accessToken;
    expect(
      (await request('GET', '/api/blog/config', undefined, token)).body.state,
    ).toBe('blocked');
    expect(
      (await request('GET', '/api/blog/authors', undefined, token)).status,
    ).toBe(503);
    expect(
      (await request('GET', '/auth/profile', undefined, token)).status,
    ).toBe(200);
    expect(
      (await request('GET', '/auth/profile/avatar', undefined, token)).status,
    ).toBe(503);
    expect(
      (await request('GET', '/auth/config')).body.userProfile.avatars
        .publicState,
    ).toBe('blocked');
    for (const name of ['_blog_authors', '_auth_avatar_publications'])
      expect(
        zero
          .system!.db.prepare('SELECT name FROM sqlite_master WHERE name=?')
          .get(name),
      ).toBeNull();
  } finally {
    await app?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
