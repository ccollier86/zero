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

test('nested record bindings close independently, retain visible duration, and never replace page navigation identity', async () => {
  let clock = 0, focused = true;
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/start' } });
  const observations: LoggingObservation[] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) { observations.push(...structuredClone(rows)); return { accepted: rows.length }; } }) },
    { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'], heartbeatMs: 30000, idleMs: 60000 },
    { document: doc as unknown as Document, window: win as unknown as Window, now: () => clock });
  try {
    const parent = collector.bindView({ type: 'table.records', id: 'parent-record' }); clock = 1000;
    const nested = collector.bindView({ type: 'table.records', id: 'nested-record' }); clock = 3000;
    nested.close(); nested.close(); clock = 5000; focused = false; doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    clock = 10000; parent.close(); await collector.flush();
    const nestedEvents = observations.filter(event => event.target?.id === 'nested-record');
    expect(nestedEvents.map(event => event.action)).toEqual(['view.opened', 'view.closed']);
    expect(nestedEvents[1]!.interval).toMatchObject({ elapsedMs: 2000, visibleMs: 2000, activeMs: 2000 });
    const parentEvents = observations.filter(event => event.target?.id === 'parent-record');
    expect(parentEvents.map(event => event.action)).toEqual(['view.opened', 'view.interval', 'view.closed']);
    expect(parentEvents[1]!.interval).toMatchObject({ elapsedMs: 5000, visibleMs: 5000 });
    expect(parentEvents[2]!.interval).toMatchObject({ elapsedMs: 5000, visibleMs: 0 });
    win.location.href = 'https://synthetic.invalid/next'; win.dispatchEvent(new Event('popstate')); await collector.flush();
    expect(observations.filter(event => event.action === 'navigation.changed').map(event => event.target)).toEqual([{ type: 'page', id: 'application' }]);
  } finally { await collector.stop(); }
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

test('suspended browser views stay closed and resume with fresh zeroed lifetimes, without frozen-page observations', async () => {
  let clock = 0;
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  const observations: LoggingObservation[] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    observations.push(...structuredClone(rows)); return { accepted: rows.length };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000 }, { document: doc as unknown as Document, window: win as unknown as Window, now: () => clock });
  const record = collector.bindView({ type: 'table.records', id: 'record-a' });
  try {
    clock = 1000; win.dispatchEvent(new Event('pagehide')); await collector.flush();
    const old = observations.map(event => structuredClone(event));
    clock = 9000;
    for (const name of ['visibilitychange', 'pointerdown', 'copy']) doc.dispatchEvent(new Event(name));
    for (const name of ['blur', 'focus', 'beforeprint', 'afterprint', 'pagehide']) win.dispatchEvent(new Event(name));
    collector.action('clipboard.copy.observed'); await collector.flush();
    expect(observations).toEqual(old);
    clock = 11000; win.dispatchEvent(new Event('pageshow')); await collector.flush();
    for (const id of ['application', 'record-a']) {
      const events = observations.filter(event => event.target?.id === id);
      expect(events.map(event => event.action)).toEqual(['view.opened', 'view.closed', 'view.opened']);
      expect(events[1]!.interval).toMatchObject({ elapsedMs: 1000, visibleMs: 1000 });
      expect(events[2]!.interval).toMatchObject({ sequence: 0, elapsedMs: 0, visibleMs: 0, activeMs: 0, incomplete: false });
      expect(events[2]!.interval!.viewId).not.toBe(events[0]!.interval!.viewId);
    }
    clock = 13000; record.close(); await collector.stop();
    expect(observations.filter(event => event.action === 'view.closed').slice(-2).map(event => event.interval?.elapsedMs)).toEqual([2000, 2000]);
  } finally { await collector.stop(); }
});

test('fallback navigation ignores query/hash-only changes without ending a view', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  const observations: LoggingObservation[] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    observations.push(...structuredClone(rows)); return { accepted: rows.length };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000 }, { document: doc as unknown as Document, window: win as unknown as Window });
  try {
    for (const suffix of ['?private=not-retained', '?private=not-retained#section', '#other', '']) {
      win.location.href = 'https://synthetic.invalid/records' + suffix;
      win.dispatchEvent(new Event('popstate')); win.dispatchEvent(new Event('hashchange'));
    }
    await collector.flush();
    expect(observations.map(event => event.action)).toEqual(['view.opened']);
    win.location.href = 'https://synthetic.invalid/record'; win.dispatchEvent(new Event('popstate')); await collector.flush();
    expect(observations.filter(event => event.action === 'navigation.changed')).toHaveLength(1);
    expect(observations.filter(event => event.action === 'view.closed')).toHaveLength(1);
  } finally { await collector.stop(); }
});

test('new view lifetimes flush promptly in one coalesced batch without waiting for the heartbeat', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  const batches: LoggingObservation[][] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    batches.push(structuredClone([...rows])); return { accepted: rows.length };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000 }, { document: doc as unknown as Document, window: win as unknown as Window });
  try {
    collector.bindView({ type: 'table.records', id: 'record-a' }); collector.bindView({ type: 'table.records', id: 'record-b' });
    expect(batches).toHaveLength(0);
    const deadline = Date.now() + 1500;
    while (!batches.length && Date.now() < deadline) await Bun.sleep(10);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map(event => event.target?.id)).toEqual(['application', 'record-a', 'record-b']);
    await collector.flush(); expect(batches).toHaveLength(1);
  } finally { await collector.stop(); }
});

test('required collection loss cannot be cleared by a later successful delivery acknowledgment', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  let acknowledgments = 0, errors = 0;
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    return { accepted: rows.length, admission: { policyVersion: 'strict-policy', expiresAt: Date.now() + 60000 } };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000, delivery: { required: true, policyVersion: 'strict-policy', ttlMs: 60000 } },
    { document: doc as unknown as Document, window: win as unknown as Window, onAcknowledgment: () => { acknowledgments++; }, onError: () => { errors++; } });
  try {
    for (let i = 0; i < 200; i++) collector.action('clipboard.copy.observed');
    expect(errors).toBe(1); expect(collector.diagnostics().dropped).toBeGreaterThan(0);
    await collector.flush(); expect(acknowledgments).toBe(0); expect(collector.diagnostics().queued).toBe(0);
    collector.action('clipboard.copy.observed'); await collector.flush();
    expect(acknowledgments).toBe(0); expect(errors).toBe(1);
  } finally { await collector.stop(); }
});

test('partial required observation acceptance retains the original batch and cannot open the protected workspace', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  let partial = true, acknowledgments = 0, errors = 0;
  const batches: LoggingObservation[][] = [];
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    batches.push(structuredClone([...rows]));
    return { accepted: partial ? 0 : rows.length, admission: { policyVersion: 'strict-policy', expiresAt: Date.now() + 60000 } };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000, delivery: { required: true, policyVersion: 'strict-policy', ttlMs: 60000 } },
    { document: doc as unknown as Document, window: win as unknown as Window, onAcknowledgment: () => { acknowledgments++; }, onError: () => { errors++; } });
  try {
    await collector.flush(); expect(errors).toBe(1); expect(acknowledgments).toBe(0); expect(collector.diagnostics().queued).toBe(1);
    partial = false; await collector.flush();
    expect(batches[1]).toEqual(batches[0]); expect(acknowledgments).toBe(1); expect(collector.diagnostics().queued).toBe(0);
  } finally { await collector.stop(); }
});

test('a successful batch prefix cannot confirm admission while the remaining observations fail', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const win = Object.assign(new EventTarget(), { location: { href: 'https://synthetic.invalid/records' } });
  let calls = 0, acknowledgments = 0, errors = 0;
  const collector = createLoggingCollector({ bindObservations: () => ({ async observe(rows) {
    if (++calls === 2) throw new Error('Synthetic interrupted second batch');
    return { accepted: rows.length, admission: { policyVersion: 'strict-policy', expiresAt: Date.now() + 60000 } };
  } }) }, { enabled: true, capture: Object.fromEntries(LOGGING_FAMILIES.map(f => [f, true])) as LoggingCollectionPolicy['capture'],
    heartbeatMs: 30000, idleMs: 60000, delivery: { required: true, policyVersion: 'strict-policy', ttlMs: 60000 } },
    { document: doc as unknown as Document, window: win as unknown as Window, onAcknowledgment: () => { acknowledgments++; }, onError: () => { errors++; } });
  try {
    for (let i = 0; i < 64; i++) collector.action('clipboard.copy.observed');
    await collector.flush(); expect(errors).toBe(1); expect(acknowledgments).toBe(0); expect(collector.diagnostics().queued).toBe(33);
    await collector.flush(); expect(acknowledgments).toBe(1); expect(collector.diagnostics().queued).toBe(0);
  } finally { await collector.stop(); }
});
