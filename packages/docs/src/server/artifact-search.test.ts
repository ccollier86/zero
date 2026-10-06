/** Portable artifact admission tests for bounded labels, passages and their AST targets. */
import { describe, expect, test } from 'bun:test';
import type { ZeroPluginJsonValue } from '@zero/framework/server';
import { admitDocsBuildData } from './artifact';
import { docsRuntimeFixture } from './test-fixture';
import type { DocsBuildData } from './types';

describe('compiled documentation search admission', () => {
  test('current compiler data and older snapshots without additive search metadata are admitted and frozen', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Current\n\nA paragraph.\n\n## Details\n\nDetailed information.' });
    try {
      const current = clone(fixture.snapshot.data);
      const admitted = admitDocsBuildData(current, fixture.options);
      expect(admitted.manifest.pages[0]!.passages!.length).toBeGreaterThan(0);
      expect(Object.isFrozen(admitted.manifest.pages[0]!.passages)).toBe(true);
      const old = clone(fixture.snapshot.data);
      const page = record(array(record(old).manifest, 'pages')[0]);
      delete page.passages;
      function strip(value: unknown): void {
        const node = record(value); delete node.searchId;
        for (const child of Array.isArray(node.children) ? node.children : []) strip(child);
      }
      strip(page.body);
      expect(admitDocsBuildData(old, fixture.options).manifest.pages[0]!.passages).toBeUndefined();
    } finally { await fixture.close(); }
  });

  test('inferred headings, page/navigation labels and encoded public routes enforce compiler bounds', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Valid\n\nParagraph.' });
    try {
      for (const path of [
        ['manifest', 'pages', 0, 'title'], ['manifest', 'pages', 0, 'navigation', 'label'],
        ['manifest', 'navigation', 0, 'label'], ['manifest', 'pages', 0, 'headings', 0, 'text'],
        ['manifest', 'pages', 0, 'headings', 0, 'id'], ['manifest', 'pages', 0, 'titleHeadingId'],
      ]) expectInvalid(change(fixture.snapshot.data, path, 'x'.repeat(257)), fixture.options);
      const oversize = clone(fixture.snapshot.data);
      replaceRoute(oversize, '/docs/' + 'x'.repeat(4_091)); // 4097 encoded characters.
      expectInvalid(oversize, fixture.options);
      const boundary = clone(fixture.snapshot.data);
      replaceRoute(boundary, '/docs/' + 'x'.repeat(4_090));
      expect(admitDocsBuildData(boundary, fixture.options).manifest.pages[0]!.route.length).toBe(4_096);
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'navigation', 0, 'route'], '/other-scope'), fixture.options);
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'navigation', 0, 'children'], 'not-a-list'), fixture.options);
    } finally { await fixture.close(); }
  });

  test('malformed passage identities, text and section context cannot bypass compiled admission', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Valid\n\nParagraph.' });
    try {
      for (const [path, value] of [
        [['manifest', 'pages', 0, 'passages'], null],
        [['manifest', 'pages', 0, 'passages', 0, 'id'], 'foreign-target'],
        [['manifest', 'pages', 0, 'passages', 0, 'text'], 1],
        [['manifest', 'pages', 0, 'passages', 0, 'text'], 'x'.repeat(4_096_001)],
        [['manifest', 'pages', 0, 'passages', 0, 'headingId'], 'missing-heading'],
        [['manifest', 'pages', 0, 'passages', 0, 'sectionPath'], Array(7).fill('Valid')],
        [['manifest', 'pages', 0, 'passages', 0, 'sectionPath'], ['x'.repeat(257)]],
        [['manifest', 'pages', 0, 'passages', 0, 'sectionPath'], [null]],
        [['manifest', 'pages', 0, 'body', 'children', 0, 'searchId'], 'foreign-target'],
        [['manifest', 'pages', 0, 'body', 'searchId'], 'docs-p-99'],
        [['manifest', 'pages', 0, 'body', 'children', 1, 'searchId'], 'docs-p-0'],
      ] as const) expectInvalid(change(fixture.snapshot.data, path, value), fixture.options);
    } finally { await fixture.close(); }
  });

  test('well-shaped but stale, duplicate, orphaned or reordered passage metadata is rejected', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Valid\n\nParagraph.\n\n## Detail\n\nMore content.' });
    try {
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'pages', 0, 'passages', 0, 'text'], 'Stale but bounded'), fixture.options);
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'pages', 0, 'passages', 1, 'id'], 'docs-p-0'), fixture.options);
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'pages', 0, 'passages', 1, 'id'], 'docs-p-99'), fixture.options);
      expectInvalid(change(fixture.snapshot.data, ['manifest', 'pages', 0, 'passages', 1, 'sectionPath'], ['Another section']), fixture.options);
      const missing = clone(fixture.snapshot.data);
      array(record(array(record(missing).manifest, 'pages')[0]), 'passages').pop();
      expectInvalid(missing, fixture.options);
      const reordered = clone(fixture.snapshot.data);
      array(record(array(record(reordered).manifest, 'pages')[0]), 'passages').reverse();
      expectInvalid(reordered, fixture.options);
      const overBudget = change(fixture.snapshot.data, ['manifest', 'pages', 0, 'passages'], Array(25_001).fill({ id: 'docs-p-0', text: 'Valid', sectionPath: [] }));
      expectInvalid(overBudget, fixture.options);
    } finally { await fixture.close(); }
  });

  test('visible fence labels and footnote anchors retain the compiler bounds', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Valid\n\nSee this note[^a].\n\n[^a]: Footnote text.\n\n```ts title="valid.ts"\nconst value = 1;\n```' });
    try {
      for (const type of ['code', 'footnoteDefinition', 'footnoteReference']) {
        const data = clone(fixture.snapshot.data);
        const page = record(array(record(data).manifest, 'pages')[0]);
        function find(value: unknown): Record<string, unknown> | undefined {
          const node = record(value); if (node.type === type) return node;
          for (const child of Array.isArray(node.children) ? node.children : []) {
            const found = find(child); if (found) return found;
          }
          return undefined;
        }
        const node = find(page.body)!;
        expect(node).toBeDefined();
        if (type === 'code') record(node.code).title = 'x'.repeat(257);
        else node.id = 'x'.repeat(257);
        expectInvalid(data, fixture.options);
      }
    } finally { await fixture.close(); }
  });
});

function clone(data: DocsBuildData): ZeroPluginJsonValue {
  return JSON.parse(JSON.stringify(data)) as ZeroPluginJsonValue;
}
function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function array(value: unknown, key: string): unknown[] {
  return record(value)[key] as unknown[];
}
function change(data: DocsBuildData, path: readonly (string | number)[], value: unknown): ZeroPluginJsonValue {
  const result = clone(data); let target: unknown = result;
  for (const segment of path.slice(0, -1)) target = record(target)[String(segment)];
  record(target)[String(path[path.length - 1])] = value;
  return result;
}
function replaceRoute(data: ZeroPluginJsonValue, route: string): void {
  const draft = record(data), manifest = record(draft.manifest), page = record(array(manifest, 'pages')[0]);
  const previous = page.route as string; page.route = route;
  record(array(manifest, 'navigation')[0]).route = route;
  const highlights = record(draft.highlights); highlights[route] = highlights[previous]; delete highlights[previous];
}
function expectInvalid(data: ZeroPluginJsonValue, options: Parameters<typeof admitDocsBuildData>[1]): void {
  expect(() => admitDocsBuildData(data, options)).toThrow(expect.objectContaining({ code: 'DOCS_SOURCE_INVALID' }));
}
