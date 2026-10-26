/** Actual Fabric/ReactiveDB appends, retained cursors and scope-filtered membership; no fabricated row-change events. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { MemoryEventStore } from '../observability/memory-event-store';
import { loggingEvent } from './test-support/logging-fixture';
import { createLoggingProjectionStream } from './logging-stream';
import type { LoggingChangePage } from './logging-contracts';

test('reactive append cursors drain bursts beyond a latest-page window, preserve replay safety and enforce tenant/actor membership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-reactive-cursor-'));
  const store = new MemoryEventStore();
  const runtime = await LoggingRuntime.open(resolveManagedLoggingConfig({ rootDirectory: root, preset: 'activity' }, root) as ResolvedManagedLoggingConfig,
    { sink: store, store, config: { console: false } });
  const abort = new AbortController();
  try {
    const scope = { kind: 'tenant', tenantId: 'tenant-a' } as const, query = { actorId: 'fixture-user', limit: 17 };
    const initial = await runtime.page('audit', scope, query);
    const body = createLoggingProjectionStream(runtime, 'audit', initial, () => runtime.page('audit', scope, query), abort.signal,
      { afterOrdinal: initial.highWaterOrdinal, read: after => runtime.changes('audit', scope, query, after) });
    const events = Array.from({ length: 205 }, (_, i) => loggingEvent('burst-' + i, i % 3 === 0 ? 'tenant-b' : 'tenant-a'));
    await Promise.all(events.map(event => runtime.deliver(event)));
    const head = (await runtime.page('audit', scope, { limit: 1 })).highWaterOrdinal;
    const reader = body.getReader(), decoder = new TextDecoder(), seen: string[] = [];
    let cursor = 0;
    while (cursor < head) {
      const packet = JSON.parse(decoder.decode((await reader.read()).value).split('data: ')[1]!.trim()) as { changes?: LoggingChangePage };
      if (!packet.changes) continue;
      const delta = packet.changes;
      expect(delta.afterOrdinal).toBe(cursor); expect(delta.events.length).toBeLessThanOrEqual(17);
      expect(delta.events.every(row => row.event.scope.tenantId === 'tenant-a')).toBe(true);
      seen.push(...delta.events.map(row => row.event.id)); cursor = delta.throughOrdinal;
    }
    expect(seen).toEqual(events.filter(event => event.scope.tenantId === 'tenant-a').map(event => event.id));
    expect(new Set(seen).size).toBe(seen.length);
    await runtime.deliver(events[1]!);
    expect((await runtime.changes('audit', scope, query, cursor)).events).toHaveLength(0);
    const ids = events.slice(0, 5).map(event => JSON.stringify([event.sourceId, event.id]));
    const matching = await runtime.page('audit', scope, { ...query, eventIds: ids });
    expect(matching.events.map(row => row.event.id)).toEqual(['burst-4', 'burst-2', 'burst-1']);
    expect((await runtime.page('audit', scope, { ...query, eventIds: ids, actorId: 'different-user' })).events).toHaveLength(0);
    expect((await runtime.page('audit', scope, { eventIds: [] })).events).toHaveLength(0);
    await reader.cancel();
  } finally { abort.abort(); await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
