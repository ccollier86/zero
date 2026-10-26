/** Synthetic bounded document admission: typed rich content only, explicit image alternatives and safe search. */
import { expect, test } from 'bun:test';
import { captureBlogDocument, captureBlogImage, captureBlogPostContent, blogDocumentText, blogSearchExpression } from './content-validation';
const document = () => ({ version: 1, blocks: [{ id: 'intro', type: 'paragraph', content: [{ text: 'Hello ' }, { text: 'world', bold: true, href: '/blog/world' }] }, { id: 'more', type: 'heading', level: 2, content: [{ text: 'Details' }] }] });
test('preserves inline whitespace, marks, stable heading identities and searchable text', () => {
  const captured = captureBlogDocument(document());
  expect(captured.blocks[0]).toMatchObject({ content: [{ text: 'Hello ' }, { text: 'world', bold: true, href: '/blog/world' }] });
  expect(blogDocumentText(captured)).toBe('Hello world\nDetails');
});
test('rejects unknown blocks/versions, executable links and duplicate block identities', () => {
  for (const invalid of [{ version: 2, blocks: [] }, { version: 1, blocks: [{ id: 'x', type: 'html', html: '<script>bad()</script>' }] },
    { version: 1, blocks: [{ id: 'x', type: 'paragraph', content: [{ text: 'bad', href: 'javascript:bad()' }] }] },
    { version: 1, blocks: [{ id: 'x', type: 'divider' }, { id: 'x', type: 'divider' }] }]) expect(() => captureBlogDocument(invalid)).toThrow();
});
test('rejects accessors, proxies and sparse/extended arrays without executing code', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'version', { enumerable: true, get() { calls++; return 1; } });
  expect(() => captureBlogDocument(getter)).toThrow();
  expect(() => captureBlogDocument({ version: 1, blocks: new Array(2) })).toThrow();
  const extended: unknown[] & { other?: number } = []; extended.other = 1;
  expect(() => captureBlogDocument({ version: 1, blocks: extended })).toThrow();
  expect(calls).toBe(0);
});
test('image placements require descriptive alt or explicit decoration, independently of asset identity', () => {
  expect(captureBlogImage({ mediaId: 'media-1', alt: 'A blue cup' }).alt).toBe('A blue cup');
  expect(captureBlogImage({ mediaId: 'media-1', alt: '', decorative: true }).decorative).toBe(true);
  expect(() => captureBlogImage({ mediaId: 'media-1', alt: '' })).toThrow();
  expect(() => captureBlogImage({ mediaId: 'media-1', alt: 'Cup', decorative: true })).toThrow();
});
test('adopts ordinary SEO defaults and admits no caller-selected scope or raw image URLs', () => {
  const input = { title: 'Hello', slug: 'hello', authorId: 'author-1', document: document() };
  expect(captureBlogPostContent(input).seo).toEqual({ title: null, description: null, noIndex: false, socialImage: null });
  expect(() => captureBlogPostContent({ ...input, tenantId: 'other' })).toThrow();
  expect(() => captureBlogPostContent({ ...input, featuredImage: { src: 'https://example.test/private', alt: 'Something' } })).toThrow();
});
test('user search operators are ordinary token text, with bounded prefix matching', () => {
  expect(blogSearchExpression('hello world')).toBe('"hello" AND "world"*');
  expect(blogSearchExpression('title:hello OR *')).toBe('"title" AND "hello" AND "OR"*');
  expect(blogSearchExpression('"*():')).toBe('');
});
