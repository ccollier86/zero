import { expect, test } from 'bun:test';

import { MemoryEventStore } from '../observability';
import { OBS_CODES } from '../observability/codes';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createAuthPlatformCodeEmitter } from './auth-observability';

test('managed auth observability resolves eagerly and remains app-bound', () => {
  const missing = new ZeroAppRuntime('auth-observability-missing');
  expect(() => createAuthPlatformCodeEmitter(missing))
    .toThrow('Observability runtime is unavailable');

  const runtime = new ZeroAppRuntime('auth-observability-local');
  const events = new MemoryEventStore({ maxEvents: 10 });
  const observability = {
    sink: events,
    store: events,
    config: { console: false },
  };
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, observability);
  const emitCode = createAuthPlatformCodeEmitter(runtime);

  // The closure retains the exact app service resolved at composition. A
  // later container mutation cannot redirect a delayed domain emission.
  runtime.clear(ZERO_OBSERVABILITY_RUNTIME, observability);
  emitCode(OBS_CODES.AUTH_STARTED);
  expect(events.query({ code: OBS_CODES.AUTH_STARTED.code }).events).toHaveLength(1);
});
