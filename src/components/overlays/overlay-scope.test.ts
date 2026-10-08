/** Shared DOM/SVG ref lifecycles; no portal, focus manager or app runtime executes. */
import { expect, test } from 'bun:test';
import { composeOverlayRefs } from './overlay-scope';

test('composed refs honor React 19 cleanup returns while clearing object and legacy refs', () => {
  const element = {} as HTMLElement;
  const objectRef = { current: null as HTMLElement | null };
  const calls: Array<HTMLElement | null> = [];
  let cleanups = 0, modernNullCalls = 0;
  const ref = composeOverlayRefs(objectRef, value => {
    if (!value) { modernNullCalls++; return; }
    return () => { cleanups++; };
  }, value => { calls.push(value); });
  const cleanup = ref(element);
  expect(objectRef.current).toBe(element);
  expect(calls).toEqual([element]);
  expect(typeof cleanup).toBe('function');
  (cleanup as () => void)();
  expect(objectRef.current).toBeNull();
  expect(calls).toEqual([element, null]);
  expect(cleanups).toBe(1);
  expect(modernNullCalls).toBe(0);
});

test('the same ref primitive admits SVG arrow refs without discarding cleanup', () => {
  const element = {} as SVGSVGElement;
  const objectRef = { current: null as SVGSVGElement | null };
  let cleanups = 0;
  const cleanup = composeOverlayRefs(objectRef, value => value ? () => { cleanups++; } : undefined)(element);
  expect(objectRef.current).toBe(element);
  (cleanup as () => void)();
  expect(objectRef.current).toBeNull();
  expect(cleanups).toBe(1);
});
