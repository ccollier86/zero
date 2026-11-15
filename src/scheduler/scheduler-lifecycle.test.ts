/** Barrier-driven local scheduler qualification, without real cron waits, databases or external providers. */
import { expect, test } from 'bun:test';
import { SchedulerService } from './scheduler-service';
import type { JobDefinition } from './types';
import type { PlatformEvent, PlatformObservabilityRuntime } from '../observability/types';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
function events() {
  const captured: PlatformEvent[] = [];
  const runtime: PlatformObservabilityRuntime = { config: {}, store: null, sink: { emit(event) { captured.push(event); } } };
  return { captured, runtime };
}
test('terminal shutdown aborts and observes cooperative callbacks before settling and rejects new registration', async () => {
  const scheduler = new SchedulerService(), entered = deferred(), cancelled = deferred(); let signal!: AbortSignal;
  scheduler.register({ name: 'cooperative', pattern: '@daily', paused: true, async run(context) {
    signal = context.signal; signal.addEventListener('abort', cancelled.resolve, { once: true }); entered.resolve(); await cancelled.promise;
  } });
  try {
    expect(scheduler.trigger('cooperative')).toBe(true); await entered.promise;
    const closing = scheduler.close(); expect(signal.aborted).toBe(true); expect(scheduler.close()).toBe(closing);
    await closing; expect(scheduler.diagnostics()).toEqual({ accepting: false, active: 0, registered: 0 });
    expect(() => scheduler.register({ name: 'late', pattern: '@daily', run() {} })).toThrow('closing');
    expect(scheduler.trigger('cooperative')).toBe(false);
  } finally { cancelled.resolve(); await scheduler.close(); }
});

test('a callback ignoring cancellation remains counted after a bounded drain timeout, not falsely reported as stopped', async () => {
  const scheduler = new SchedulerService({ shutdownGraceMs: 1 }), entered = deferred(), release = deferred();
  scheduler.register({ name: 'ignores-abort', pattern: '@daily', paused: true, async run() { entered.resolve(); await release.promise; } });
  try {
    scheduler.trigger('ignores-abort'); await entered.promise;
    await expect(scheduler.close()).rejects.toMatchObject({ code: 'SCHEDULER_DRAIN_TIMEOUT' });
    expect(scheduler.diagnostics()).toEqual({ accepting: false, active: 1, registered: 0 });
  } finally {
    release.resolve(); for (let i = 0; i < 12 && scheduler.diagnostics().active; i++) await Promise.resolve();
    expect(scheduler.diagnostics().active).toBe(0);
  }
});

test('legacy stopAll remains synchronous and reusable without silently aborting accepted callbacks', async () => {
  const scheduler = new SchedulerService(), entered = deferred(), release = deferred(); let signal!: AbortSignal;
  scheduler.register({ name: 'first', pattern: '@daily', paused: true, async run(context) { signal = context.signal; entered.resolve(); await release.promise; } });
  try {
    scheduler.trigger('first'); await entered.promise; scheduler.stopAll(); expect(signal.aborted).toBe(false);
    scheduler.register({ name: 'second', pattern: '@daily', paused: true, run() {} }); expect(scheduler.has('second')).toBe(true);
  } finally { release.resolve(); await scheduler.close(); }
});

test('separate scheduler instances retain app-bound observability even when declarations/options change', async () => {
  const a = events(), b = events(), options = { observability: a.runtime }, one = new SchedulerService(options), two = new SchedulerService({ observability: b.runtime });
  options.observability = b.runtime;
  try {
    one.register({ name: 'only-a', pattern: '@daily', paused: true, run() {} });
    two.register({ name: 'only-b', pattern: '@daily', paused: true, run() {} });
    expect(a.captured.filter(event => event.metadata?.name === 'only-a')).toHaveLength(1);
    expect(a.captured.some(event => event.metadata?.name === 'only-b')).toBe(false);
    expect(b.captured.filter(event => event.metadata?.name === 'only-b')).toHaveLength(1);
    expect(b.captured.some(event => event.metadata?.name === 'only-a')).toBe(false);
  } finally { await Promise.all([one.close(), two.close()]); }
});

test('malformed declarations and getters fail before registration without evaluating authored accessors', async () => {
  const scheduler = new SchedulerService(); let reads = 0;
  try {
    const getter = Object.defineProperty({}, 'name', { enumerable: true, get() { reads++; return 'no'; } });
    for (const input of [getter, { name: '', pattern: '@daily', run() {} }, { name: 'bad-handler', pattern: '@daily', run: null },
      { name: 'bad-option', pattern: '@daily', run() {}, paused: 'no' }, { name: 'bad-zone', pattern: '@daily', run() {}, timezone: 'not-a-zone' }]) {
      expect(() => scheduler.register(input as JobDefinition)).toThrow(); expect(scheduler.list()).toEqual([]);
    }
    expect(reads).toBe(0);
  } finally { await scheduler.close(); }
});
