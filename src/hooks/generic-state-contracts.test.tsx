/** Focused SSR and controlled-state contracts; synthetic null-rendered React hooks only. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHookContainer, installMinimalHookDom } from '../frontend/client/test-fixtures/react-hook-dom';
import { useControlledState } from './use-controlled-state';
import { useDataState } from './use-data-state';

let restoreDom: () => void;
let root: Root | undefined;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; restoreDom(); });

test('data-attribute observation has a stable null SSR fallback', () => {
  function Capture() { const [value] = useDataState('open'); return <span>{String(value)}</span>; }
  expect(renderToStaticMarkup(<Capture />)).toBe('<span>null</span>');
});

test('controlled changes request the parent value without overriding it locally', async () => {
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createHookContainer());
  let current!: ReturnType<typeof useControlledState<number>>;
  const requested: number[] = [];
  function Capture({ value }: { value: number }) {
    current = useControlledState({ value, onChange: (next) => requested.push(next) });
    return null;
  }
  await act(async () => root!.render(createElement(Capture, { value: 1 })));
  await act(async () => current[1](2));
  expect(requested).toEqual([2]);
  expect(current[0]).toBe(1);
  await act(async () => root!.render(createElement(Capture, { value: 2 })));
  expect(current[0]).toBe(2);
});

test('uncontrolled default values still update through the same setter', async () => {
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createHookContainer());
  let current!: ReturnType<typeof useControlledState<number>>;
  function Capture() { current = useControlledState({ defaultValue: 1 }); return null; }
  await act(async () => root!.render(createElement(Capture)));
  await act(async () => current[1](2));
  expect(current[0]).toBe(2);
});
