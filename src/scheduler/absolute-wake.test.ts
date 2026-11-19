/** Native Croner timers/registry only; no fixtures, files or external services. */
import { expect, test } from 'bun:test';
import { SchedulerService } from './scheduler-service';
import type { JobDefinition } from './types';

function entry(scheduler: SchedulerService, name: string) {
  const selected = (scheduler as unknown as { jobs: Map<string, { cron: { trigger(): Promise<void> }; def: JobDefinition }> }).jobs.get(name);
  if (!selected) throw new Error('Missing synthetic wake.'); return selected;
}
async function until(check: () => boolean) {
  const end = performance.now() + 2500;
  while (!check()) { if (performance.now() >= end) throw new Error('Synthetic native wake did not settle.'); await Bun.sleep(5); }
}

test('absolute wake uses the native registry, fires once, and removes its exact entry before rearming', async () => {
  const scheduler = new SchedulerService(); let calls = 0;
  try {
    const old = scheduler.scheduleAt({ name: 'synthetic-wake', at: Date.now() + 3_600_000, async run() {
      calls++; expect(scheduler.has('synthetic-wake')).toBe(false);
      scheduler.scheduleAt({ name: 'synthetic-wake', at: Date.now() + 3_600_000, run() { calls++; } });
    } });
    const original = entry(scheduler, 'synthetic-wake');
    expect(scheduler.get('synthetic-wake')!.pattern).toMatch(/^\d{4}-/);
    await original.cron.trigger(); expect(calls).toBe(1); expect(scheduler.has('synthetic-wake')).toBe(true);
    old.cancel(); expect(scheduler.has('synthetic-wake')).toBe(true);
    await original.def.run({ signal: new AbortController().signal }); expect(calls).toBe(1);
    await entry(scheduler, 'synthetic-wake').cron.trigger(); expect(calls).toBe(2); expect(scheduler.has('synthetic-wake')).toBe(false);
  } finally { await scheduler.close(); }
});

test('native absolute timer wakes without periodic polling and cancellation remains inert', async () => {
  const scheduler = new SchedulerService(); let calls = 0;
  try {
    const cancelled = scheduler.scheduleAt({ name: 'cancelled', at: Date.now() + 30, run() { calls++; } });
    const captured = entry(scheduler, 'cancelled').def; cancelled.cancel();
    scheduler.scheduleAt({ name: 'due', at: Date.now() + 30, run() { calls++; } });
    await until(() => calls === 1); expect(scheduler.list()).toEqual([]);
    await captured.run({ signal: new AbortController().signal }); expect(calls).toBe(1);
  } finally { await scheduler.close(); }
});

test('invalid absolute declarations reject without evaluating authored accessors or installing a wake', async () => {
  const scheduler = new SchedulerService(); let getters = 0;
  try {
    for (const at of [-1, NaN, Infinity, 1.5, 253_402_300_800_000]) expect(() => scheduler.scheduleAt({ name: 'invalid', at, run() {} })).toThrow();
    const accessor = { name: 'accessor', at: 1, get run() { getters++; return () => {}; } };
    expect(() => scheduler.scheduleAt(accessor)).toThrow(); expect(getters).toBe(0);
    expect(() => scheduler.scheduleAt({ name: 'extra', at: 1, run() {}, token: 'PRIVATE' } as never)).toThrow();
    expect(scheduler.list()).toEqual([]);
  } finally { await scheduler.close(); }
});

test('a captured failed-registration callback never comes alive on retry and cannot remove its replacement', async () => {
  class FailingScheduler extends SchedulerService {
    captured: JobDefinition | null = null; fail = true;
    override register(definition: JobDefinition) {
      super.register(definition); if (this.fail) { this.captured = definition; throw new Error('Synthetic failed registration.'); }
    }
  }
  const scheduler = new FailingScheduler(); let calls = 0;
  try {
    expect(() => scheduler.scheduleAt({ name: 'retry', at: Date.now() + 3_600_000, run() { calls++; } })).toThrow('Synthetic failed registration.');
    expect(scheduler.list()).toEqual([]); scheduler.fail = false;
    scheduler.scheduleAt({ name: 'retry', at: Date.now() + 3_600_000, run() { calls++; } });
    await scheduler.captured!.run({ signal: new AbortController().signal }); expect(calls).toBe(0); expect(scheduler.has('retry')).toBe(true);
    await entry(scheduler, 'retry').cron.trigger(); expect(calls).toBe(1);
  } finally { await scheduler.close(); }
});

test('consumed one-shot callbacks remain tracked and cooperatively aborted during native scheduler shutdown', async () => {
  const scheduler = new SchedulerService(); let started = false, cancelled = false;
  try {
    scheduler.scheduleAt({ name: 'physical-callback', at: Date.now() + 3_600_000, async run({ signal }) {
      started = true; await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
    } });
    const running = entry(scheduler, 'physical-callback').cron.trigger();
    await until(() => started); expect(scheduler.has('physical-callback')).toBe(false); expect(scheduler.diagnostics().active).toBe(1);
    await scheduler.close(); await running; expect(cancelled).toBe(true); expect(scheduler.diagnostics().active).toBe(0);
  } finally { await scheduler.close(); }
});
