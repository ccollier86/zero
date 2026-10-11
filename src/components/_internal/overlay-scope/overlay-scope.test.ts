/** Shared DOM/SVG ref lifecycles; no portal, focus manager or app runtime executes. */
import { expect, test } from 'bun:test';
import { composeOverlayRefs, readOverlayTheme } from './overlay-scope';
import { addZeroSource } from '../../../add/copy';

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

test('theme reads use the source document realm and project custom properties plus color scheme only', () => {
  const values: Record<string, string> = { '--fixture-paint': '#123456', display: 'grid', '--fixture-height': '32px' };
  const keys = Object.keys(values);
  let reads = 0;
  const source = {
    ownerDocument: { defaultView: { getComputedStyle(element: Element) {
      expect(element).toBe(source as unknown as Element);
      reads++;
      return { length: keys.length, item: (index: number) => keys[index]!,
        getPropertyValue: (key: string) => values[key]!, colorScheme: 'dark' };
    } } },
  } as unknown as Element;
  expect(Object.entries(readOverlayTheme(source))).toEqual([
    ['--fixture-paint', '#123456'], ['--fixture-height', '32px'], ['colorScheme', 'dark'],
  ]);
  expect(reads).toBe(1);
});

test('theme reads remain harmless on the server or a document with no rendering view', () => {
  expect(readOverlayTheme(null)).toEqual({});
  expect(readOverlayTheme({ ownerDocument: { defaultView: null } } as unknown as Element)).toEqual({});
});

test('source-copied owned popovers include their shared presentation observer dependency', async () => {
  const plan = await addZeroSource({
    items: ['components/ui/combobox'],
    targetDir: '/Volumes/code-bank/tmp/scratch/zero-platform/overlay-scope-copy-dry-run',
    dryRun: true,
  });
  expect(plan.filesPlanned).toContain('components/overlays/overlay-scope.tsx');
  expect(plan.filesPlanned).toContain('lib/observe-presentation-theme.ts');
  expect(plan.filesWritten).toEqual([]);
});
