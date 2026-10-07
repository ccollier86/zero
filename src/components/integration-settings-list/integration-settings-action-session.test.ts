/** Pure lifetime/admission regressions; no transport, configuration, or application calls. */
import { describe, expect, test } from 'bun:test';
import { IntegrationSettingsActionSession, INTEGRATION_SETTINGS_ACTION_ERROR } from './integration-settings-action-session';

function deferred() {
  let resolve!: () => void, reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('IntegrationSettingsActionSession', () => {
  test('locks synchronously and does not mutate application data', async () => {
    const session = new IntegrationSettingsActionSession(); session.activate();
    const held = deferred(); let calls = 0, completed = 0;
    const input = { isCurrent: () => true, onSelect: () => { calls++; return held.promise; },
      onCompleted: () => { completed++; }, onFailed: () => { throw new Error('Unexpected error'); } };
    const first = session.run(input);
    expect(session.getSnapshot().pending).toBe(true);
    expect(await session.run(input)).toBe('blocked');
    await Promise.resolve(); expect(calls).toBe(1);
    held.resolve(); expect(await first).toBe('completed');
    expect(completed).toBe(1); expect(session.getSnapshot()).toEqual({ pending: false, error: null });
  });

  test('retired StrictMode work never dispatches after reactivation', async () => {
    const session = new IntegrationSettingsActionSession(); session.activate();
    let calls = 0;
    const first = session.run({ isCurrent: () => true, onSelect: () => { calls++; }, onFailed: () => {} });
    session.retire(); session.activate();
    expect(await first).toBe('retired'); expect(calls).toBe(0);
    expect(await session.run({ isCurrent: () => true, onSelect: () => { calls++; }, onFailed: () => {} })).toBe('completed');
    expect(calls).toBe(1);
  });

  test('capability retirement aborts work and suppresses late errors and application callbacks', async () => {
    const session = new IntegrationSettingsActionSession(); session.activate();
    const held = deferred(); let signal: AbortSignal | undefined, errors = 0, completed = 0;
    const first = session.run({ isCurrent: () => true,
      onSelect: value => { signal = value; return held.promise; },
      onFailed: () => { errors++; }, onCompleted: () => { completed++; } });
    await Promise.resolve(); session.invalidate();
    expect(signal?.aborted).toBe(true); expect(session.getSnapshot().pending).toBe(false);
    held.reject(new Error('private provider failure'));
    expect(await first).toBe('retired'); expect(errors).toBe(0); expect(completed).toBe(0);
    expect(session.getSnapshot().error).toBeNull();
  });

  test('live ownership checks reject a revoked callback before dispatch and after resolution', async () => {
    const session = new IntegrationSettingsActionSession(); session.activate();
    let current = true, calls = 0, errors = 0, signal: AbortSignal | undefined;
    const first = session.run({ isCurrent: () => current, onSelect: () => { calls++; }, onFailed: () => { errors++; } });
    current = false; expect(await first).toBe('retired'); expect(calls).toBe(0);
    const held = deferred(); current = true;
    const second = session.run({ isCurrent: () => current, onSelect: value => { signal = value; return held.promise; }, onFailed: () => { errors++; } });
    await Promise.resolve(); current = false; held.reject('private');
    expect(await second).toBe('retired'); expect(signal?.aborted).toBe(true); expect(errors).toBe(0);
  });

  test('current errors expose only safe copy and a retry clears the error', async () => {
    const session = new IntegrationSettingsActionSession(); session.activate(); let cause: unknown;
    expect(await session.run({ isCurrent: () => true, onSelect: () => { throw new Error('secret'); },
      onFailed: value => { cause = value; } })).toBe('failed');
    expect(cause).toBeInstanceOf(Error);
    expect(session.getSnapshot()).toEqual({ pending: false, error: INTEGRATION_SETTINGS_ACTION_ERROR });
    expect(await session.run({ isCurrent: () => true, onSelect: () => {}, onFailed: () => {} })).toBe('completed');
    expect(session.getSnapshot()).toEqual({ pending: false, error: null });
    session.retire(); expect(await session.run({ isCurrent: () => true, onSelect: () => {}, onFailed: () => {} })).toBe('blocked');
  });
});
