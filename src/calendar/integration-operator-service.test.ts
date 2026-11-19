/** Real existing Guardian/Calendar MEMORY fixture; native operator output/waits explicitly simulated. */
import { expect, test } from 'bun:test';
import type { CalendarAuthority } from './authority';
import { calendarIntegrationOperatorControl, calendarIntegrationOperatorOptions, type CalendarIntegrationNativeOperations, type CalendarIntegrationOperatorReadOptions } from './integration-operator';
import { calendarIntegrationInspectionForAuthority } from './integration-operator-service';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

type Inspection = Awaited<ReturnType<CalendarIntegrationNativeOperations['inspect']>>;
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function nativeFixture(result: Inspection = null) {
  const calls: Array<{ scope: unknown; options: unknown }> = [];
  let before: (() => void | Promise<void>) | undefined;
  const native: Pick<CalendarIntegrationNativeOperations, 'inspect'> = {
    async inspect(scope, options) { calls.push({ scope, options }); await before?.(); return result; },
  };
  return { native, calls, before(callback: () => void | Promise<void>) { before = callback; } };
}

test('manager-only inspection uses canonical Guardian scope and exposes only a frozen get surface without provisioning', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const f = memoryCalendarServiceFixture({ tenancy }), closing = new AbortController(), source = nativeFixture();
    try {
      const manager = f.session('manager', { manager: true }), ordinary = f.session('ordinary');
      const facade = calendarIntegrationInspectionForAuthority(source.native, manager.authority, f.config, closing.signal);
      expect(Object.isFrozen(facade)).toBe(true); expect(Reflect.ownKeys(facade)).toEqual(['get']);
      expect(facade).not.toHaveProperty('inspect'); expect(facade).not.toHaveProperty('retire'); expect(facade).not.toHaveProperty('reactivate');
      expect(await facade.get()).toBeNull(); expect(source.calls).toHaveLength(1);
      expect(source.calls[0]!.scope).toEqual(manager.scope);
      const options = source.calls[0]!.options as Required<CalendarIntegrationOperatorReadOptions>;
      expect(Object.keys(options)).toEqual(['signal', 'assertCurrent', 'confirmCurrent']); expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.signal.aborted).toBe(false);
      expect(options.assertCurrent).toBeInstanceOf(Function); expect(options.confirmCurrent).toBeInstanceOf(Function);
      options.assertCurrent(); await options.confirmCurrent();
      expect(JSON.stringify(source.calls)).not.toContain('manager'); expect(JSON.stringify(source.calls)).not.toContain('actor');
      await expect(calendarIntegrationInspectionForAuthority(source.native, ordinary.authority, f.config, closing.signal).get()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
      expect(source.calls).toHaveLength(1); expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0, activeLeases: 0 });
    } finally { closing.abort(); await f.close(); }
  }
});

test('inspection options reject authored routing, mutations, getters and non-signals before any native read', async () => {
  const f = memoryCalendarServiceFixture(), closing = new AbortController(), source = nativeFixture();
  try {
    const manager = f.session('manager', { manager: true });
    const facade = calendarIntegrationInspectionForAuthority(source.native, manager.authority, f.config, closing.signal);
    let getters = 0;
    const accessor = Object.defineProperty({}, 'signal', { enumerable: true, get() { getters++; throw new Error('Must not invoke authored accessor.'); } });
    for (const options of [null, [], true, 1, 'invalid', { signal: {} }, { signal: null }, { signal: () => {} }, accessor,
      { scope: manager.scope }, { scopeId: 'application' }, { expectedOwnerId: 'forged' }, { actor: {} }, { requestId: 'forged' },
      { ruleId: 'observe' }, { action: 'retire' }, { idempotencyKey: 'forged' }, { now: 0 }, { assertCurrent() {} }, { async confirmCurrent() {} }]) {
      await expect(facade.get(options as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(getters).toBe(0); expect(source.calls).toEqual([]);
    const supplied = new AbortController(); expect(await facade.get({ signal: supplied.signal })).toBeNull();
    supplied.abort(); expect((source.calls[0]!.options as { signal: AbortSignal }).signal.aborted).toBe(true);
    await expect(facade.get({ signal: supplied.signal })).rejects.toBeInstanceOf(Error); expect(source.calls).toHaveLength(1);
  } finally { closing.abort(); await f.close(); }
});

test('revoked or replaced Guardian authority cannot start a private inspection and every get is freshly admitted', async () => {
  for (const replace of ['revoke', 'scope'] as const) {
    const f = memoryCalendarServiceFixture(), closing = new AbortController(), source = nativeFixture();
    try {
      const manager = f.session('manager', { manager: true });
      const facade = calendarIntegrationInspectionForAuthority(source.native, manager.authority, f.config, closing.signal);
      expect(await facade.get()).toBeNull();
      if (replace === 'revoke') manager.revoke(); else manager.replaceScope('tenant-b');
      await expect(facade.get()).rejects.toBeInstanceOf(Error); expect(source.calls).toHaveLength(1);
    } finally { closing.abort(); await f.close(); }
  }
});

test('revocation and scope replacement during the native wait reject private results instead of returning them', async () => {
  for (const replace of ['revoke', 'scope'] as const) {
    const f = memoryCalendarServiceFixture(), closing = new AbortController(), entered = deferred<void>(), release = deferred<void>();
    const marker = Object.freeze({ privateProjection: 'PRIVATE_INSPECTION_MUST_NOT_ESCAPE' }) as unknown as Inspection;
    const source = nativeFixture(marker); source.before(async () => { entered.resolve(); await release.promise; });
    let pending: Promise<Inspection> | undefined;
    try {
      const manager = f.session('manager', { manager: true });
      pending = calendarIntegrationInspectionForAuthority(source.native, manager.authority, f.config, closing.signal).get();
      await Promise.race([entered.promise, pending.then(() => { throw new Error('Synthetic wait was bypassed.'); })]);
      if (replace === 'revoke') manager.revoke(); else manager.replaceScope('tenant-b');
      const trusted = source.calls[0]!.options as Required<CalendarIntegrationOperatorReadOptions>;
      expect(() => trusted.assertCurrent()).toThrow(); await expect(trusted.confirmCurrent()).rejects.toBeInstanceOf(Error);
      release.resolve(); await expect(pending).rejects.toBeInstanceOf(Error); expect(source.calls).toHaveLength(1);
      await pending.catch(error => { expect(JSON.stringify(error)).not.toContain('PRIVATE_INSPECTION_MUST_NOT_ESCAPE'); });
    } finally { release.resolve(); await pending?.catch(() => {}); closing.abort(); await f.close(); }
  }
});

test('only native inspection options accept detached trusted fence callbacks, never native controls or request get options', () => {
  let sync = 0, confirmed = 0;
  const assertCurrent = () => { sync++; }, confirmCurrent = async () => { confirmed++; };
  const input = { assertCurrent, confirmCurrent }, captured = calendarIntegrationOperatorOptions(input);
  expect(sync).toBe(0); expect(confirmed).toBe(0); expect(captured).not.toBe(input);
  expect(captured.assertCurrent).toBe(assertCurrent); expect(captured.confirmCurrent).toBe(confirmCurrent);
  input.assertCurrent = () => { throw new Error('Mutable caller callback was retained.'); };
  captured.assertCurrent!(); expect(sync).toBe(1);
  const control = { ruleId: 'observe', expected: { id: '1'.repeat(64), epoch: 1, policyDigest: '2'.repeat(64) } };
  for (const options of [null, { assertCurrent: null }, { assertCurrent: {} }, { confirmCurrent: null }, { confirmCurrent: true }]) {
    expect(() => calendarIntegrationOperatorOptions(options as never)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  }
  for (const callbacks of [{ assertCurrent }, { confirmCurrent }]) {
    expect(() => calendarIntegrationOperatorControl({ ...control, ...callbacks } as never)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  }
  expect(Object.keys(calendarIntegrationOperatorControl(control))).toEqual(['ruleId', 'expected']);
});

test('caller, request and owner cancellation stay live across an ignored native wait and prevent late publication', async () => {
  for (const cancelled of ['caller', 'request', 'closing'] as const) {
    const f = memoryCalendarServiceFixture(), closing = new AbortController(), supplied = new AbortController(), requestAbort = new AbortController();
    const entered = deferred<void>(), release = deferred<void>(), source = nativeFixture();
    source.before(async () => { entered.resolve(); await release.promise; });
    let pending: Promise<Inspection> | undefined;
    try {
      const manager = f.session('manager', { manager: true });
      const request: CalendarAuthority = { ...manager.authority, signal: requestAbort.signal };
      pending = calendarIntegrationInspectionForAuthority(source.native, request, f.config, closing.signal).get({ signal: supplied.signal });
      await Promise.race([entered.promise, pending.then(() => { throw new Error('Synthetic wait was bypassed.'); })]);
      ({ caller: supplied, request: requestAbort, closing })[cancelled].abort();
      expect((source.calls[0]!.options as { signal: AbortSignal }).signal.aborted).toBe(true);
      release.resolve(); await expect(pending).rejects.toBeInstanceOf(Error);
    } finally { release.resolve(); await pending?.catch(() => {}); supplied.abort(); requestAbort.abort(); closing.abort(); await f.close(); }
  }
});

test('final asynchronous Guardian confirmation and pre-read admission failures are fenced without native mutation access', async () => {
  const f = memoryCalendarServiceFixture(), closing = new AbortController(), source = nativeFixture();
  try {
    const manager = f.session('manager', { manager: true });
    let checks = 0;
    const request: CalendarAuthority = { ...manager.authority,
      async assertCurrentAuthority() { await manager.authority.assertCurrentAuthority(); if (++checks === 2) manager.revoke(); },
    };
    await expect(calendarIntegrationInspectionForAuthority(source.native, request, f.config, closing.signal).get()).rejects.toBeInstanceOf(Error);
    expect(checks).toBe(2); expect(source.calls).toHaveLength(1);
    const another = f.session('another-manager', { manager: true });
    const denied: CalendarAuthority = { ...another.authority, async assertCurrentAuthority() { another.revoke(); await another.authority.assertCurrentAuthority(); } };
    await expect(calendarIntegrationInspectionForAuthority(source.native, denied, f.config, closing.signal).get()).rejects.toBeInstanceOf(Error);
    expect(source.calls).toHaveLength(1);
  } finally { closing.abort(); await f.close(); }
});
