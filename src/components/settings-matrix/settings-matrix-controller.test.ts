/** Verify controlled callback ownership without browser, persistence or delivery services. */

import { describe, expect, test } from 'bun:test';
import { SettingsMatrixController, SETTINGS_MATRIX_CHANGE_FAILED } from './settings-matrix-controller';

function fixture() {
  let boundary = { key: 'organization-a', ready: true };
  const editable = new Set(['row:email', 'row:in-app']);
  let failures = 0;
  const controller = new SettingsMatrixController({ readBoundary: () => boundary,
    isEditable: (key) => editable.has(key), onFailure: () => { failures += 1; } });
  controller.activate();
  return { controller, editable, setBoundary: (key: string, ready = true) => { boundary = { key, ready }; },
    failures: () => failures };
}
const change = { rowId: 'row', columnId: 'email', checked: true };
function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('SettingsMatrix callback controller', () => {
  test('deduplicates the same cell while allowing unrelated changes to proceed', async () => {
    const f = fixture(); const first = deferred(); let calls = 0;
    const pending = f.controller.run('row:email', change, () => { calls += 1; return first.promise; });
    await f.controller.run('row:email', change, () => { calls += 1; });
    await f.controller.run('row:in-app', { ...change, columnId: 'in-app' }, () => { calls += 1; });
    expect(calls).toBe(2); expect(f.controller.isPending('row:email')).toBe(true);
    first.resolve(); await pending;
    expect(f.controller.isPending('row:email')).toBe(false); expect(f.controller.getError('row:email')).toBeNull();
  });

  test('a current rejection reports safe feedback and can be retried', async () => {
    const f = fixture();
    await f.controller.run('row:email', change, async () => { throw new Error('PRIVATE_SETTINGS_VALUE'); });
    expect(f.failures()).toBe(1); expect(f.controller.getError('row:email')).toBe(SETTINGS_MATRIX_CHANGE_FAILED);
    expect(f.controller.isPending('row:email')).toBe(false);
    await f.controller.run('row:email', change, () => {});
    expect(f.controller.getError('row:email')).toBeNull(); expect(f.failures()).toBe(1);
  });

  test('retired scope suppresses a late error even before the reconciliation effect runs', async () => {
    const f = fixture(); const response = deferred(); let signal: AbortSignal | undefined;
    const pending = f.controller.run('row:email', change, (_, context) => { signal = context.signal; return response.promise; });
    await Promise.resolve(); f.setBoundary('organization-b');
    expect(f.controller.isPending('row:email')).toBe(false);
    expect(signal?.aborted).toBe(true);
    f.controller.reconcile(); expect(signal?.aborted).toBe(true);
    response.reject(new Error('OLD_SCOPE_ERROR')); await pending;
    expect(f.controller.getError('row:email')).toBeNull(); expect(f.failures()).toBe(0);
  });

  test('scope replacement clears already displayed errors for identical cell IDs', async () => {
    const f = fixture();
    await f.controller.run('row:email', change, () => Promise.reject(new Error('private')));
    expect(f.controller.getError('row:email')).not.toBeNull();
    f.setBoundary('organization-b'); expect(f.controller.getError('row:email')).toBeNull();
    f.controller.reconcile(); expect(f.controller.getError('row:email')).toBeNull();
  });

  test('retired capability aborts pending work without presenting a failure', async () => {
    const f = fixture(); const response = deferred(); let signal: AbortSignal | undefined;
    const pending = f.controller.run('row:email', change, (_, context) => { signal = context.signal; return response.promise; });
    await Promise.resolve(); f.editable.delete('row:email'); f.controller.reconcile();
    expect(signal?.aborted).toBe(true); expect(f.controller.isPending('row:email')).toBe(false);
    response.reject(new Error('Revoked choice')); await pending; expect(f.failures()).toBe(0);
  });

  test('unreadable authorization admits no callback and masks errors', async () => {
    const f = fixture(); f.setBoundary('organization-a', false); let calls = 0;
    await f.controller.run('row:email', change, () => { calls += 1; });
    expect(calls).toBe(0); expect(f.controller.getError('row:email')).toBeNull();
  });

  test('retirement before callback microtask issues no operation', async () => {
    const f = fixture(); let calls = 0;
    const pending = f.controller.run('row:email', change, () => { calls += 1; });
    f.controller.retire(); await pending;
    expect(calls).toBe(0); expect(f.controller.isPending('row:email')).toBe(false);
    f.controller.activate(); await f.controller.run('row:email', change, () => { calls += 1; });
    expect(calls).toBe(1);
  });

  test('a new scope operation replaces an old pending slot without losing cancellation', async () => {
    const f = fixture(); const old = deferred(); const current = deferred(); let oldSignal: AbortSignal | undefined;
    const previous = f.controller.run('row:email', change, (_, context) => { oldSignal = context.signal; return old.promise; });
    await Promise.resolve(); f.setBoundary('organization-b');
    const next = f.controller.run('row:email', change, () => current.promise);
    expect(oldSignal?.aborted).toBe(true); expect(f.controller.isPending('row:email')).toBe(true);
    old.reject(new Error('old')); await previous;
    expect(f.controller.isPending('row:email')).toBe(true); expect(f.failures()).toBe(0);
    current.resolve(); await next; expect(f.controller.isPending('row:email')).toBe(false);
  });
});
