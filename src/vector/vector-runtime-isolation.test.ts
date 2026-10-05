/** App-local telemetry/publication checks using synthetic adapters only. */
import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureObservability, emitPlatformCodeTo, MemoryEventStore, OBS_CODES } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME, ZERO_VECTOR_SERVICE } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { resolveVectorConfig } from './vector-config';
import { createVectorPlugin } from './vector.plugin';
import { VectorRegistry } from './vector-registry';
import { VectorService, type VectorServiceOptions } from './vector-service';
import { ZvecAdapter, type ZvecAdapterOptions } from './zvec-adapter';
import type { VectorIndexStore } from './vector-types';

const running: Array<{ app: { stop: (closeActiveConnections?: boolean) => Promise<unknown> }; runtime: ZeroAppRuntime }> = [];
afterEach(async () => { for (const item of running.splice(0).reverse()) { await item.app.stop(); await item.runtime.dispose(); } });

test('managed vector operations/configuration retain their owning event store after ambient replacement', async () => {
  const first = startApp('synthetic-vector-a'), second = startApp('synthetic-vector-b');
  const ambient = configureObservability({ console: false });
  await first.runtime.require(ZERO_VECTOR_SERVICE).upsert({ id: 'synthetic', vector: [1, 2, 3] });
  expect(first.events.query({ code: OBS_CODES.VECTOR_OPERATION_COMPLETED.code }).count).toBe(1);
  expect(second.events.query({ code: OBS_CODES.VECTOR_OPERATION_COMPLETED.code }).count).toBe(0);
  expect(ambient.store!.query({ code: OBS_CODES.VECTOR_OPERATION_COMPLETED.code }).count).toBe(0);
  expect(first.events.query({ code: OBS_CODES.VECTOR_CONFIGURED.code }).count).toBe(1);
  expect(second.events.query({ code: OBS_CODES.VECTOR_CONFIGURED.code }).count).toBe(1);
});

test('explicit managed runtime requires observability before publishing a vector service', async () => {
  const runtime = new ZeroAppRuntime('synthetic-vector-missing-observability');
  let factoryCalls = 0;
  expect(() => createVectorPlugin({ config: config(), runtime, storeFactory: () => {
    factoryCalls++; return fakeStore();
  } })).toThrow('unavailable');
  expect(factoryCalls).toBe(0);
  expect(runtime.get(ZERO_VECTOR_SERVICE)).toBeNull();
  await runtime.dispose();
});

test('publication failure keeps awaited cleanup ownership and sanitizes the thrown composition error', async () => {
  const runtime = new ZeroAppRuntime('synthetic-vector-failed');
  const events = new MemoryEventStore();
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  let closed = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  expect(() => createVectorPlugin({ config: config(), runtime, storeFactory: () => fakeStore(async () => {
    await gate; closed = true;
  }), onServiceCreated(service) {
    void service.stats(); // Own the lazy synthetic store before publication fails.
    throw new Error('synthetic-private-callback');
  } })).toThrow(expect.objectContaining({ code: 'VECTOR_CONFIG_INVALID' }));
  const stopping = runtime.dispose();
  for (let count = 0; count < 12; count++) await Promise.resolve();
  expect(closed).toBe(false);
  release(); await stopping;
  expect(closed).toBe(true);
  expect(runtime.get(ZERO_VECTOR_SERVICE)).toBeNull();
  expect(JSON.stringify(events.query())).not.toContain('synthetic-private-callback');
});

test('explicit standalone and prebuilt service emitters are not rewritten by plugin ownership', async () => {
  const ownerEvents = new MemoryEventStore(), callerEvents = new MemoryEventStore();
  const owner = { sink: ownerEvents, store: ownerEvents, config: { console: false } };
  const caller = { sink: callerEvents, store: callerEvents, config: { console: false } };
  const emitCode: NonNullable<VectorServiceOptions['emitCode']> =
    (definition, event) => emitPlatformCodeTo(caller, definition, event);
  const service = new VectorService(new VectorRegistry({ config: config(), storeFactory: () => fakeStore() }), { emitCode });
  const runtime = new ZeroAppRuntime('synthetic-vector-prebuilt');
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, owner);
  const app = new Elysia().use(createVectorPlugin({ config: config(), runtime, service }));
  app.listen(0); running.push({ app, runtime });
  configureObservability({ console: false });
  await service.upsert({ id: 'synthetic', vector: [1, 2, 3] });
  expect(callerEvents.query({ code: OBS_CODES.VECTOR_OPERATION_COMPLETED.code }).count).toBe(1);
  expect(ownerEvents.query({ code: OBS_CODES.VECTOR_OPERATION_COMPLETED.code }).count).toBe(0);
  expect(ownerEvents.query({ code: OBS_CODES.VECTOR_CONFIGURED.code }).count).toBe(1);
});

test('lazy adapter ready/failure events use an explicit emitter without opening a native collection', async () => {
  const events = new MemoryEventStore(), target = { sink: events, store: events, config: { console: false } };
  const emitCode = (definition: Parameters<typeof emitPlatformCodeTo>[1], options?: Parameters<typeof emitPlatformCodeTo>[2]) =>
    emitPlatformCodeTo(target, definition, options);
  const ambient = configureObservability({ console: false });
  const index = { ...config().indexes.docs!, path: `./zero-vector-synthetic-${crypto.randomUUID()}` };
  // Native-shaped synthetic module: no real driver import, collection or file is created.
  const fakeModule = {
    ZVecDataType: { STRING: 0, DOUBLE: 1, BOOL: 2, VECTOR_FP32: 3 },
    ZVecIndexType: { INVERT: 0, HNSW: 1 }, ZVecMetricType: { COSINE: 0 },
    ZVecCollectionSchema: class { constructor(_options: unknown) {} },
    ZVecCreateAndOpen() { return { stats: { docCount: 0, indexCompleteness: {} }, closeSync() {} }; },
  } as unknown as Awaited<ReturnType<NonNullable<ZvecAdapterOptions['loader']>>>;
  const ready = new ZvecAdapter({ config: index, emitCode, loader: async () => fakeModule });
  await ready.stats(); await ready.dispose();
  expect(events.query({ code: OBS_CODES.VECTOR_INDEX_READY.code }).count).toBe(1);
  const failed = new ZvecAdapter({ config: index, emitCode, loader: async () => { throw new Error('Synthetic adapter unavailable'); } });
  await expect(failed.stats()).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED' });
  expect(events.query({ code: OBS_CODES.VECTOR_INDEX_FAILED.code }).count).toBe(1);
  expect(ambient.store!.query({ code: OBS_CODES.VECTOR_INDEX_READY.code }).count).toBe(0);
  expect(ambient.store!.query({ code: OBS_CODES.VECTOR_INDEX_FAILED.code }).count).toBe(0);
});

function config() {
  const value = resolveVectorConfig({ defaultIndex: 'docs', indexes: { docs: 3 } }, {});
  if (!value) throw new Error('Synthetic config required');
  return value;
}
function fakeStore(dispose: () => Promise<void> = async () => {}): VectorIndexStore {
  return {
    config: config().indexes.docs!,
    async upsert(records) { return { ok: true, count: records.length, errors: [] }; },
    async query() { return []; }, async fetch() { return []; },
    async delete() { return { ok: true, count: 0, errors: [] }; },
    async deleteWhere() { return { ok: true, count: 0, errors: [] }; },
    async stats() { return { index: 'docs', path: 'synthetic', dimensions: 3, documentCount: 0, indexCompleteness: {} }; },
    async optimize() {}, dispose,
  };
}
function startApp(id: string) {
  const runtime = new ZeroAppRuntime(id), events = new MemoryEventStore();
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  const app = new Elysia({ name: id }).use(createVectorPlugin({ config: config(), runtime, storeFactory: () => fakeStore() }));
  app.listen(0); running.push({ app, runtime }); return { app, runtime, events };
}
