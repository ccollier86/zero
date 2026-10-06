/**
 * Full StorageManagement hold-confirm regression against real isolated
 * Auth/Storage HTTP routes, an in-memory database, and disposable local blobs.
 * Test-created users/files are synthetic; no running app or live data is used.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import type { Browser } from 'playwright';
import { createAuthPlugin, getAuthStore, getTokenService } from '../../auth/auth.plugin';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import { createStoragePlugin, getStorageService } from '../../storage/storage.plugin';
import type { FileInfo, ListResult } from '../../storage/types';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import {
  acquirePlaywrightTestBrowser,
  playwrightTestBrowserAvailable,
  type PlaywrightTestBrowserLease,
} from '../../test-support/playwright-test-browser';

const TEST_TIMEOUT = 60_000;
const evidenceDirectory = process.env.ZERO_STORAGE_DELETE_EVIDENCE_DIR;
const username = 'storage_delete_fixture';
const password = 'synthetic-fixture-password';
let directory: string | undefined;
let db: ReactiveDB | undefined;
let app: ReturnType<typeof createFixtureApp> | undefined;
let lease: PlaywrightTestBrowserLease | undefined;
let browser: Browser | undefined;
let baseUrl = '';
let driveId = '';
let token = '';
const deleteRequests: string[] = [];

function createFixtureApp(bundlePath: string, stylesheetPath: string, storageDirectory: string) {
  return new Elysia()
    .onRequest(({ request }) => {
      if (request.method === 'DELETE') deleteRequests.push(new URL(request.url).pathname);
    })
    .use(createAuthPlugin({ db: db!, bootstrap: 'public' }))
    .use(createStoragePlugin({ db: db!, localDir: storageDirectory }))
    .get('/fixture-config', () => ({ driveId, username, password }))
    .get('/fixture.js', () => new Response(Bun.file(bundlePath), {
      headers: { 'Content-Type': 'text/javascript' },
    }))
    .get('/fixture.css', () => new Response(Bun.file(stylesheetPath), {
      headers: { 'Content-Type': 'text/css' },
    }))
    .get('/', () => new Response(`<!doctype html><html><head>
      <meta charset="utf-8"><title>Disposable storage deletion fixture</title>
      <link rel="stylesheet" href="/fixture.css"></head>
      <body><main class="h-screen p-4"><div id="root" class="h-full">Starting disposable fixture…</div></main>
      <script src="/fixture.js"></script></body></html>`, {
      headers: { 'Content-Type': 'text/html' },
    }))
    .listen({ hostname: '127.0.0.1', port: 0 });
}

beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) {
    throw new Error('Storage deletion acceptance requires the existing Chromium fixture browser.');
  }
  directory = await mkdtemp(join(tmpdir(), 'zero-storage-delete-'));
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
  const bundlePath = join(directory, 'fixture.js');
  const build = Bun.spawn({
    cmd: [process.execPath, '--no-env-file', 'build',
      join(import.meta.dir, 'storage-file-delete.browser-fixture.tsx'),
      '--target=browser', '--format=iife', '--production', `--outfile=${bundlePath}`],
    cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited,
  ]);
  if (status !== 0) throw new Error(`Storage deletion fixture build failed.\n${stdout}\n${stderr}`);
  const stylesheet = await buildPlatformStyles(directory, join(directory, 'missing-app'));
  db = createReactiveDB({ mode: 'memory' });
  app = createFixtureApp(bundlePath, stylesheet.cssPath, join(directory, 'blobs'));
  baseUrl = `http://127.0.0.1:${app.server!.port}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getAuthStore() && getTokenService() && getStorageService()) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const store = getAuthStore();
  const tokens = getTokenService();
  const storage = getStorageService();
  if (!store || !tokens || !storage) throw new Error('Disposable Auth/Storage routes did not start.');
  const user = await store.createUser({ username, email: 'storage-delete@test.invalid', password, role: 'user' });
  token = (await tokens.issueTokenPair(user)).accessToken;
  driveId = storage.drives.create(user.userId, { name: 'Disposable deletion drive' }).drive_id;
  lease = await acquirePlaywrightTestBrowser();
  browser = lease.browser;
}, TEST_TIMEOUT);

afterAll(async () => {
  try {
    await app?.stop(true);
    db?.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  } finally {
    lease?.release();
  }
}, TEST_TIMEOUT);

test('held Delete dispatches once and distinguishes plain, space, and literal-percent uploaded names', async () => {
  const names = ['plain.txt', 'invoice 1.txt', 'invoice%201.txt', 'literal%2Fname.txt'];
  const files: FileInfo[] = [];
  for (const name of names) {
    const form = new FormData();
    form.append('file', new File([`Disposable bytes for ${name}`], name, { type: 'text/plain' }));
    form.append('path', `/${name}`);
    const response = await fetch(`${baseUrl}/storage/drives/${driveId}/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    expect(response.status).toBe(200);
    const file = await response.json() as FileInfo;
    expect(file.path).toBe(`/${name}`);
    files.push(file);
  }
  const listing = await fetch(`${baseUrl}/storage/drives/${driveId}/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listing.status).toBe(200);
  const listed = await listing.json() as ListResult;
  expect(listed.items.map((file) => file.path).sort()).toEqual(files.map((file) => file.path).sort());

  const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl);
    const firstRow = page.locator(`[data-storage-item-id="${files[0]!.id}"]`);
    await firstRow.waitFor({ state: 'visible' });
    await firstRow.press('Enter');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const cancelledDialog = page.getByRole('dialog');
    await cancelledDialog.waitFor({ state: 'visible' });
    expect(deleteRequests).toEqual([]);
    const cancelledHold = cancelledDialog.getByRole('button', { name: 'Delete', exact: true });
    await cancelledHold.focus();
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    expect(deleteRequests).toEqual([]);
    await cancelledDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cancelledDialog.waitFor({ state: 'hidden' });
    expect(getStorageService()!.objects.get(driveId, files[0]!.path)?.id).toBe(files[0]!.id);

    for (const [index, file] of files.entries()) {
      const row = page.locator(`[data-storage-item-id="${file.id}"]`);
      await row.press('Enter');
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      expect(await dialog.getByText(`${file.name} will be permanently deleted.`, { exact: true }).isVisible()).toBe(true);
      expect(deleteRequests).toHaveLength(index);
      if (evidenceDirectory && index === 1) {
        await page.waitForFunction(() => {
          const visibleDialog = document.querySelector('[role="dialog"]');
          if (!visibleDialog) return false;
          const style = getComputedStyle(visibleDialog);
          return style.opacity === '1' && (style.filter === 'none' || style.filter === 'blur(0px)');
        });
        await page.screenshot({ path: join(evidenceDirectory, 'encoded-file-confirmation.png'), fullPage: true });
      }
      const hold = dialog.getByRole('button', { name: 'Delete', exact: true });
      await hold.focus();
      await page.keyboard.down('Space');
      // A repeated start must not dispatch another mutation after this hold.
      await page.keyboard.down('Space');
      try {
        await row.waitFor({ state: 'detached' });
      } finally {
        await page.keyboard.up('Space');
      }
      await dialog.waitFor({ state: 'hidden' });
      expect(deleteRequests).toHaveLength(index + 1);
      expect(deleteRequests[index]).toBe(`/storage/drives/${driveId}/files/${encodeURIComponent(file.name)}`);
      expect(getStorageService()!.objects.get(driveId, file.path)).toBeNull();
      for (const remaining of files.slice(index + 1)) {
        expect(getStorageService()!.objects.get(driveId, remaining.path)?.id).toBe(remaining.id);
      }
      expect(await page.getByRole('alert').count()).toBe(0);
    }
    expect(await page.getByText('This folder is empty.', { exact: true }).isVisible()).toBe(true);
    expect(deleteRequests).toHaveLength(files.length);
    expect(pageErrors).toEqual([]);
    if (evidenceDirectory) {
      await page.screenshot({ path: join(evidenceDirectory, 'deleted-folder-refreshed.png'), fullPage: true });
    }
  } finally {
    await page.close();
  }
}, TEST_TIMEOUT);
