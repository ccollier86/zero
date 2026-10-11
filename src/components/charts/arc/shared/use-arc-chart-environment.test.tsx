/** Synthetic null-rendering environment tests; never boots an app or provider. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, type RefObject } from 'react';
import { renderToString } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import { installMinimalHookDom, createHookContainer } from '../../../../frontend/client/test-fixtures/react-hook-dom';
import { useArcChartEnvironment, type ArcChartEnvironment } from './use-arc-chart-environment';

let restore: () => void;
let root: Root | undefined;
beforeEach(() => { restore = installMinimalHookDom(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; restore(); });

test('SSR waits for observation and keeps presentation options separate from values', () => {
  let state: ArcChartEnvironment | undefined;
  function Capture() { state = useArcChartEnvironment({ current: null }); return null; }
  expect(renderToString(createElement(Capture))).toBe('');
  expect(state).toEqual({ inView: false, visible: false, reduced: false });
});

test('first reveal animates, leaving settles, returning preserves reveal, and unmount releases listeners', async () => {
  const document = globalThis.document;
  const window = document.defaultView!;
  let hidden = false, matches = false, disconnected = false;
  const visibility = new Set<() => void>(), preference = new Set<() => void>();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.addEventListener = (type: string, callback: unknown) => { if (type === 'visibilitychange') visibility.add(callback as () => void); };
  document.removeEventListener = (type: string, callback: unknown) => { if (type === 'visibilitychange') visibility.delete(callback as () => void); };
  window.matchMedia = () => ({ get matches() { return matches; },
    addEventListener: (_type: string, callback: () => void) => preference.add(callback),
    removeEventListener: (_type: string, callback: () => void) => preference.delete(callback),
  }) as unknown as MediaQueryList;
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  let observerCallback!: IntersectionObserverCallback;
  class Observer {
    constructor(callback: IntersectionObserverCallback) { observerCallback = callback; }
    observe() {} disconnect() { disconnected = true; }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: Observer });
  try {
    const ref = { current: createHookContainer() as HTMLElement } satisfies RefObject<HTMLElement>;
    let current!: ArcChartEnvironment, motion = true;
    function Capture() { current = useArcChartEnvironment(ref, { motion }); return null; }
    const { createRoot } = await import('react-dom/client');
    root = createRoot(createHookContainer());
    await act(async () => root!.render(createElement(Capture)));
    expect(current).toEqual({ inView: false, visible: false, reduced: false });
    const intersect = async (isIntersecting: boolean) => act(async () => observerCallback(
      [{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
    await intersect(true);
    expect(current).toEqual({ inView: true, visible: true, reduced: false });
    await intersect(false);
    expect(current).toEqual({ inView: true, visible: false, reduced: true });
    await intersect(true);
    expect(current).toEqual({ inView: true, visible: true, reduced: false });
    await act(async () => { hidden = true; visibility.forEach(callback => callback()); });
    expect(current).toEqual({ inView: true, visible: false, reduced: true });
    await act(async () => { hidden = false; matches = true; visibility.forEach(callback => callback()); preference.forEach(callback => callback()); });
    expect(current).toEqual({ inView: true, visible: true, reduced: true });
    await act(async () => { matches = false; preference.forEach(callback => callback()); motion = false; root!.render(createElement(Capture)); });
    expect(current.reduced).toBe(true);
    await act(async () => root!.unmount()); root = undefined;
    expect(disconnected).toBe(true); expect(visibility.size).toBe(0); expect(preference.size).toBe(0);
    await intersect(false); // A delayed observer callback after cleanup is harmless.
  } finally {
    if (prior) Object.defineProperty(globalThis, 'IntersectionObserver', prior);
    else delete (globalThis as Record<string, unknown>).IntersectionObserver;
  }
});
