import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { MemoryEventStore, OBS_CODES } from '../observability';
import {
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_PLATFORM_TOKEN_SERVICE,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createPlatformTokenPlugin } from './token.plugin';

interface RunningTokenApp {
  app: any;
  db: ReactiveDB;
  runtime: ZeroAppRuntime;
  events: MemoryEventStore;
}

const running: RunningTokenApp[] = [];

afterEach(async () => {
  for (const instance of running.splice(0).reverse()) {
    await instance.app.stop();
    await instance.runtime.dispose();
    instance.db.dispose();
  }
});

describe('platform token runtime isolation', () => {
  test('keeps action creation and consumption emissions in the owning app', () => {
    const appA = startTokenApp('platform-tokens-a');
    const appB = startTokenApp('platform-tokens-b');
    const serviceA = appA.runtime.require(ZERO_PLATFORM_TOKEN_SERVICE);
    const serviceB = appB.runtime.require(ZERO_PLATFORM_TOKEN_SERVICE);

    const actionA = serviceA.createActionToken({
      purpose: 'runtime-isolation-a',
      cooldown: false,
    });
    serviceA.consumeActionToken(actionA.rawToken);

    expect(eventCount(appA, OBS_CODES.TOKENS_ACTION_CREATED.code)).toBe(1);
    expect(eventCount(appA, OBS_CODES.TOKENS_ACTION_CONSUMED.code)).toBe(1);
    expect(eventCount(appB, OBS_CODES.TOKENS_ACTION_CREATED.code)).toBe(0);
    expect(eventCount(appB, OBS_CODES.TOKENS_ACTION_CONSUMED.code)).toBe(0);

    const actionB = serviceB.createActionToken({
      purpose: 'runtime-isolation-b',
      cooldown: false,
    });
    serviceB.consumeActionToken(actionB.rawToken);

    expect(eventCount(appA, OBS_CODES.TOKENS_ACTION_CREATED.code)).toBe(1);
    expect(eventCount(appA, OBS_CODES.TOKENS_ACTION_CONSUMED.code)).toBe(1);
    expect(eventCount(appB, OBS_CODES.TOKENS_ACTION_CREATED.code)).toBe(1);
    expect(eventCount(appB, OBS_CODES.TOKENS_ACTION_CONSUMED.code)).toBe(1);
    expect(eventCount(appA, OBS_CODES.TOKENS_STARTED.code)).toBe(1);
    expect(eventCount(appB, OBS_CODES.TOKENS_STARTED.code)).toBe(1);
  });

  test('fails managed plugin composition before lifecycle setup without observability', () => {
    const db = createReactiveDB({ mode: 'memory' });
    const runtime = new ZeroAppRuntime('platform-tokens-missing-observability');

    expect(() => createPlatformTokenPlugin({ db, runtime }))
      .toThrow('Observability runtime is unavailable');

    db.dispose();
  });
});

function startTokenApp(id: string): RunningTokenApp {
  const db = createReactiveDB({ mode: 'memory' });
  const runtime = new ZeroAppRuntime(id);
  const events = new MemoryEventStore({ maxEvents: 50 });
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false },
  });
  const app = new Elysia({ name: id }).use(createPlatformTokenPlugin({ db, runtime }));
  app.listen(0);

  const instance = { app, db, runtime, events };
  running.push(instance);
  return instance;
}

function eventCount(app: RunningTokenApp, code: string): number {
  return app.events.query({ code }).events.length;
}
