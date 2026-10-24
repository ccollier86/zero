/** Full managed createApp route and Guardian boundaries over private real log actors. Synthetic temporary data only. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app-factory';
import { defineEndpoint, defineRouter, defineZeroPlugin } from './server-extensions';
import type { LoggingRuntime } from '../../logging/logging-runtime';
import type { ServerRouteServices } from './server-services';

test('managed logging captures Guardian and attributed records, admits browser-only evidence, and protects investigation/export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-logging-api-')); let app: Awaited<ReturnType<typeof createApp>> | undefined, logger: LoggingRuntime | null = null, services: ServerRouteServices | null = null;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({ projectRoot: root, db: { mode: 'file', path: join(root, 'application.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') },
      tables: { items: { id: 'text primary key', content: 'text' } }, auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      logging: { preset: 'detailed', rootDirectory: 'logging' }, workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
      appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      observability: { console: false }, serverExtensions: [defineZeroPlugin({ name: 'capture-logger', setup({ zero }) { logger = zero.logging; services = zero; } }), defineRouter({ name: 'logging-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
        defineEndpoint({ method: 'POST', path: '/create', handler: ({ zero }) => zero.logging!.run(() => { zero.db!.create('items', { id: 'item-a', content: 'SYNTHETIC_DO_NOT_LOG' }); return { created: true }; }) }),
        defineEndpoint({ method: 'GET', path: '/read', handler: ({ zero }) => zero.logging!.read({ type: 'item', id: 'item-a' }, () => ({ permitted: true })) }),
      ] })] });
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = `http://127.0.0.1:${app.server!.port}`;
    const call = async (path: string, body?: unknown, token?: string) => {
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, headers: response.headers, value: await response.json() as any };
    };
    const owner = await call('/auth/register', { username: 'logging-owner', email: 'logging-owner@example.test', password: 'Fixture-password-123!' });
    expect(owner.status, JSON.stringify(owner.value)).toBe(200);
    const user = await call('/auth/register', { username: 'logging-user', email: 'logging-user@example.test', password: 'Fixture-password-123!' }); expect(user.status).toBe(200);
    expect((await call('/api/_zero/logging/events', { stream: 'audit', query: {} })).status).toBe(401);
    expect((await call('/api/_zero/logging/events', { stream: 'audit', query: {} }, user.value.accessToken)).status).toBe(403);
    expect((await call('/proof/create', {}, user.value.accessToken)).status).toBe(200);
    await logger!.flush();
    const changes = await call('/api/_zero/logging/events', { stream: 'audit', query: { action: 'record.created' } }, owner.value.accessToken);
    expect(changes.status, JSON.stringify(changes.value)).toBe(200); expect(changes.headers.get('cache-control')).toContain('no-store');
    expect(changes.value.events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ actor: expect.objectContaining({ id: user.value.user.userId }), target: { type: 'table.items', id: 'item-a' } }) }));
    expect(JSON.stringify(changes.value)).not.toContain('SYNTHETIC_DO_NOT_LOG');
    const observed = await call('/api/_zero/logging/observations', { observations: [{ id: 'print-a', collectorId: 'browser-a', action: 'print.requested', occurredAt: Date.now() }] }, user.value.accessToken);
    expect(observed.status, JSON.stringify(observed.value)).toBe(200); expect(observed.value.accepted).toBe(1);
    const forged = await call('/api/_zero/logging/observations', { observations: [{ id: 'bad-a', collectorId: 'browser-a', action: 'record.created', occurredAt: Date.now() }] }, user.value.accessToken); expect(forged.status).toBe(422);
    const extraScope = await call('/api/_zero/logging/events', { stream: 'audit', query: {}, scope: 'platform' }, owner.value.accessToken);
    // Elysia normalizes unknown DTO fields away; it must never promote this
    // untrusted selector into the private platform query capability.
    expect(extraScope.status).toBe(200); expect(extraScope.value.events.every((row: any) => row.event.scope.kind === 'application')).toBe(true);
    expect((await call('/proof/read', undefined, user.value.accessToken)).status).toBe(200);
    const exported = await call('/api/_zero/logging/export', { stream: 'audit', query: { family: 'security' } }, owner.value.accessToken);
    expect(exported.status, JSON.stringify(exported.value)).toBe(200); expect(exported.value.count).toBeGreaterThan(0);
    expect(new Bun.CryptoHasher('sha256').update(exported.value.ndjson).digest('hex')).toBe(exported.value.sha256);
    expect((await call('/api/_zero/logging/export', { stream: 'audit', query: {} }, user.value.accessToken)).status).toBe(403);
    const verification = await call('/api/_zero/logging/verify', { stream: 'audit', afterOrdinal: 0 }, owner.value.accessToken);
    expect(verification.status, JSON.stringify(verification.value)).toBe(200); expect(verification.value.checked).toBeGreaterThan(0);
    expect((await call('/api/_zero/logging/platform/events', { stream: 'audit', query: {} }, owner.value.accessToken)).status).toBe(200);
    expect((await call('/api/_zero/logging/platform/events', { stream: 'audit', query: {} }, user.value.accessToken)).status).toBe(403);
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetch(origin + '/api/_zero/logging/stream', { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + owner.value.accessToken }, body: JSON.stringify({ stream: 'audit', query: { action: 'print.requested', limit: 5 } }) });
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let text = '';
      const receiveUntil = async (predicate: (packet: any) => boolean) => {
        for (let n = 0; n < 20; n++) {
          const chunk = await reader.read(); if (chunk.done) throw new Error('Stream ended before expected projection.');
          text += decoder.decode(chunk.value, { stream: true });
          for (let newline; (newline = text.indexOf('\n')) >= 0;) {
            const line = text.slice(0, newline); text = text.slice(newline + 1); if (line.startsWith('data: ') && predicate(JSON.parse(line.slice(6)))) return;
          }
        }
        throw new Error('Expected committed projection was not delivered.');
      };
      await receiveUntil(packet => Array.isArray(packet.page?.events));
      expect((await call('/api/_zero/logging/observations', { observations: [{ id: 'print-stream', collectorId: 'browser-a', action: 'print.requested', occurredAt: Date.now() }] }, user.value.accessToken)).status).toBe(200);
      await receiveUntil(packet => packet.page?.events.some((row: any) => row.event.id === 'print-stream'));
      services!.auth.store!.updateUser(owner.value.user.userId, { role: 'user' });
      // Cause a wakeup after revocation; it must terminate, not leak another page.
      expect((await call('/api/_zero/logging/observations', { observations: [{ id: 'print-after-revoke', collectorId: 'browser-a', action: 'print.requested', occurredAt: Date.now() }] }, user.value.accessToken)).status).toBe(200);
      await receiveUntil(packet => packet.error === 'LOGGING_SUBSCRIPTION_ENDED');
      await reader.cancel();
    } finally { clearTimeout(timeout); abort.abort(); }
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
