import { describe, expect, test } from 'bun:test';
import { extractMarkdownLinks, parseDocumentationPage, stripFences } from './markdown';

describe('documentation structure parser', () => {
  test('extracts metadata and repeated heading anchors', () => {
    const page = parseDocumentationPage('---\nid: test.page\ntype: reference\n---\n# Some `API`\n## Some API\n');
    expect(page.metadata.id).toBe('test.page');
    expect([...page.anchors]).toEqual(['some-api', 'some-api-1']);
  });

  test('ignores fenced example links and keeps prose links', () => {
    expect(extractMarkdownLinks(stripFences('[Parent](./index.md)\n```md\n[Example](./missing.md)\n```\n[Next](./next.md)')))
      .toEqual(['./index.md', './next.md']);
  });

  test('handles nested paths, angle destinations and reference targets', () => {
    expect(extractMarkdownLinks('[Page](../app/(group)/page.tsx) [Space](<./with space.md>)\n[x]: ./file.md#anchor "title"'))
      .toEqual(['../app/(group)/page.tsx', './with space.md', './file.md#anchor']);
  });

  test('rejects missing or nonmapping front matter', () => {
    expect(() => parseDocumentationPage('# No metadata')).toThrow();
    expect(() => parseDocumentationPage('---\n- item\n---\n# List')).toThrow();
  });
});
