import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { useMutation, type UseMutationOptions, type UseMutationReturn } from './mutation-hooks';
import { configureFrontendObservability, type FrontendObservabilityEvent } from './observability';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';
import { ClientProvider } from './client-context';
import type { Client } from './sdk';

let restoreDom: () => void;
const roots = new Set<Root>();
let events: FrontendObservabilityEvent[];
beforeEach(() => {
  restoreDom = installMinimalHookDom();
  events = [];
  configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear(); restoreDom();
  configureFrontendObservability({ http: false, console: false });
});

async function renderMutation(action: () => number | Promise<number>, options: UseMutationOptions<number> = {}, client?: Client) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  let current!: UseMutationReturn<[], number>;
  function Capture() { current = useMutation(action, options); return null; }
  await act(async () => root.render(client
    ? createElement(ClientProvider, { client, children: createElement(Capture) })
    : createElement(Capture)));
  return { get current() { return current; }, async unmount() {
    await act(async () => root.unmount()); roots.delete(root);
  } };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('accepted write remains accepted when its success notification throws', async () => {
  let writes = 0; const errors: unknown[] = [];
  const view = await renderMutation(() => { writes++; return 42; }, {
    onSuccess() { throw new Error('synthetic private notification'); },
    onError(error) { errors.push(error); },
  });
  await act(async () => { expect(await view.current.run()).toBe(42); });
  expect(writes).toBe(1); expect(errors).toEqual([]);
  expect(view.current.result).toBe(42); expect(view.current.error).toBeNull();
  expect(view.current.pending).toBe(false);
  expect(events).toHaveLength(1);
  expect(events[0]?.metadata).toEqual({ surface: 'use-mutation', stage: 'accepted-callback' });
  expect(JSON.stringify(events)).not.toContain('synthetic private notification');
});

test('async success notification is observed without rejecting an accepted result', async () => {
  const notification = deferred<void>(); const errors: unknown[] = [];
  const view = await renderMutation(() => 42, {
    onSuccess: () => notification.promise,
    onError(error) { errors.push(error); },
  });
  let request!: Promise<number>;
  await act(async () => { request = view.current.run(); await Promise.resolve(); });
  expect(view.current.pending).toBe(true);
  await act(async () => { notification.reject(new Error('synthetic async callback')); expect(await request).toBe(42); });
  expect(errors).toEqual([]); expect(view.current.error).toBeNull();
  expect(JSON.stringify(events)).not.toContain('synthetic async callback');
});

test('failing error notification cannot replace the original rejected write', async () => {
  const rejected = new Error('synthetic write rejection');
  const view = await renderMutation(() => Promise.reject(rejected), {
    onError() { throw new Error('synthetic private error notification'); },
  });
  await act(async () => { await expect(view.current.run()).rejects.toBe(rejected); });
  expect(view.current.error).toBe(rejected);
  expect(view.current.pending).toBe(false);
  expect(JSON.stringify(events)).not.toContain('synthetic private error notification');
});

test('an async rejected error notification preserves pending and the original writer error', async () => {
  const writerError = new Error('synthetic writer failure');
  const notification = deferred<void>();
  const view = await renderMutation(() => Promise.reject(writerError), {
    onError: () => notification.promise,
  });
  let outcome!: Promise<unknown>;
  await act(async () => {
    outcome = view.current.run().then(() => null, error => error);
    await Promise.resolve();
  });
  expect(view.current.pending).toBe(true);
  await act(async () => {
    notification.reject(new Error('synthetic private async error notification'));
    expect(await outcome).toBe(writerError);
  });
  expect(view.current.pending).toBe(false);
  expect(view.current.error).toBe(writerError);
  expect(events.some(event => event.metadata?.stage === 'error-callback')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('synthetic private async error notification');
});

test('unmounted hook does not notify or admit a retained run after pending acceptance', async () => {
  const receipt = deferred<number>(); let writes = 0; let successes = 0;
  const view = await renderMutation(() => { writes++; return receipt.promise; }, { onSuccess() { successes++; } });
  let request!: Promise<number>;
  const retained = view.current.run;
  await act(async () => { request = retained(); await Promise.resolve(); });
  await view.unmount();
  await act(async () => { receipt.resolve(42); expect(await request).toBe(42); });
  expect(successes).toBe(0); expect(events).toEqual([]);
  await expect(retained()).rejects.toThrow('unmounted');
  expect(writes).toBe(1);
});

test('reset suppresses obsolete UI callbacks without falsifying an accepted result', async () => {
  const receipt = deferred<number>(); let successes = 0;
  const view = await renderMutation(() => receipt.promise, { onSuccess() { successes++; } });
  let request!: Promise<number>;
  await act(async () => { request = view.current.run(); await Promise.resolve(); });
  await act(async () => view.current.reset());
  await act(async () => { receipt.resolve(42); expect(await request).toBe(42); });
  expect(successes).toBe(0); expect(view.current.result).toBeNull();
});

test('intended concurrent runs with resetOnRun false preserve aggregate pending state', async () => {
  const first = deferred<number>(); const second = deferred<number>(); let calls = 0;
  const view = await renderMutation(() => ++calls === 1 ? first.promise : second.promise, { resetOnRun: false });
  let a!: Promise<number>; let b!: Promise<number>;
  await act(async () => { a = view.current.run(); b = view.current.run(); await Promise.resolve(); });
  await act(async () => { first.resolve(1); expect(await a).toBe(1); });
  expect(view.current.pending).toBe(true);
  await act(async () => { second.resolve(2); expect(await b).toBe(2); });
  expect(view.current.pending).toBe(false); expect(calls).toBe(2);
});

test('scope replacement during a success notification suppresses its stale failure and result', async () => {
  const notification = deferred<void>(); const listeners = new Set<() => void>();
  const auth = {
    authorizationScopeKey: 'scope-a', user: { userId: 'user-a' }, activeTenant: { tenantId: 'tenant-a' },
    isLoading: false, isAuthenticated: true, isRestoring: false,
    authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeAuthorization(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const view = await renderMutation(() => 42, { onSuccess: () => notification.promise }, { auth } as unknown as Client);
  let request!: Promise<number>;
  await act(async () => { request = view.current.run(); await Promise.resolve(); });
  const settled = request.catch(error => error);
  await act(async () => {
    auth.authorizationScopeKey = 'scope-b'; auth.activeTenant.tenantId = 'tenant-b';
    for (const listener of listeners) listener();
  });
  await act(async () => notification.reject(new Error('synthetic stale notification')));
  expect(await settled).toBeInstanceOf(Error);
  expect(view.current.result).toBeNull(); expect(view.current.error).toBeNull();
  expect(view.current.pending).toBe(false); expect(events).toEqual([]);
});

test('emitErrors false also disables safe notification-failure emission', async () => {
  const view = await renderMutation(() => 42, { emitErrors: false, onSuccess() { throw new Error('synthetic'); } });
  await act(async () => { expect(await view.current.run()).toBe(42); });
  expect(events).toEqual([]);
});
