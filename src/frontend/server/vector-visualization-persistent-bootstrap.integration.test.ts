/** File-backed createApp bootstrap regression; no native indexes or provider work are opened. */
import { afterEach, describe, expect, it } from 'bun:test';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProviderV4 } from '@ai-sdk/provider';
import { MockEmbeddingModelV4 } from 'ai/test';
import { migrations } from '../../migrations';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../../persistence';
import { vectorVisualizationSchemaReady } from '../../vector/visualization-admission';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE } from '../../vector/visualization-schema';
import { createApp } from './app-factory';
import type { AppConfig } from './types';

type App = Awaited<ReturnType<typeof createApp>>;
const roots: string[] = [], handles: PlatformSQLiteService[] = [], apps: App[] = [];

afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop(true);
  for (const sqlite of handles.splice(0)) sqlite.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory() {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'vector-persistent-bootstrap-'));
  roots.push(root);
  await mkdir(join(root, 'app'));
  return root;
}

function fixture(root: string, enabled: boolean, migrate = true) {
  const application = createPlatformSQLiteService({ mode: 'file', path: join(root, 'application.db') });
  const system = createPlatformSQLiteService({ mode: 'file', path: join(root, 'system.db') });
  handles.push(application, system);
  const embedding = new MockEmbeddingModelV4({ maxEmbeddingsPerCall: 16, supportsParallelCalls: true,
    doEmbed: async () => { throw new Error('Bootstrap must not execute a provider'); } });
  const provider: ProviderV4 = { specificationVersion: 'v4', embeddingModel: () => embedding,
    languageModel: () => { throw new Error('Bootstrap cannot invoke a language model'); },
    imageModel: () => { throw new Error('Bootstrap cannot invoke an image model'); } };
  const config: AppConfig = {
    db: { sqlite: application }, systemDb: { sqlite: system },
    tables: { application_records: { id: 'TEXT PRIMARY KEY', title: 'TEXT NOT NULL' } },
    auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'single', authorization: {
      mode: 'simple', permissions: { 'documents:search': { label: 'Search documents' }, 'documents:ingest': { label: 'Ingest documents' } },
      roles: { admin: { permissions: ['documents:search', 'documents:ingest'] }, user: { permissions: ['documents:search', 'documents:ingest'] } },
    } },
    ai: { autoDetect: false, providers: { fixture: { type: 'custom', adapter: provider, capabilities: { embeddings: true } } }, aliases: { embedding: 'fixture/embedding-three' } },
    vector: { defaultIndex: 'docs', indexes: { docs: { dimensions: 3, path: join(root, 'unopened-corpus'), metadata: { corpus_scope: 'string' } } } },
    vectorVisualization: enabled ? { indexes: { docs: { scopeField: 'corpus_scope', searchPermission: 'documents:search', ingestPermission: 'documents:ingest', embeddingModel: 'embedding' } } } : false,
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    resourceRoutes: false, workflows: false, observability: false, email: false, pdf: false, kv: false, migrate,
  };
  return { root, application, system, embedding, config };
}

async function start(root: string, enabled: boolean, migrate = true) {
  const f = fixture(root, enabled, migrate);
  const app = await createApp(f.config); apps.push(app); app.listen(0);
  return { ...f, app };
}

async function stop(f: Awaited<ReturnType<typeof start>>) {
  await f.app.stop(true); apps.splice(apps.indexOf(f.app), 1);
  for (const sqlite of [f.application, f.system]) { sqlite.close(); handles.splice(handles.indexOf(sqlite), 1); }
}

function hasTable(sqlite: PlatformSQLiteService, name: string) {
  return Boolean(sqlite.raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function history(sqlite: PlatformSQLiteService) {
  return sqlite.raw.query('SELECT version,checksum,status,direction FROM _zero_migrations ORDER BY id').all();
}

function featureObjects(sqlite: PlatformSQLiteService) {
  return sqlite.raw.query("SELECT name,type,sql FROM sqlite_master WHERE name IN ('vector_visualization_operations','_vector_visualization_maps','idx_vector_visualization_owner','vector_visualization_feed') ORDER BY name").all();
}

function expectFeaturePlane(f: ReturnType<typeof fixture>, enabled: boolean) {
  for (const table of [VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE]) {
    expect(hasTable(f.application, table)).toBe(false);
    expect(hasTable(f.system, table)).toBe(enabled);
  }
  expect(f.embedding.doEmbedCalls).toHaveLength(0);
}

describe.serial('persistent vector visualization bootstrap', () => {
  it('starts a fresh file-backed managed app, restarts and disables without poisoning core migration history', async () => {
    const root = await directory();
    const first = await start(root, true);
    expectFeaturePlane(first, true);
    expect(vectorVisualizationSchemaReady({ prepare: sql => first.system.raw.query(sql) })).toBe(true);
    const coreHistory = history(first.system), installed = featureObjects(first.system);
    expect(coreHistory).toHaveLength(migrations.length);
    expect(coreHistory.some(row => (row as { version: string }).version === 'vector_visualization_001')).toBe(false);
    await stop(first);

    const restarted = await start(root, true);
    expectFeaturePlane(restarted, true);
    expect(history(restarted.system)).toEqual(coreHistory);
    expect(featureObjects(restarted.system)).toEqual(installed);
    await stop(restarted);

    const disabled = await start(root, false);
    // Disabling hides the feature but never destroys retained optional data.
    expectFeaturePlane(disabled, true);
    expect(history(disabled.system)).toEqual(coreHistory);
    expect(featureObjects(disabled.system)).toEqual(installed);
    await stop(disabled);

    const readmitted = await start(root, true, false);
    expectFeaturePlane(readmitted, true);
    expect(history(readmitted.system)).toEqual(coreHistory);
    await expect(access(join(root, 'unopened-corpus'))).rejects.toThrow();
    await stop(readmitted);
  }, 60_000);

  it('enables later on an existing core-migrated app while migrate:false refuses to provision missing feature objects', async () => {
    const root = await directory();
    const disabled = await start(root, false);
    expectFeaturePlane(disabled, false);
    const coreHistory = history(disabled.system);
    expect(coreHistory).toHaveLength(migrations.length);
    await stop(disabled);

    const refused = fixture(root, true, false);
    await expect(createApp(refused.config)).rejects.toThrow();
    expectFeaturePlane(refused, false);
    expect(history(refused.system)).toEqual(coreHistory);
    expect(featureObjects(refused.system)).toEqual([]);
    for (const sqlite of [refused.application, refused.system]) { sqlite.close(); handles.splice(handles.indexOf(sqlite), 1); }

    const enabled = await start(root, true);
    expectFeaturePlane(enabled, true);
    expect(history(enabled.system)).toEqual(coreHistory);
    await expect(access(join(root, 'unopened-corpus'))).rejects.toThrow();
    await stop(enabled);

    const disabledAgain = await start(root, false);
    expectFeaturePlane(disabledAgain, true);
    expect(history(disabledAgain.system)).toEqual(coreHistory);
    await stop(disabledAgain);
  }, 60_000);
});
