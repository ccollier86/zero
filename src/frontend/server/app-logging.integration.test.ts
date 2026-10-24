/** Managed createApp integration: real log workers, app-local observability and disposable synthetic files only. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app-factory';
import { prepareAppBuild } from './app-build';
import { defineZeroPlugin } from './server-extensions';
import { resolveConfig, type AppConfig } from './types';
import { LoggingRuntime } from '../../logging/logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from '../../logging/logging-managed-config';
import { MemoryEventStore } from '../../observability/memory-event-store';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import type { ServerObservabilityServices } from './server-services';

function config(root: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return { projectRoot: root, db: { mode: 'memory' }, tables: {}, auth: false, workflows: false, email: false, ai: false, kv: false, pdf: false,
    appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    // Backend-only fixture: no generated browser/style assets are needed.
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    migrate: false, serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    resourceRoutes: false, observability: { console: false }, ...overrides };
}
function fallback(): PlatformObservabilityRuntime { const store = new MemoryEventStore(); return { store, sink: store, config: {} }; }
function storage(root: string): ResolvedManagedLoggingConfig {
  return resolveManagedLoggingConfig({ rootDirectory: join(root, 'logs') }, root) as ResolvedManagedLoggingConfig;
}

test('createApp opens logging before plugin setup, retains diagnostics through shutdown, and leaves application data separate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-logging-')); let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let logger: LoggingRuntime | undefined;
  try {
    await mkdir(join(root, 'app'));
    const store = new MemoryEventStore();
    app = await createApp(config(root, { logging: { rootDirectory: 'logs' }, observability: { console: false, store }, serverExtensions: [defineZeroPlugin({
      name: 'logging-fixture', setup({ zero, app }) {
        zero.observability.emitEvent({ level: 'warn', category: 'fixture', code: 'fixture.setup', message: 'Synthetic private payload', metadata: { email: 'synthetic-private' } });
        expect(zero.sql!.raw.query("SELECT name FROM sqlite_master WHERE name LIKE 'logging_%'").all()).toHaveLength(0);
        app.onStop(() => { zero.observability.emitEvent({ level: 'warn', category: 'fixture', code: 'fixture.drain', message: 'Synthetic shutdown event' }); });
      },
    })] }));
    await Promise.all([app.stop(), app.stop()]); app = undefined;
    logger = await LoggingRuntime.open(storage(root), fallback());
    const setup = await logger.page('operational', { kind: 'platform' }, { action: 'fixture.setup' });
    expect(setup.events).toHaveLength(1);
    expect(setup.events[0]?.event.metadata).toEqual({ category: 'fixture' });
    expect(JSON.stringify(setup)).not.toContain('synthetic-private');
    expect((await logger.page('operational', { kind: 'platform' }, { action: 'fixture.drain' })).events).toHaveLength(1);
    expect((await logger.page('audit', { kind: 'platform' })).events).toHaveLength(0);
    expect(store.query({ code: 'fixture.setup' }).count).toBe(1);
  } finally { await app?.stop(); await logger?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test('logging is absent by default and failed app construction releases an adopted logging owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-logging-failure-')); let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let logger: LoggingRuntime | undefined;
  try {
    await mkdir(join(root, 'app'));
    app = await createApp(config(root)); await app.stop(); app = undefined;
    expect(existsSync(join(root, 'data', 'zero.logs'))).toBe(false);
    await expect(createApp(config(root, { logging: { rootDirectory: 'logs' }, serverExtensions: [defineZeroPlugin({
      name: 'intentional-failure', setup() { throw new Error('Synthetic late app failure'); },
    })] }))).rejects.toThrow('Synthetic late app failure');
    logger = await LoggingRuntime.open(storage(root), fallback());
    expect(logger.diagnostics().state).toBe('ready');
  } finally { await app?.stop(); await logger?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test('two managed apps keep independent diagnostic capture and stopping one does not replace the other sink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-logging-isolated-'));
  const apps: Awaited<ReturnType<typeof createApp>>[] = [], readers: LoggingRuntime[] = [];
  const emissions: ServerObservabilityServices[] = [];
  try {
    for (const name of ['first', 'second']) {
      const ownRoot = join(root, name); await mkdir(join(ownRoot, 'app'), { recursive: true });
      apps.push(await createApp(config(ownRoot, { logging: { rootDirectory: 'logs' }, serverExtensions: [defineZeroPlugin({
        name: 'capture-' + name, setup({ zero }) { emissions.push(zero.observability); },
      })] })));
    }
    emissions[0]!.emitEvent({ level: 'warn', category: 'fixture', code: 'fixture.first', message: 'First only' });
    emissions[1]!.emitEvent({ level: 'warn', category: 'fixture', code: 'fixture.second', message: 'Second only' });
    await apps[0]!.stop();
    emissions[1]!.emitEvent({ level: 'warn', category: 'fixture', code: 'fixture.second_after', message: 'Still second only' });
    await apps[1]!.stop();
    for (const name of ['first', 'second']) readers.push(await LoggingRuntime.open(storage(join(root, name)), fallback()));
    expect((await readers[0]!.page('operational', { kind: 'platform' }, { action: 'fixture.first' })).events).toHaveLength(1);
    expect((await readers[0]!.page('operational', { kind: 'platform' }, { action: 'fixture.second' })).events).toHaveLength(0);
    expect((await readers[1]!.page('operational', { kind: 'platform' }, { action: 'fixture.first' })).events).toHaveLength(0);
    expect((await readers[1]!.page('operational', { kind: 'platform' }, { action: 'fixture.second_after' })).events).toHaveLength(1);
  } finally {
    await Promise.all(apps.map(app => app.stop())); await Promise.all(readers.map(reader => reader.close()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test('build and startup reject unsafe logging roots before asset/database mutation, including filesystem aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-logging-paths-'));
  try {
    await mkdir(join(root, 'app')); await mkdir(join(root, 'build')); await symlink(join(root, 'build'), join(root, 'alias'));
    expect(() => resolveConfig(config(root, { logging: { rootDirectory: 'build/logs' } }))).toThrow(expect.objectContaining({ code: 'LOGGING_CONFIG_INVALID' }));
    await expect(createApp(config(root, { logging: { rootDirectory: 'alias/logs' } }))).rejects.toMatchObject({ code: 'LOGGING_CONFIG_INVALID' });
    await expect(prepareAppBuild(config(root, { logging: { rootDirectory: 'alias/logs' } }))).rejects.toMatchObject({ code: 'LOGGING_CONFIG_INVALID' });
    expect(existsSync(join(root, 'alias', 'logs'))).toBe(false);
    expect(existsSync(join(root, 'generated'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
