/** Canonical document round trips must not silently lose formatting or admit editor-only content. */
import { expect, test } from 'bun:test';
import { blogInlineFromEditor, blogInlineToEditor } from './editor-inline-codec';
import type { BlogInlineText } from '../../blog/content-types';

test('inline marks survive leading, trailing and consecutive line breaks', () => {
  const runs: BlogInlineText[] = [{ text: '\nBold\n\n', bold: true, italic: true }, { text: 'linked\n', href: 'https://example.test/path' }, { text: 'code', code: true }];
  expect(blogInlineFromEditor(blogInlineToEditor(runs))).toEqual(runs);
  expect(blogInlineFromEditor(blogInlineToEditor([]))).toEqual([]);
});
test('paragraph paste normalizes explicitly while unsupported nodes and links fail closed', () => {
  expect(blogInlineFromEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] })).toEqual([{ text: 'one\n\ntwo' }]);
  expect(() => blogInlineFromEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'https://example.test' } }] }] })).toThrow();
  expect(() => blogInlineFromEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })).toThrow();
});
