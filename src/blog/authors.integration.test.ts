/** Real Guardian/Elysia author foundation. Every fixture owns isolated in-memory state. */
import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB } from '../sync/reactive-db';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createAuthPlugin } from '../auth/auth.plugin';
import type { AuthRuntime } from '../auth/auth-runtime';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { BlogService } from './service';
import { resolveBlogConfig } from './config';
import { createBlogPlugin } from './plugin';
import type { UserPublicAvatarAsset } from '../auth/auth-user-avatar-types';
import { MemoryEventStore } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(
  mode: 'single' | 'multi' = 'single',
  requireAvatar = false,
  authorization: 'simple' | 'advanced' = 'simple',
) {
  const db = createReactiveDB({ mode: 'memory' }),
    runtime = new ZeroAppRuntime(),
    photos = new Map<string, UserPublicAvatarAsset>();
  const events = new MemoryEventStore({ maxEvents: 100 });
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false },
  });
  let auth!: AuthRuntime;
  const app = new Elysia().use(
    createAuthPlugin({
      db,
      runtime,
      tenancy: mode,
      authorization,
      bootstrap: 'public',
      onRuntimeCreated: (value) => {
        auth = value;
      },
    }),
  );
  await auth.start();
  const normalized = resolveAuthBehaviorConfig({
      tenancy: mode,
      authorization,
    }),
    config = resolveBlogConfig({ authors: { requireAvatar } }, normalized);
  const service = new BlogService({
    db,
    users: auth.getStore()!,
    audit: auth.getAuditService()!,
    tenancy: auth.getTenancyService(),
    config,
    installAllowed: true,
    publicAvatar: (userId) => photos.get(userId) ?? null,
  });
  service.initialize();
  app.use(
    createBlogPlugin({
      getService: () => service,
      getTokenService: () => auth.getTokenService(),
      authorization: {
        getAuthorizationKernel: () => auth.getAuthorizationKernel(),
        getRoleAssignments: () => auth.getAuthorizationRoleService(),
        getPropertyStore: () => auth.getStore(),
      },
    }),
  );
  app.listen(0);
  cleanups.push(async () => {
    service.close();
    await app.stop();
    await runtime.dispose();
    db.dispose();
  });
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ) => {
    const response = await app.handle(
      new Request('http://localhost' + path, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: await response.json(), response };
  };
  const register = async (name: string) => {
    const value = await request('POST', '/auth/register', {
      username: name,
      email: name + '@example.test',
      password: 'password123',
      ...(mode === 'multi' ? { organizationName: name + ' organization' } : {}),
    });
    expect(value.status).toBe(200);
    return value.body;
  };
  const assign = (
    userId: string,
    token: string,
    expectedRevision = 0,
    status = 'active',
  ) =>
    request(
      'POST',
      '/api/blog/authors',
      { userId, expectedRevision, status },
      token,
    );
  return {
    db,
    runtime,
    auth,
    app,
    service,
    config,
    photos,
    request,
    register,
    assign,
  };
}
test('single and multi advanced RBAC preserve existing assignments and current manager permissions', async () => {
  for (const mode of ['single', 'multi'] as const) {
    const f = await fixture(mode, false, 'advanced'),
      owner = await f.register('advanced-owner-' + mode),
      peer = await f.register('advanced-peer-' + mode);
    expect((await f.assign(owner.user.userId, owner.accessToken)).status).toBe(
      200,
    );
    const status = (await f.assign(owner.user.userId, peer.accessToken)).status;
    expect(status).toBe(mode === 'multi' ? 404 : 403);
    expect(
      (await f.request('GET', '/api/blog/config', undefined, owner.accessToken))
        .body.canManageAuthors,
    ).toBe(true);
    expect(
      (
        await f.request(
          'POST',
          '/auth/logout',
          { refreshToken: owner.refreshToken },
          owner.accessToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          'GET',
          '/api/blog/authors',
          undefined,
          owner.accessToken,
        )
      ).status,
    ).toBe(401);
  }
});
test('authorized live snapshots reflect accepted assignments and close when their session is revoked', async () => {
  const f = await fixture(),
    owner = await f.register('live-owner'),
    abort = new AbortController();
  const response = await f.app.handle(
    new Request('http://localhost/api/blog/live', {
      headers: { Authorization: 'Bearer ' + owner.accessToken },
      signal: abort.signal,
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(),
    decode = new TextDecoder();
  const read = async () => {
    const chunk = await reader.read();
    if (chunk.done) return null;
    return JSON.parse(decode.decode(chunk.value).split('data: ')[1]!.trim())
      .value;
  };
  try {
    expect((await read()).authors.items).toEqual([]);
    expect((await f.assign(owner.user.userId, owner.accessToken)).status).toBe(
      200,
    );
    expect((await read()).capabilities.self.userId).toBe(owner.user.userId);
    expect(
      (
        await f.request(
          'POST',
          '/auth/logout',
          { refreshToken: owner.refreshToken },
          owner.accessToken,
        )
      ).status,
    ).toBe(200);
    let next = await read();
    // One previously authorized coalesced snapshot may have been queued before
    // logout; no post-revocation read may produce a newly authorized snapshot.
    if (next !== null) next = await read();
    expect(next).toBeNull();
  } finally {
    abort.abort();
    await reader.cancel();
    reader.releaseLock();
  }
});
test('assignment preserves account roles, admits only managers, and requires a real named public profile', async () => {
  const f = await fixture(),
    owner = await f.register('owner'),
    writer = await f.register('writer');
  expect((await f.assign(writer.user.userId, writer.accessToken)).status).toBe(
    403,
  );
  const beforeRole = f.auth.getStore()!.getUserById(writer.user.userId)!.role;
  const assigned = await f.assign(writer.user.userId, owner.accessToken);
  expect(assigned.status).toBe(200);
  expect(assigned.body).toMatchObject({
    revision: 1,
    readiness: { ready: false, missing: ['displayName'] },
  });
  expect(f.auth.getStore()!.getUserById(writer.user.userId)!.role).toBe(
    beforeRole,
  );
  expect(
    (
      await f.request(
        'POST',
        '/api/blog/authors/' + writer.user.userId + '/publication',
        { expectedRevision: 1 },
        writer.accessToken,
      )
    ).body.code,
  ).toBe('BLOG_AUTHOR_INCOMPLETE');
  const update = await f.request(
    'PATCH',
    '/api/blog/authors/' + writer.user.userId + '/profile',
    {
      expectedRevision: 1,
      changes: {
        displayName: 'Writer Name',
        slug: 'writer',
        byline: 'Researcher',
        bio: 'Public biography',
        socialLinks: [{ label: 'Site', url: 'https://example.test/' }],
      },
    },
    writer.accessToken,
  );
  expect(update.status).toBe(200);
  expect(update.body.revision).toBe(2);
  expect(
    (
      await f.request(
        'POST',
        '/api/blog/authors/' + writer.user.userId + '/publication',
        { expectedRevision: 2 },
        writer.accessToken,
      )
    ).status,
  ).toBe(200);
  const published = await f.request(
    'GET',
    '/api/blog/public/blog/authors/writer',
  );
  expect(published.status).toBe(200);
  expect(published.body).toMatchObject({
    name: 'Writer Name',
    byline: 'Researcher',
  });
  expect(JSON.stringify(published.body)).not.toContain(writer.user.userId);
  expect(JSON.stringify(published.body)).not.toContain('@example.test');
  await f.request(
    'PATCH',
    '/api/blog/authors/' + writer.user.userId + '/profile',
    {
      expectedRevision: 3,
      changes: { displayName: 'Unpublished private change' },
    },
    writer.accessToken,
  );
  expect(
    (await f.request('GET', '/api/blog/public/blog/authors/writer')).body.name,
  ).toBe('Writer Name');
  const suspended = await f.assign(
    writer.user.userId,
    owner.accessToken,
    4,
    'suspended',
  );
  expect(suspended.status).toBe(200);
  expect(
    (await f.request('GET', '/api/blog/public/blog/authors/writer')).status,
  ).toBe(404);
  expect(
    (
      await f.request(
        'PATCH',
        '/api/blog/authors/' + writer.user.userId + '/profile',
        { expectedRevision: 5, changes: { bio: 'Late' } },
        writer.accessToken,
      )
    ).status,
  ).toBe(403);
  const withdrawn = await f.request(
    'DELETE',
    '/api/blog/authors/' + writer.user.userId + '/publication',
    { expectedRevision: 5 },
    owner.accessToken,
  );
  expect(withdrawn.status).toBe(200);
  expect(withdrawn.body.published).toBe(false);
  expect(withdrawn.body.status).toBe('suspended');
  const audit = f.db
    .prepare(
      "SELECT actor_user_id,target_type,metadata_json FROM _auth_audit_events WHERE action='blog.author-profile-withdrawn'",
    )
    .get();
  expect(audit).toMatchObject({
    actor_user_id: owner.user.userId,
    target_type: 'blog.author',
    metadata_json: '{}',
  });
});
test('author photo requirements use an actually public descriptor, not initials or an arbitrary URL', async () => {
  const f = await fixture('single', true),
    owner = await f.register('photographer'),
    id = owner.user.userId,
    token = owner.accessToken;
  await f.assign(id, token);
  await f.request(
    'PATCH',
    '/api/blog/authors/' + id + '/profile',
    {
      expectedRevision: 1,
      changes: { displayName: 'Author', slug: 'author', avatar: 'account' },
    },
    token,
  );
  expect(
    (
      await f.request(
        'POST',
        '/api/blog/authors/' + id + '/publication',
        { expectedRevision: 2 },
        token,
      )
    ).status,
  ).toBe(422);
  const uuid = crypto.randomUUID();
  f.photos.set(id, {
    id: 'avp_' + uuid,
    width: 64,
    height: 64,
    byteLength: 100,
    mimeType: 'image/webp',
    deliveryPath: '/auth/profile/avatar/public/avp_' + uuid,
  });
  expect(
    (
      await f.request(
        'POST',
        '/api/blog/authors/' + id + '/publication',
        { expectedRevision: 2 },
        token,
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.request('GET', '/api/blog/public/blog/authors/author')).body.avatar
      .deliveryPath,
  ).toContain('/public/avp_');
  f.photos.delete(id);
  expect(
    (await f.request('GET', '/api/blog/public/blog/authors/author')).status,
  ).toBe(404);
});
test('each organization has its own authors, scope and public directory with no inherited cross-org grants', async () => {
  const f = await fixture('multi'),
    a = await f.register('alpha'),
    b = await f.register('bravo');
  expect((await f.assign(b.user.userId, a.accessToken)).status).toBe(404);
  const assigned = await f.assign(a.user.userId, a.accessToken);
  expect(assigned.status).toBe(200);
  expect(
    (
      await f.request(
        'GET',
        '/api/blog/authors/' + a.user.userId,
        undefined,
        b.accessToken,
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.request('GET', '/api/blog/authors', undefined, b.accessToken)).body
      .items,
  ).toEqual([]);
  expect(
    (await f.request('GET', '/api/blog/config', undefined, a.accessToken)).body
      .site.slug,
  ).toStartWith('site-');
});
test('strict commands, CAS, scoped pagination and failed final authority leave accepted state unchanged', async () => {
  const f = await fixture(),
    owner = await f.register('commands'),
    token = owner.accessToken,
    id = owner.user.userId;
  await f.assign(id, token);
  for (const changes of [
    { role: 'admin' },
    { avatar: 'https://attacker.test/a.webp' },
    { website: 'javascript:alert(1)' },
    {
      socialLinks: [
        { label: 'unsafe', url: 'https://user:secret@example.test/' },
      ],
    },
  ]) {
    expect(
      (
        await f.request(
          'PATCH',
          '/api/blog/authors/' + id + '/profile',
          { expectedRevision: 1, changes },
          token,
        )
      ).status,
    ).toBe(422);
  }
  expect(
    (
      await f.request(
        'POST',
        '/api/blog/authors',
        { userId: id, expectedRevision: 1, tenantId: 'forged' },
        token,
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.request(
        'GET',
        '/api/blog/authors?tenantId=forged',
        undefined,
        token,
      )
    ).status,
  ).toBe(422);
  expect(
    (await f.request('GET', '/api/blog/authors?limit=0', undefined, token))
      .status,
  ).toBe(422);
  const auth = (await f.auth.getTokenService()!.resolveAuthContext(token))!;
  const auditBefore = f.db
    .prepare('SELECT COUNT(*) AS count FROM _auth_audit_events')
    .get();
  const access = createRequestAuthorizationAccess({
    authContext: auth,
    kernel: f.auth.getAuthorizationKernel(),
    propertyStore: f.auth.getStore(),
    roleAssignments: f.auth.getAuthorizationRoleService(),
  });
  const scope = f.service.forAuthority({
    access,
    scope: applicationServiceDataScope(),
    assertCurrentAuthoritySync() {
      const row = f.db
        .prepare('SELECT draft_json FROM _blog_authors WHERE user_id=?')
        .get(id) as { draft_json: string };
      if (row.draft_json.includes('Must roll back'))
        throw new Error('revoked-at-final-fence');
    },
  });
  expect(() =>
    scope.authors.updateProfile(id, {
      expectedRevision: 1,
      changes: { displayName: 'Must roll back' },
    }),
  ).toThrow();
  expect(
    (await f.request('GET', '/api/blog/authors/' + id, undefined, token)).body
      .profile.displayName,
  ).toBe('');
  expect(
    f.db.prepare('SELECT COUNT(*) AS count FROM _auth_audit_events').get(),
  ).toEqual(auditBefore);
  expect(
    (
      await f.request(
        'PATCH',
        '/api/blog/authors/' + id + '/profile',
        { expectedRevision: 999, changes: { displayName: 'Stale' } },
        token,
      )
    ).status,
  ).toBe(409);
});
test('policy replacement retires old services across A to B to A and disabling retains profiles', async () => {
  const f = await fixture(),
    owner = await f.register('policy');
  await f.assign(owner.user.userId, owner.accessToken);
  const next = new BlogService({
    db: f.db,
    users: f.auth.getStore()!,
    config: { ...f.config, enabled: false },
    installAllowed: true,
    publicAvatar: () => null,
  });
  next.initialize();
  expect(() => f.service.publicAuthor('blog', 'anything')).toThrow(
    expect.objectContaining({ code: 'BLOG_POLICY_CHANGED' }),
  );
  const restored = new BlogService({
    db: f.db,
    users: f.auth.getStore()!,
    config: f.config,
    installAllowed: true,
    publicAvatar: () => null,
  });
  restored.initialize();
  expect(() => f.service.publicAuthor('blog', 'anything')).toThrow(
    expect.objectContaining({ code: 'BLOG_POLICY_CHANGED' }),
  );
  expect(
    (
      f.db.prepare('SELECT COUNT(*) AS count FROM _blog_authors').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);
  next.close();
  restored.close();
});
