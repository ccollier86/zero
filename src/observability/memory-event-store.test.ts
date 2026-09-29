import { describe, expect, it } from 'bun:test';
import { OBS_CODES } from './codes';
import { MemoryEventStore } from './memory-event-store';
import {
  configureObservability,
  emitPlatformCode,
  emitPlatformCodeTo,
} from './sink';
import type { PlatformObservabilityRuntime } from './types';

describe('MemoryEventStore', () => {
  it('retains only the newest events within the configured limit', () => {
    const store = new MemoryEventStore({ maxEvents: 2 });
    configureObservability({ console: false, store });

    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, { metadata: { n: 1 } });
    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED, { metadata: { n: 2 } });
    emitPlatformCode(OBS_CODES.APP_SHUTDOWN_SIGNAL, { metadata: { n: 3 } });

    const page = store.query({ limit: 10 });
    expect(page.count).toBe(2);
    expect(page.events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
      OBS_CODES.APP_SHUTDOWN_SIGNAL.code,
    ]);
  });

  it('filters events by level, category, code, source, and cursor', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });

    const first = emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY);
    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED);
    const third = emitPlatformCode(OBS_CODES.FRONTEND_RENDER_ERROR, { source: 'frontend' });

    expect(store.query({ level: 'warn' }).events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
    ]);
    expect(store.query({ category: 'frontend' }).events[0].id).toBe(third.id);
    expect(store.query({ code: OBS_CODES.APP_CLIENT_BUNDLE_READY.code }).events[0].id).toBe(first.id);
    expect(store.query({ source: 'frontend' }).events[0].id).toBe(third.id);
    expect(store.query({ cursor: first.sequence }).events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
      OBS_CODES.FRONTEND_RENDER_ERROR.code,
    ]);
  });

  it('assigns sequences within each app runtime without sibling-volume gaps', () => {
    const firstStore = new MemoryEventStore();
    const secondStore = new MemoryEventStore();
    const firstRuntime: PlatformObservabilityRuntime = {
      sink: firstStore,
      store: firstStore,
      config: { console: false, store: firstStore },
    };
    const secondRuntime: PlatformObservabilityRuntime = {
      sink: secondStore,
      store: secondStore,
      config: { console: false, store: secondStore },
    };

    const first = emitPlatformCodeTo(
      firstRuntime,
      OBS_CODES.APP_CLIENT_BUNDLE_READY,
    );
    const sibling = emitPlatformCodeTo(
      secondRuntime,
      OBS_CODES.APP_CLIENT_BUNDLE_READY,
    );
    const second = emitPlatformCodeTo(
      firstRuntime,
      OBS_CODES.APP_SHUTDOWN_SIGNAL,
    );

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(sibling.sequence).toBe(1);
    expect(firstStore.query().events.map((event) => event.id)).toEqual([
      'obs_1', 'obs_2',
    ]);
    expect(secondStore.query().events.map((event) => event.id)).toEqual([
      'obs_1',
    ]);
  });
});
