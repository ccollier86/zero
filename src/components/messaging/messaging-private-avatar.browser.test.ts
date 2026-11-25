/** Physical Chromium/native Guardian acceptance with exact owned external fixture retirement. */
import { afterAll, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { createApp } from '../../frontend/server/app-factory';
import { defineZeroPlugin } from '../../frontend/server/server-extensions';
import type { ServerRouteServices } from '../../frontend/server/server-services';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { ownedWorkerFixture } from '../../workers/test-support/owned-fixture';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/private-chat-avatars-browser';
const active = new Set<{ close(): Promise<void> }>();
const password = 'Synthetic-private-avatar-password-123';
afterAll(async () => { for (const run of active) await run.close(); }, 30000);

async function ownedRun() {
  if (process.platform === 'darwin' && !tmpdir().startsWith('/Volumes/code-bank/tmp/scratch/zero-platform/private-chat-avatars/runs')) {
    throw new Error('Private-avatar browser qualification requires its explicit external TMPDIR; no internal fallback.');
  }
  const owned = await ownedWorkerFixture('private-avatar-browser');
  let app: Awaited<ReturnType<typeof createApp>> | undefined, lease: PlaywrightTestBrowserLease | undefined;
  let context: BrowserContext | undefined, reservation: ReturnType<typeof Bun.serve> | undefined;
  let settle!: () => void; const settled = new Promise<void>(resolve => { settle = resolve; });
  let closing: Promise<void> | undefined;
  const run = { root: owned.root, settle, async close() {
    return closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([settled, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned avatar browser body remains active: ' + owned.root)), 10000); })]);
      } finally { clearTimeout(timer); }
      const closed = await Promise.allSettled([context?.close(), app?.stop(true), reservation?.stop(true)]);
      await lease?.releaseAndWait();
      if (closed.some(result => result.status === 'rejected')) throw new Error('Owned avatar browser handles did not close; preserving ' + owned.root);
      await owned.cleanup(); active.delete(run);
      console.info(JSON.stringify({ qualification: 'private-avatar-browser-retired', root: owned.root, handlesClosed: true }));
    })();
  }, async start() {
    await mkdir(join(owned.root, 'app'));
    const styles = await buildPlatformStyles(join(owned.root, 'styles'), join(owned.root, 'app'));
    let css = await Bun.file(styles.cssPath).text();
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'messaging-private-avatar.browser-fixture.tsx')], outdir: join(owned.root, 'browser'),
      target: 'browser', format: 'esm', splitting: true, define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
    const assets = new Map(build.outputs.map(output => ['/_fixture/' + basename(output.path), output]));
    for (const output of build.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
    const entry = '/_fixture/' + basename(build.outputs.find(output => output.kind === 'entry-point')!.path);
    reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Synthetic reservation') });
    const port = reservation.port!; await reservation.stop(true); reservation = undefined;
    const base = 'http://127.0.0.1:' + port;
    let zero!: ServerRouteServices, viewerId = '', peerId = '', staffId = '';
    app = await createApp({ projectRoot: owned.root, appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'),
      generatedDir: join(owned.root, 'generated'), storageDir: join(owned.root, 'storage'),
      app: { publicUrl: base }, db: { mode: 'file', path: join(owned.root, 'app.db') }, systemDb: { mode: 'file', path: join(owned.root, 'system.db') },
      tables: { fixture_avatar_policy: { id: 'TEXT PRIMARY KEY', enabled: 'INTEGER NOT NULL' } },
      auth: { bootstrap: 'public', userProfile: { avatars: { enabled: true, outputSize: 64 } },
        userAvatarReadPolicy: { id: 'synthetic-browser-peers', version: '1', authorize: ({ viewerId: viewer, subjectId, db }) =>
          viewer === viewerId && [peerId, staffId].includes(subjectId) && db.get('fixture_avatar_policy', 'current')?.enabled === 1 } },
      messaging: { support: false, relationships: () => !viewerId ? { direct: [], groups: [] } : {
        direct: [{ users: [viewerId, staffId], epoch: 'current-assignment' }],
        groups: [{ id: 'synthetic-house', name: 'Synthetic house', members: [viewerId, peerId, staffId].map(id => ({ id, epoch: 'current-' + id })) }],
      } },
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      ai: false, email: false, workflows: false, vector: false, pdf: false, kv: false, stateSync: false, logging: false, observability: false,
      serverExtensions: [defineZeroPlugin({ name: 'synthetic-private-avatar-browser', setup(context) { zero = context.zero; } })],
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false });
    app.get('/_fixture/*', ({ request }) => {
      const asset = assets.get(new URL(request.url).pathname);
      return asset ? new Response(asset, { headers: { 'Content-Type': asset.path.endsWith('.mp3') ? 'audio/mpeg' : asset.path.endsWith('.css') ? 'text/css' : 'application/javascript' } }) : new Response(null, { status: 404 });
    });
    app.get('/workspace', () => new Response(`<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body,#root{margin:0;height:100dvh}#root{display:flex;flex-direction:column;padding:12px;box-sizing:border-box}.zero-messaging-workspace{flex:1;min-height:0}</style><div id="root"></div><script>window.__PLATFORM_CONFIG__={auth:true,logging:false,stateSync:false,routeAuth:'protected-by-default',publicPaths:['/workspace']}</script><script type="module" src="${entry}"></script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    app.listen({ hostname: '127.0.0.1', port });
    const call = async (method: string, path: string, body?: unknown, token?: string, key?: string): Promise<any> => {
      const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error('Synthetic avatar request rejected: ' + response.status + ' ' + result.code); return result;
    };
    const register = (username: string) => call('POST', '/auth/register', { username, email: username + '@example.test', password });
    const viewer = await register('avatar-viewer'), peer = await register('avatar-peer'), staff = await register('avatar-staff');
    viewerId = viewer.user.userId; peerId = peer.user.userId; staffId = staff.user.userId;
    zero.db.createStrict('fixture_avatar_policy', { id: 'current', enabled: 1 });
    const direct = await call('POST', '/api/messaging/conversations', { userIds: [staffId] }, viewer.accessToken, 'avatar-direct');
    const house = (await call('GET', '/api/messaging/conversations', undefined, viewer.accessToken)).items.find((row: { title: string }) => row.title === 'Synthetic house');
    await call('POST', `/api/messaging/conversations/${house.id}/messages`, { text: 'SYNTHETIC_HOUSEMATE_PHOTO' }, peer.accessToken, 'avatar-house-message');
    await call('POST', `/api/messaging/conversations/${direct.id}/messages`, { text: 'SYNTHETIC_STAFF_PHOTO' }, staff.accessToken, 'avatar-staff-message');
    const replace = async (token: string, color: { r: number; g: number; b: number }) => {
      const current = await call('GET', '/auth/profile/avatar', undefined, token);
      const stage = await call('POST', '/auth/profile/avatar/stages', { expectedRevision: current.revision }, token);
      const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
      const uploaded = await fetch(base + '/storage/upload-grants/' + stage.upload.token, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png' }, body: Uint8Array.from(image) });
      if (!uploaded.ok) throw new Error('Synthetic private avatar upload rejected: ' + uploaded.status);
      return call('POST', `/auth/profile/avatar/stages/${stage.id}/finalize`, { receipt: stage.receipt }, token);
    };
    // Put Chromium's disposable profile/cache under this exact marker-owned
    // root, not in the internal OS temp directory. The focused file owns the
    // process-local lease and restores the ambient variable after launch.
    const previousTmp = process.env.TMPDIR;
    try { process.env.TMPDIR = owned.root; lease = await acquirePlaywrightTestBrowser(); }
    finally { if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; }
    context = await lease.browser.newContext({ viewport: { width: 1100, height: 820 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    return { base, page, call, viewer, peer, staff, direct, house, replace, policy: (enabled: number) => zero.db.update('fixture_avatar_policy', 'current', { enabled }) };
  } };
  active.add(run);
  console.info(JSON.stringify({ qualification: 'private-avatar-browser-owned', root: owned.root, pid: process.pid }));
  return run;
}

async function decoded(page: Page, selector: string, channel: 0 | 1 | 2) {
  await page.waitForFunction(({ selector, channel }) => {
    const image = document.querySelector<HTMLImageElement>(selector);
    if (!image?.complete || image.naturalWidth !== 64 || image.naturalHeight !== 64) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return pixel[channel] > 200 && [0, 1, 2].every(index => index === channel || pixel[index]! < 50);
  }, { selector, channel });
}

browserTest('native private avatar photos decode, refresh, withdraw and cannot return from a late previous-account response', async () => {
  const run = await ownedRun();
  let release: (() => void) | undefined;
  try {
    const f = await run.start(), page = f.page, errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const state = { created: [] as string[], revoked: [] as string[] };
      (window as unknown as { __avatarUrls: typeof state }).__avatarUrls = state;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = object => { const url = create(object); state.created.push(url); return url; };
      URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
    });
    const peerPhoto = await f.replace(f.peer.accessToken, { r: 255, g: 0, b: 0 });
    await f.replace(f.staff.accessToken, { r: 0, g: 255, b: 0 });
    const directRow = `[data-conversation-id="${f.direct.id}"]`, houseRow = `[data-conversation-id="${f.house.id}"]`;
    await page.goto(f.base + '/workspace');
    await decoded(page, directRow + ' img', 1);
    await page.locator(directRow).click(); await decoded(page, '[data-slot="conversation-header"] img', 1);
    await decoded(page, '[data-slot="message-bubble"] img', 1);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await decoded(page, '.zero-messaging-start-person img', 1);
    expect(await page.locator('[data-start-person]').count()).toBe(1);
    expect(await page.locator('[data-start-person]').textContent()).toContain('avatar-staff');
    expect((await f.call('GET', '/api/messaging/directory', undefined, f.viewer.accessToken)).items.map((row: { id: string }) => row.id)).toEqual([f.staff.user.userId]);
    await page.keyboard.press('Escape'); await page.locator(houseRow).click();
    await decoded(page, '[data-slot="message-bubble"] img', 0);
    await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
    await decoded(page, `[data-participant-id="${f.peer.user.userId}"] img`, 0);
    await decoded(page, `[data-participant-id="${f.staff.user.userId}"] img`, 1);
    await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'private-photos.png') });
    await page.keyboard.press('Escape');
    const oldUrls = await page.evaluate(() => (window as unknown as { __avatarUrls: { created: string[] } }).__avatarUrls.created);
    const replacement = await f.replace(f.peer.accessToken, { r: 0, g: 0, b: 255 });
    expect(replacement.asset.id).not.toBe(peerPhoto.asset.id);
    await decoded(page, '[data-slot="message-bubble"] img', 2);
    expect((await fetch(f.base + peerPhoto.asset.deliveryPath, { headers: { Authorization: 'Bearer ' + f.viewer.accessToken } })).status).toBe(404);
    await f.call('DELETE', '/auth/profile/avatar', { expectedRevision: replacement.revision }, f.peer.accessToken);
    await page.waitForFunction(() => !document.querySelector('[data-slot="message-bubble"] img'));
    expect(await page.getByRole('article', { name: 'Message from avatar-peer', exact: true }).textContent()).toContain('SYNTHETIC_HOUSEMATE_PHOTO');
    await page.waitForFunction(urls => urls.some(url => (window as unknown as { __avatarUrls: { revoked: string[] } }).__avatarUrls.revoked.includes(url)), oldUrls);
    const staffAsset = (await f.call('GET', '/auth/profile/avatar', undefined, f.staff.accessToken)).asset;
    f.policy(0);
    await page.waitForFunction(() => document.querySelectorAll('.zero-messaging-workspace img').length === 0);
    expect((await fetch(f.base + staffAsset.deliveryPath, { headers: { Authorization: 'Bearer ' + f.viewer.accessToken } })).status).toBe(404);
    await page.screenshot({ path: join(evidence, 'private-withdrawal.png') });
    // Hold actual normalized bytes returned by the real native endpoint, then
    // switch this mounted SDK account before releasing that older response.
    const pending = await f.replace(f.peer.accessToken, { r: 255, g: 0, b: 0 });
    const started = Promise.withResolvers<void>(), released = Promise.withResolvers<void>(), delivered = Promise.withResolvers<void>(); release = () => released.resolve();
    let held = 0;
    await page.route('**' + pending.asset.deliveryPath, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); held++; started.resolve();
      await released.promise;
      try { await route.fulfill({ response }); } catch { /* SDK scope cancellation may retire this actual request first. */ }
      finally { delivered.resolve(); }
    });
    f.policy(1);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([started.promise, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Actual private avatar response did not reach the owned late-byte gate.')), 20000); })]); }
    finally { clearTimeout(deadline); }
    await page.getByRole('button', { name: 'Switch to staff', exact: true }).click();
    await page.getByTestId('avatar-account').getByText('avatar-staff', { exact: true }).waitFor();
    const createdAtSwitch = await page.evaluate(() => (window as unknown as { __avatarUrls: { created: string[] } }).__avatarUrls.created.length);
    release(); await delivered.promise;
    await page.locator(houseRow).click();
    await page.getByRole('article', { name: 'Message from avatar-peer', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-slot="message-bubble"] img'));
    expect(await page.evaluate(() => (window as unknown as { __avatarUrls: { created: string[] } }).__avatarUrls.created.length)).toBe(createdAtSwitch);
    expect(held).toBeGreaterThan(0);
    expect((await fetch(f.base + pending.asset.deliveryPath, { headers: { Authorization: 'Bearer ' + f.staff.accessToken } })).status).toBe(404);
    await page.getByRole('button', { name: 'Sign out test account', exact: true }).click();
    await page.getByTestId('avatar-account').getByText('signed-out', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.zero-messaging-workspace img').length === 0);
    await page.waitForFunction(() => {
      const urls = (window as unknown as { __avatarUrls: { created: string[]; revoked: string[] } }).__avatarUrls;
      return urls.created.every(url => urls.revoked.includes(url));
    });
    expect(errors).toEqual([]);
    await Bun.write(join(evidence, 'private-avatar-browser.json'), JSON.stringify({ bun: Bun.version, fixtureRoot: run.root,
      normalizedPixelsDecoded: ['staff-green-picker-preview-header-message-roster', 'housemate-red-message-roster', 'replacement-blue-message'],
      privatePublicationRequired: false, permissionWithdrawal: true, latePreviousAccountBytes: held, signOutUrlsRetired: true,
      sourceOnly: true, installedArchiveBrowser: false }, null, 2));
  } finally { release?.(); run.settle(); await run.close(); }
}, 180000);
