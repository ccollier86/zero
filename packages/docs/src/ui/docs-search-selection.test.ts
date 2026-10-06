/** Transient per-tab landing receipts are bounded by target, snapshot identity, mount and lifetime. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createDocsSearchSelection, rememberDocsSearchSelection, consumeDocsSearchSelection, validDocsSearchSelection } from './docs-search-selection';
import type { DocsSearchResult } from './types';
import { configureFrontendObservability, getFrontendObservabilitySink, type FrontendObservabilityEvent, type FrontendObservabilitySink } from '@zero/framework/react';

const now = 1_000_000, hash = 'a'.repeat(64);
const result: DocsSearchResult = { route: '/docs/guide#setup', pageRoute: '/docs/guide', path: '/docs/guide', title: 'Guide', excerpt: 'Text', passageId: 'docs-p-4', pageHash: hash };
const selection = { basePath: '/docs', pageRoute: '/docs/guide', route: '/docs/guide#setup', passageId: 'docs-p-4', pageHash: hash, query: 'needle', createdAt: now };
let descriptor: PropertyDescriptor | undefined;
let memory: Map<string, string>;
let clock: ReturnType<typeof spyOn>;
let previousSink: FrontendObservabilitySink;
let events: FrontendObservabilityEvent[];
beforeEach(() => {
  descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'); memory = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { setItem: (key: string, value: string) => memory.set(key, value), getItem: (key: string) => memory.get(key) ?? null, removeItem: (key: string) => memory.delete(key) } });
  clock = spyOn(Date, 'now').mockReturnValue(now);
  previousSink = getFrontendObservabilitySink(); events = [];
  configureFrontendObservability({ sink: { emit: event => { events.push(event); } } });
});
afterEach(() => {
  clock.mockRestore();
  configureFrontendObservability({ sink: previousSink });
  if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('documentation search landing context', () => {
  test('creation retains canonical target and immutable snapshot while trimming and bounding the query', () => {
    expect(createDocsSearchSelection('/docs', result, '  needle  ')).toEqual(selection);
    expect(createDocsSearchSelection('/docs', result, 'x'.repeat(201)).query).toHaveLength(200);
  });
  test('TTL boundaries reject future or expired contexts and admit a five-minute-old receipt', () => {
    expect(validDocsSearchSelection(selection, '/docs', '/docs/guide', hash, now)).toBe(true);
    expect(validDocsSearchSelection(selection, '/docs', '/docs/guide', hash, now + 300_000)).toBe(true);
    expect(validDocsSearchSelection(selection, '/docs', '/docs/guide', hash, now + 300_001)).toBe(false);
    expect(validDocsSearchSelection(selection, '/docs', '/docs/guide', hash, now - 1)).toBe(false);
    for (const createdAt of [NaN, Infinity, 'now']) expect(validDocsSearchSelection({ ...selection, createdAt }, '/docs', '/docs/guide', hash, now)).toBe(false);
  });
  test('mount, page, changed hash, query and malformed targets cannot reactivate another destination', () => {
    for (const override of [{ basePath: '/other' }, { pageRoute: '/docs/other' }, { route: '/docs/other#setup' }, { route: '//outside.test/docs' },
      { route: '/docs/guide?query=secret#setup' }, { route: '/docs/guide\\bad#setup' }, { pageHash: 'b'.repeat(64) },
      { query: 'x' }, { query: 'x'.repeat(201) }, { passageId: 'invalid' }, { passageId: 'docs-p-' + '1'.repeat(17) }]) {
      expect(validDocsSearchSelection({ ...selection, ...override }, '/docs', '/docs/guide', hash, now)).toBe(false);
    }
    const root = { ...selection, basePath: '/', pageRoute: '/guide', route: '/guide#setup' };
    expect(validDocsSearchSelection(root, '/', '/guide', hash, now)).toBe(true);
    expect(validDocsSearchSelection({ ...selection, pageHash: undefined }, '/docs', '/docs/guide', hash, now)).toBe(true);
    const alias = { ...selection, pageRoute: '/docs/a/../guide', route: '/docs/a/../guide#setup' };
    expect(validDocsSearchSelection(alias, '/docs', alias.pageRoute, hash, now)).toBe(false);
  });
  test('stored selection is consumed once; another mount cannot consume or expose it', () => {
    rememberDocsSearchSelection(selection);
    expect(consumeDocsSearchSelection('/manual', '/manual/guide', hash)).toBeNull();
    expect(consumeDocsSearchSelection('/docs', '/docs/guide', hash)).toEqual(selection);
    expect(consumeDocsSearchSelection('/docs', '/docs/guide', hash)).toBeNull();
  });
  test('valid long Unicode route context fits the bounded receipt and survives a per-tab round trip', () => {
    const pageRoute = '/docs/' + encodeURIComponent('界'.repeat(440));
    const value = { ...selection, pageRoute, route: pageRoute + '#' + encodeURIComponent('章'.repeat(256)) };
    expect(JSON.stringify(value).length).toBeGreaterThan(8192);
    rememberDocsSearchSelection(value);
    expect(consumeDocsSearchSelection('/docs', pageRoute, hash)).toEqual(value);
  });
  test('malformed, oversized, stale or wrong-snapshot stored context is retired before returning null', () => {
    for (const stored of ['{bad', 'x'.repeat(16_385), JSON.stringify({ ...selection, createdAt: now - 300_001 }), JSON.stringify({ ...selection, pageHash: 'changed' })]) {
      memory.set('zero-docs-search:/docs', stored);
      expect(consumeDocsSearchSelection('/docs', '/docs/guide', hash)).toBeNull();
      expect(memory.has('zero-docs-search:/docs')).toBe(false);
    }
  });
  test('storage failures report only static stage information, never query or exception payload', () => {
    const sensitive = 'PRIVATE_QUERY_AND_CREDENTIAL';
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
      setItem() { throw new Error(sensitive); }, getItem() { throw new Error(sensitive); }, removeItem() { throw new Error(sensitive); },
    } });
    rememberDocsSearchSelection({ ...selection, query: sensitive });
    expect(consumeDocsSearchSelection('/docs', '/docs/guide', hash)).toBeNull();
    expect(events).toHaveLength(2);
    expect(events.map(event => event.metadata)).toEqual([{ stage: 'selection-store' }, { stage: 'selection-read' }]);
    expect(JSON.stringify(events)).not.toContain(sensitive);
  });
});
