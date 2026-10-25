/** Public strict preset through real createApp, Guardian, HTTP, Sync and private workers. Synthetic files only. */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from './server-extensions';
import type { AppConfig } from './types';
import type { ServerRouteServices } from './server-services';

function config(root: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return { projectRoot: root,
    db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
    systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' },
    tables: { items: { id: 'text primary key', content: 'text' } },
    auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
    logging: { preset: 'compliance', rootDirectory: 'logging', metadataKeys: ['rowCount'] },
    workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
    appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
    serverRoutesDir: false, resourceRoutes: false, observability: { console: false }, ...overrides };
}

test('strict source preflight rejects weak control durability before opening app, system or log files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-strict-preflight-'));
  try {
    for (const overrides of [{ db: { mode: 'memory' } }, { db: { mode: 'hot', path: join(root, 'application.db') } },
      { systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'NORMAL' } }, { auth: false }] as const) {
      await expect(createApp(config(root, overrides as Partial<AppConfig>))).rejects.toMatchObject({ code: 'LOGGING_CONFIG_INVALID' });
      expect(existsSync(join(root, 'application.db'))).toBe(false); expect(existsSync(join(root, 'system.db'))).toBe(false);
      expect(existsSync(join(root, 'logging'))).toBe(false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public compliance policy admits custom logging, scoped writes, private exports and Sync only under current delivery authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-strict-managed-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined, services: ServerRouteServices | undefined;
  let calls = 0;
  const sockets: WebSocket[] = [];
  try {
    await mkdir(join(root, 'app'));
    app = await createApp(config(root, { serverExtensions: [
      defineZeroPlugin({ name: 'strict-inspection', setup({ zero }) { services = zero; } }),
      defineRouter({ name: 'strict-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
        defineEndpoint({ method: 'POST', path: '/create', handler: async ({ zero }) => {
          calls++;
          await zero.logging!.run(() => zero.db!.create('items', { id: 'item-a', content: 'SYNTHETIC_PRIVATE_RECORD' }));
          await zero.logging!.record({ id: 'custom.stage-a', family: 'workflow', action: 'app.report.prepared', occurredAt: 1800000000000,
            outcome: 'succeeded', evidence: 'server-confirmed', target: { type: 'report', id: 'opaque-report' }, metadata: { rowCount: 1 } });
          return { created: true };
        } }),
        defineEndpoint({ method: 'GET', path: '/read', handler: ({ zero }) => zero.logging!.read({ type: 'item', id: 'item-a' }, () => ({ prepared: true })) }),
      ] }),
    ] }));
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = `http://127.0.0.1:${app.server!.port}`;
    expect(services!.logging!.diagnostics().coverage.complianceReady).toBe(true);
    const call = (path: string, body?: unknown, token?: string) => fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const registered = await call('/auth/register', { username: 'strict-owner', email: 'strict-owner@example.test', password: 'Fixture-password-123!' });
    expect(registered.status, await registered.clone().text()).toBe(200);
    const user = await registered.json() as { accessToken: string; user: { userId: string } };
    expect((await call('/proof/create', {}, user.accessToken)).status).toBe(428); expect(calls).toBe(0);
    const connect = () => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + '/sync'); sockets.push(ws);
      const outcome = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { ws.close(); reject(new Error('Sync qualification timed out')); }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'sync.auth', token: user.accessToken }));
        ws.onmessage = event => { if (typeof event.data === 'string' && JSON.parse(event.data).type === 'sync.auth.ready') { clearTimeout(timer); resolve('ready'); } };
        ws.onclose = () => { clearTimeout(timer); resolve('closed'); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('Sync qualification failed')); };
      });
      return { ws, outcome };
    };
    expect(await connect().outcome).toBe('closed');
    const acknowledge = () => call('/api/_zero/logging/observations', { observations: [], policyVersion: services!.logging!.config.policyVersion }, user.accessToken);
    expect((await acknowledge()).status).toBe(200);
    expect(await connect().outcome).toBe('ready');
    const created = await call('/proof/create', {}, user.accessToken); expect(created.status, await created.clone().text()).toBe(200); expect(calls).toBe(1);
    expect((await call('/proof/read', undefined, user.accessToken)).status).toBe(200);
    await services!.logging!.flush();
    const page = await services!.logging!.page('audit', { kind: 'platform' }, { action: 'app.report.prepared' });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.event).toMatchObject({ actor: { id: user.user.userId }, scope: { kind: 'application', tenantId: null }, metadata: { rowCount: 1 } });
    const exportResponse = await call('/api/_zero/logging/exports/create', { id: 'strict.export-one', stream: 'audit', query: { action: 'app.report.prepared' } }, user.accessToken);
    expect(exportResponse.status, await exportResponse.clone().text()).toBe(200);
    const artifact = await exportResponse.json() as { id: string; state: string; sha256: string };
    expect(artifact.state).toBe('ready');
    const download = await call('/api/_zero/logging/exports/download', { id: artifact.id }, user.accessToken);
    expect(download.status).toBe(200); const bytes = new Uint8Array(await download.arrayBuffer());
    expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    expect(new TextDecoder().decode(bytes)).not.toMatch(/SYNTHETIC_PRIVATE_RECORD|Fixture-password|strict-owner@example/);
    expect((await call('/api/_zero/logging/export', { stream: 'audit', query: {} }, user.accessToken)).status).toBe(403);
    services!.logging!.admission.invalidate();
    expect((await call('/proof/read', undefined, user.accessToken)).status).toBe(428);
    expect(await connect().outcome).toBe('closed');
    expect((await acknowledge()).status).toBe(200);
    expect((await call('/proof/read', undefined, user.accessToken)).status).toBe(200);
    services!.auth.store!.updateUser(user.user.userId, { role: 'user' });
    expect((await call('/proof/read', undefined, user.accessToken)).status).toBe(428);
    expect((await acknowledge()).status).toBe(200);
    expect((await call('/api/_zero/logging/exports/download', { id: artifact.id }, user.accessToken)).status).toBe(403);
  } finally { for (const ws of sockets) ws.close(); await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
