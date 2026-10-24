import { expect, test } from 'bun:test';
import { installLoggingObservabilityBridge } from './logging-observability-bridge';
import { LoggingError } from './logging-error';
import { emitPlatformEventTo } from '../observability/sink';
import { MemoryEventStore } from '../observability/memory-event-store';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { OBS_CODES } from '../observability/codes';

function observability(): PlatformObservabilityRuntime {
  const store = new MemoryEventStore(); return { sink: store, store, config: { console: false } };
}
const event = { level: 'warn' as const, category: 'fixture', code: 'fixture.warning', message: 'Synthetic diagnostic' };

test('diagnostic backpressure is bounded, reported to the prior sink once per failure burst and never breaks emitting', async () => {
  const obs = observability();
  const bridge = installLoggingObservabilityBridge({ async capture() { throw new LoggingError('LOGGING_BACKPRESSURE', 'Full'); } }, obs);
  expect(() => { emitPlatformEventTo(obs, event); emitPlatformEventTo(obs, event); }).not.toThrow();
  await new Promise<void>(queueMicrotask);
  expect(bridge.diagnostics()).toMatchObject({ failed: 2, accepted: 0 });
  expect(obs.store!.query({ code: OBS_CODES.LOGGING_DELIVERY_FAILED.code }).count).toBe(1);
  expect(obs.store!.query({ code: event.code }).count).toBe(2);
  bridge.detach();
});

test('disabled diagnostics and frontend observations bypass backend capture; filtered events are not acknowledged as retained', async () => {
  const obs = observability(); let called = 0;
  const bridge = installLoggingObservabilityBridge({ async capture() { called++; return null; } }, obs);
  obs.config.enabled = false; emitPlatformEventTo(obs, event);
  obs.config.enabled = true; emitPlatformEventTo(obs, { ...event, source: 'frontend' });
  expect(called).toBe(0);
  emitPlatformEventTo(obs, event); await new Promise<void>(queueMicrotask);
  expect(bridge.diagnostics()).toMatchObject({ accepted: 0, filtered: 1, failed: 0 });
  const replacement = { emit() {} }; obs.sink = replacement;
  bridge.detach(); expect(obs.sink).toBe(replacement);
});

test('descriptor-unsafe diagnostics do not execute accessors during logging capture', () => {
  let invoked = false, captured = false;
  const obs: PlatformObservabilityRuntime = { sink: { emit() {} }, store: null, config: {} };
  const bridge = installLoggingObservabilityBridge({ async capture() { captured = true; return null; } }, obs);
  obs.sink.emit({ ...event, id: 'unsafe', sequence: 1, timestamp: 1, source: 'backend', prefix: 'FIXTURE', get code() { invoked = true; return 'fixture.bad'; } });
  expect(invoked).toBe(false); expect(captured).toBe(false);
  expect(bridge.diagnostics().failed).toBe(1); bridge.detach();
});
