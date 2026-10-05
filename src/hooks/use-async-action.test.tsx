/** Accepted action results and local lifecycle are separate from app callback notifications. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { createHookContainer, installMinimalHookDom } from '../frontend/client/test-fixtures/react-hook-dom';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../frontend/client/observability';
import { useAsyncAction, type UseAsyncActionOptions, type UseAsyncActionReturn } from './use-async-action';

let root: Root | undefined;
let restoreDom: () => void;
let events: FrontendObservabilityEvent[];
beforeEach(() => {
  restoreDom = installMinimalHookDom(); events = [];
  configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined;
  restoreDom(); configureFrontendObservability({ http: false, console: false });
});

test('accepted callback failure does not reject the action or call its failure callback', async () => {
  const failures: unknown[] = [];
  const view = await renderAction(async () => 'accepted', {
    onSuccess: () => { throw new Error('private notification'); }, onError: (error) => failures.push(error),
  });
  let result: string | undefined;
  await act(async () => { result = await view.current.run(); });
  expect(result).toBe('accepted'); expect(view.current.error).toBeNull();
  expect(view.current.result).toBe('accepted'); expect(failures).toEqual([]);
  expect(events[0]?.metadata).toEqual({ surface: 'use-async-action', stage: 'accepted-callback' });
  expect(JSON.stringify(events)).not.toContain('private notification');
});

test('a rejected async accepted notification is awaited without reclassifying the writer', async () => {
  const notification = deferred<string>();
  const view = await renderAction(async () => 'accepted', { onSuccess: async () => { await notification.promise; } });
  let running!: Promise<string>;
  await act(async () => { running = view.current.run(); await Promise.resolve(); });
  expect(view.current.pending).toBe(true);
  await act(async () => { notification.reject(new Error('private async notification')); await running; });
  expect(view.current.pending).toBe(false); expect(view.current.result).toBe('accepted');
  expect(view.current.error).toBeNull(); expect(events).toHaveLength(1);
});

test('concurrent actions retain pending state until the admitted group completes', async () => {
  const first = deferred<string>(), second = deferred<string>(); let calls = 0;
  const view = await renderAction(() => ++calls === 1 ? first.promise : second.promise, { resetOnRun: false });
  let a!: Promise<string>, b!: Promise<string>;
  await act(async () => { a = view.current.run(); b = view.current.run(); });
  await act(async () => { first.resolve('first'); await a; });
  expect(view.current.pending).toBe(true);
  await act(async () => { second.resolve('second'); await b; });
  expect(view.current.pending).toBe(false); expect(view.current.result).toBe('second');
});

test('reset retires old presentation without canceling the accepted external result', async () => {
  const writer = deferred<string>(); const successes: string[] = [];
  const view = await renderAction(() => writer.promise, { onSuccess: (value) => successes.push(value) });
  let running!: Promise<string>; await act(async () => { running = view.current.run(); });
  await act(async () => view.current.reset());
  await act(async () => { writer.resolve('accepted'); await running; });
  expect(view.current.result).toBeNull(); expect(view.current.pending).toBe(false); expect(successes).toEqual([]);
});

test('default reset-on-run protects the newest result from an older completion', async () => {
  const first = deferred<string>(), second = deferred<string>(); let calls = 0;
  const successes: string[] = [];
  const view = await renderAction(() => ++calls === 1 ? first.promise : second.promise, {
    onSuccess: (value) => successes.push(value),
  });
  let a!: Promise<string>, b!: Promise<string>;
  await act(async () => { a = view.current.run(); b = view.current.run(); });
  await act(async () => { second.resolve('newest'); await b; });
  await act(async () => { first.resolve('older'); await a; });
  expect(view.current.result).toBe('newest'); expect(view.current.pending).toBe(false);
  expect(successes).toEqual(['newest']);
});

test('unmount suppresses late notifications and rejects a retained new run before action execution', async () => {
  const writer = deferred<string>(); let calls = 0, successes = 0;
  const view = await renderAction(() => { calls += 1; return writer.promise; }, { onSuccess: () => { successes += 1; } });
  let running!: Promise<string>; await act(async () => { running = view.current.run(); });
  const run = view.current.run;
  await act(async () => root!.unmount()); root = undefined;
  await act(async () => { writer.resolve('accepted'); await running; });
  await expect(run()).rejects.toThrow('unmounted');
  expect(calls).toBe(1); expect(successes).toBe(0); expect(events).toEqual([]);
});

test('a failing error notification cannot mask the original action rejection', async () => {
  const original = new Error('original action failure');
  const view = await renderAction(async () => { throw original; }, { onError: () => { throw new Error('private secondary callback'); } });
  await act(async () => { await expect(view.current.run()).rejects.toBe(original); });
  expect(view.current.error).toBe(original); expect(view.current.pending).toBe(false);
  expect(JSON.stringify(events)).not.toContain('private secondary callback');
});

async function renderAction(action: () => Promise<string>, options: UseAsyncActionOptions<string> = {}) {
  const { createRoot } = await import('react-dom/client'); root = createRoot(createHookContainer());
  let current!: UseAsyncActionReturn<[], string>;
  function Capture() { current = useAsyncAction(action, options); return null; }
  await act(async () => root!.render(createElement(Capture)));
  return { get current() { return current; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
