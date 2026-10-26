/** Browser signal semantics with an injectable monotonic clock and inert EventTargets. */
import { expect, test } from 'bun:test';
import { createLoggingCollector } from './logging-collector';
import { LOGGING_FAMILIES } from '../../logging/logging-contracts';
import type { LoggingCollectionPolicy, LoggingObservation } from '../../logging/logging-api-contracts';

test('visible/idle intervals, copy and print contain no content, keys or URLs; sleep is incomplete and stop joins once', async () => {
  let clock = 0, focused = true;
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/private?must-not-retain=abc' } });
  const observations: LoggingObservation[] = [];
  const policy: LoggingCollectionPolicy = { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'], heartbeatMs: 30000, idleMs: 60000 };
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) { observations.push(...structuredClone(rows)); return { accepted: rows.length }; } }) }, policy, { document: doc as unknown as Document, window: win as unknown as Window, now: () => clock });
  try {
    clock = 5000; doc.dispatchEvent(new Event('copy')); doc.visibilityState = 'hidden'; focused = false; doc.dispatchEvent(new Event('visibilitychange')); await collector.flush();
    const first = observations.find(o => o.action === 'view.interval')!;
    expect(first.interval).toMatchObject({ sequence: 1, elapsedMs: 5000, visibleMs: 5000, activeMs: 5000, incomplete: false });
    clock = 8000; doc.dispatchEvent(new Event('visibilitychange')); await collector.flush();
    expect(observations.filter(o => o.action === 'view.interval')[1]?.interval).toMatchObject({ elapsedMs: 3000, visibleMs: 0, activeMs: 0 });
    win.dispatchEvent(new Event('beforeprint')); win.dispatchEvent(new Event('afterprint')); await collector.flush();
    expect(observations.some(o => o.action === 'print.requested')).toBe(true); expect(observations.some(o => o.action === 'print.dialog.closed')).toBe(true);
    clock = 200000; doc.dispatchEvent(new Event('visibilitychange')); await collector.flush();
    expect(observations.filter(o => o.action === 'view.interval').at(-1)?.interval).toMatchObject({ elapsedMs: 60000, visibleMs: 0, incomplete: true });
    expect(JSON.stringify(observations)).not.toMatch(/must-not-retain|https:|clipboardData|printed|keyCode/);
    await Promise.all([collector.stop(), collector.stop()]); expect(observations.filter(o => o.action === 'view.closed')).toHaveLength(1);
  } finally { await collector.stop(); }
});

test('offline collection remains bounded and reports loss instead of claiming durable capture', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid' } });
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe() { throw new Error('Offline'); } }) }, {
    enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'], heartbeatMs: 30000, idleMs: 60000,
  }, { document: doc as unknown as Document, window: win as unknown as Window, now: () => 0 });
  for (let i = 0; i < 200; i++) collector.action('clipboard.copy.observed');
  await collector.flush(); expect(collector.diagnostics().queued).toBe(128); expect(collector.diagnostics().dropped).toBeGreaterThan(0); expect(collector.diagnostics().failed).toBe(1);
  await collector.stop(); expect(collector.diagnostics().queued).toBe(0); expect(collector.diagnostics().stopped).toBe(true);
});

test('strict delivery heartbeats work with all optional browser capture disabled and report outages honestly', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/private' } });
  const received: unknown[] = [], acknowledged: unknown[] = []; let fail = false, errors = 0;
  const policy: LoggingCollectionPolicy = { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, false])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000, delivery: { required: true, policyVersion: 'strict-policy', ttlMs: 60000 } };
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows, options) {
    received.push({ rows, options }); if (fail) throw new Error('Offline');
    return { accepted: 0, admission: { policyVersion: 'strict-policy', expiresAt: Date.now() + 60000 } };
  } }) }, policy, { document: doc as unknown as Document, window: win as unknown as Window,
    onAcknowledgment: receipt => { acknowledged.push(receipt); }, onError: () => { errors++; } });
  try {
    await collector.flush(); expect(received).toEqual([{ rows: [], options: { policyVersion: 'strict-policy' } }]); expect(acknowledged).toHaveLength(1);
    fail = true; await collector.flush(); expect(errors).toBe(1); expect(acknowledged).toHaveLength(1);
    expect(collector.diagnostics()).toMatchObject({ queued: 0, failed: 1 });
  } finally { await collector.stop(); }
});

test('every admitted rapid URL change is observed promptly, deduplicated and contains no URL data', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/start' } });
  const observations: LoggingObservation[] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    observations.push(...structuredClone(rows)); return { accepted: rows.length };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000 }, { document: doc as unknown as Document, window: win as unknown as Window });
  try {
    for (const path of ['/one?private=do-not-retain', '/two#sensitive', '/start']) {
      win.location.href = 'https://synthetic.invalid' + path;
      win.dispatchEvent(new Event('popstate'));
      // A hash navigation may publish both browser events, not two transitions.
      win.dispatchEvent(new Event('hashchange'));
    }
    await collector.flush();
    expect(observations.filter(row => row.action === 'navigation.changed')).toHaveLength(3);
    expect(observations.filter(row => row.action === 'view.closed')).toHaveLength(3);
    expect(observations.filter(row => row.action === 'view.opened')).toHaveLength(4);
    expect(new Set(observations.map(row => row.id)).size).toBe(observations.length);
    expect(JSON.stringify(observations)).not.toMatch(/https:|private|sensitive|do-not-retain/);
    await collector.stop();
    const retained = observations.length;
    win.location.href = 'https://synthetic.invalid/retired'; win.dispatchEvent(new Event('popstate'));
    await collector.flush(); expect(observations).toHaveLength(retained);
  } finally { await collector.stop(); }
});
