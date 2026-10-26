/** Closed, bounded publishing input admission. It never reads Storage, executes markup or chooses authority. */
import { blogInvalid, blogRecord as sharedBlogRecord, blogText, blogUrl } from './validation';
import { types as utilTypes } from 'node:util';
import type { BlogDocument, BlogDocumentBlock, BlogImageReference, BlogInlineText, BlogPostContent, BlogPostQuery, BlogTermInput } from './content-types';
function blogRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value && typeof value === 'object' && utilTypes.isProxy(value)) return blogInvalid();
  return sharedBlogRecord(value, keys);
}

/** Detach a dense data-only array before validation; no getters or proxies execute. */
export function blogArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return blogInvalid();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return blogInvalid();
    result.push(descriptor.value);
  }
  return result;
}
export function blogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) return blogInvalid();
  return value;
}
export function blogSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return blogInvalid();
  return value;
}
function text(value: unknown, max: number, empty = true): string {
  const result = blogText(value, max)!;
  if ((!empty && !result) || !wellFormed(result)) return blogInvalid();
  return result;
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function flag(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') return blogInvalid();
  return value;
}
/** Bound work before allocating a canonical document, including direct server-facade callers. */
function contentBudget(value: unknown): void {
  const stack = [value], seen = new Set<object>(); let nodes = 0, bytes = 0;
  const encoder = new TextEncoder();
  while (stack.length) {
    const next = stack.pop();
    if (++nodes > 18000) return blogInvalid();
    if (typeof next === 'string') { if (next.length > 262144) return blogInvalid(); bytes += encoder.encode(next).byteLength; if (bytes > 512 * 1024) return blogInvalid(); }
    else if (next && typeof next === 'object') {
      if (seen.has(next) || utilTypes.isProxy(next) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(next))) return blogInvalid();
      seen.add(next);
      const keys = Reflect.ownKeys(next);
      if (keys.length > 501) return blogInvalid();
      for (const key of keys) {
        if (Array.isArray(next) && key === 'length') continue;
        const property = Object.getOwnPropertyDescriptor(next, key);
        if (typeof key !== 'string' || !property?.enumerable || !('value' in property)) return blogInvalid();
        stack.push(property.value);
      }
    } else if (typeof next === 'function' || typeof next === 'symbol' || typeof next === 'bigint') return blogInvalid();
  }
}
function inline(value: unknown): BlogInlineText[] {
  return blogArray(value, 256).map(value => {
    const r = blogRecord(value, ['text', 'bold', 'italic', 'underline', 'strike', 'code', 'href']);
    // Whitespace inside runs is meaningful ("hello " + bold "world").
    if (typeof r.text !== 'string' || r.text.length > 16000 || !wellFormed(r.text) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(r.text)) return blogInvalid();
    const node: BlogInlineText = { text: r.text };
    for (const mark of ['bold', 'italic', 'underline', 'strike', 'code'] as const) if (r[mark] !== undefined) node[mark] = flag(r[mark]);
    if (r.href !== undefined) {
      const href = text(r.href, 2048, false);
      if (href.startsWith('/') && !href.startsWith('//') && !/[\\\s]/u.test(href)) node.href = href;
      else { const accepted = blogUrl(href); if (!accepted) return blogInvalid(); node.href = accepted; }
    }
    return node;
  });
}
/** Every image occurrence has explicit descriptive alt text or explicit decoration. */
export function captureBlogImage(value: unknown): BlogImageReference {
  const r = blogRecord(value, ['mediaId', 'alt', 'decorative', 'caption']);
  const decorative = flag(r.decorative), alt = text(r.alt, 2000);
  if (decorative ? alt !== '' : alt === '') return blogInvalid();
  return { mediaId: blogId(r.mediaId), alt, decorative, ...(r.caption === undefined ? {} : { caption: text(r.caption, 2000) }) };
}
/** One explicit document version; arbitrary editor JSON, raw HTML and unknown blocks reject. */
export function captureBlogDocument(value: unknown): BlogDocument {
  contentBudget(value);
  const r = blogRecord(value, ['version', 'blocks']);
  if (r.version !== 1) return blogInvalid();
  const ids = new Set<string>();
  const blocks = blogArray(r.blocks, 500).map((value): BlogDocumentBlock => {
    const base = blogRecord(value, ['id', 'type', 'content', 'level', 'attribution', 'ordered', 'items', 'tone', 'title', 'code', 'language', 'filename', 'image', 'images', 'layout', 'columns', 'mediaId', 'poster', 'artist', 'cover', 'url', 'description']);
    const id = blogId(base.id); if (ids.has(id)) return blogInvalid(); ids.add(id);
    const selected = (keys: string[]) => blogRecord(value, ['id', 'type', ...keys]);
    switch (base.type) {
      case 'paragraph': { const b = selected(['content']); return { id, type: 'paragraph', content: inline(b.content) }; }
      case 'heading': { const b = selected(['content', 'level']); if (![2, 3, 4, 5, 6].includes(b.level as number)) return blogInvalid(); return { id, type: 'heading', level: b.level as 2, content: inline(b.content) }; }
      case 'quote': { const b = selected(['content', 'attribution']); return { id, type: 'quote', content: inline(b.content), ...(b.attribution === undefined ? {} : { attribution: text(b.attribution, 300) }) }; }
      case 'callout': { const b = selected(['content', 'tone', 'title']); if (!['info', 'warning', 'error', 'success', 'tip'].includes(b.tone as string)) return blogInvalid(); return { id, type: 'callout', tone: b.tone as 'info', content: inline(b.content), ...(b.title === undefined ? {} : { title: text(b.title, 300) }) }; }
      case 'list': { const b = selected(['ordered', 'items']); return { id, type: 'list', ordered: flag(b.ordered), items: blogArray(b.items, 200).map(inline) }; }
      case 'code': { const b = selected(['code', 'language', 'filename']); if (typeof b.code !== 'string' || b.code.length > 64000 || !wellFormed(b.code) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(b.code)) return blogInvalid(); return { id, type: 'code', code: b.code, language: text(b.language, 80, false), ...(b.filename === undefined ? {} : { filename: text(b.filename, 200) }) }; }
      case 'image': { const b = selected(['image']); return { id, type: 'image', image: captureBlogImage(b.image) }; }
      case 'gallery': { const b = selected(['images', 'layout', 'columns']); if (!['grid', 'carousel', 'stack'].includes(b.layout as string) || ![2, 3, 4].includes(b.columns as number)) return blogInvalid(); const images = blogArray(b.images, 40).map(captureBlogImage); if (!images.length) return blogInvalid(); return { id, type: 'gallery', images, layout: b.layout as 'grid', columns: b.columns as 2 }; }
      case 'video': { const b = selected(['mediaId', 'title', 'poster']); return { id, type: 'video', mediaId: blogId(b.mediaId), title: text(b.title, 300), ...(b.poster === undefined ? {} : { poster: captureBlogImage(b.poster) }) }; }
      case 'audio': { const b = selected(['mediaId', 'title', 'artist', 'cover']); return { id, type: 'audio', mediaId: blogId(b.mediaId), title: text(b.title, 300), ...(b.artist === undefined ? {} : { artist: text(b.artist, 300) }), ...(b.cover === undefined ? {} : { cover: captureBlogImage(b.cover) }) }; }
      case 'embed': { const b = selected(['url', 'title', 'description']), url = blogUrl(b.url); if (!url) return blogInvalid(); return { id, type: 'embed', url, title: text(b.title, 300), ...(b.description === undefined ? {} : { description: text(b.description, 2000) }) }; }
      case 'divider': selected([]); return { id, type: 'divider' };
      default: return blogInvalid();
    }
  });
  const accepted = { version: 1 as const, blocks };
  if (new TextEncoder().encode(JSON.stringify(accepted)).byteLength > 512 * 1024) return blogInvalid();
  return accepted;
}
/** Canonical full replacement draft. Partial patch merging belongs to an editor, not the commit boundary. */
export function captureBlogPostContent(value: unknown): BlogPostContent {
  contentBudget(value);
  const r = blogRecord(value, ['title', 'slug', 'excerpt', 'authorId', 'document', 'featuredImage', 'categoryIds', 'tagIds', 'seo']);
  const seo = r.seo === undefined ? {} : blogRecord(r.seo, ['title', 'description', 'noIndex', 'socialImage']);
  const identifiers = (value: unknown) => { const values = blogArray(value ?? [], 30).map(blogId); if (new Set(values).size !== values.length) return blogInvalid(); return values; };
  const result = { title: text(r.title, 300), slug: blogSlug(r.slug), excerpt: text(r.excerpt ?? '', 4000), authorId: blogId(r.authorId), document: captureBlogDocument(r.document),
    featuredImage: r.featuredImage == null ? null : captureBlogImage(r.featuredImage), categoryIds: identifiers(r.categoryIds), tagIds: identifiers(r.tagIds),
    seo: { title: seo.title == null ? null : text(seo.title, 300), description: seo.description == null ? null : text(seo.description, 2000), noIndex: flag(seo.noIndex), socialImage: seo.socialImage == null ? null : captureBlogImage(seo.socialImage) } };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 576 * 1024) return blogInvalid();
  return result;
}
/** Extract index text from admitted content only; never execute embeds or fetch media. */
export function blogDocumentText(document: BlogDocument): string {
  return document.blocks.map(b => 'content' in b ? b.content.map(run => run.text).join('') : b.type === 'list' ? b.items.map(item => item.map(run => run.text).join('')).join('\n')
    : b.type === 'code' ? b.code : b.type === 'image' ? b.image.alt : b.type === 'gallery' ? b.images.map(image => image.alt).join('\n') : 'title' in b ? b.title : '').join('\n');
}
export function blogContentMedia(content: BlogPostContent): readonly { id: string; kind: 'image' | 'video' | 'audio' }[] {
  const result: { id: string; kind: 'image' | 'video' | 'audio' }[] = [], image = (value: BlogImageReference | null | undefined) => { if (value) result.push({ id: value.mediaId, kind: 'image' }); };
  image(content.featuredImage); image(content.seo.socialImage);
  for (const b of content.document.blocks) {
    if (b.type === 'image') image(b.image);
    if (b.type === 'gallery') b.images.forEach(image);
    if (b.type === 'audio') { result.push({ id: b.mediaId, kind: 'audio' }); image(b.cover); }
    if (b.type === 'video') { result.push({ id: b.mediaId, kind: 'video' }); image(b.poster); }
  }
  return result;
}
export function captureBlogTerm(value: unknown): BlogTermInput {
  const r = blogRecord(value, ['kind', 'slug', 'name', 'description', 'parentId', 'seoTitle', 'seoDescription', 'noIndex']);
  if (r.kind !== 'category' && r.kind !== 'tag') return blogInvalid();
  const parentId = r.parentId == null ? null : blogId(r.parentId); if (r.kind === 'tag' && parentId !== null) return blogInvalid();
  return { kind: r.kind, slug: blogSlug(r.slug), name: text(r.name, 160, false), description: text(r.description ?? '', 4000), parentId,
    seoTitle: r.seoTitle == null ? null : text(r.seoTitle, 300), seoDescription: r.seoDescription == null ? null : text(r.seoDescription, 2000), noIndex: flag(r.noIndex) };
}
export function captureBlogQuery(value: unknown = {}): Required<Pick<BlogPostQuery, 'limit' | 'offset' | 'order'>> & BlogPostQuery {
  const r = blogRecord(value, ['search', 'status', 'authorId', 'categoryId', 'tagId', 'limit', 'offset', 'order']);
  const limit = r.limit ?? 20, offset = r.offset ?? 0, order = r.order ?? (r.search ? 'relevance' : 'recent');
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 100000
    || !['recent', 'oldest', 'relevance'].includes(order as string) || r.status !== undefined && !['draft', 'published', 'withdrawn', 'trashed'].includes(r.status as string)) return blogInvalid();
  return { limit: Number(limit), offset: Number(offset), order: order as 'recent', ...(r.search === undefined ? {} : { search: text(r.search, 256) }),
    ...(r.status === undefined ? {} : { status: r.status as 'draft' }), ...(r.authorId === undefined ? {} : { authorId: blogId(r.authorId) }),
    ...(r.categoryId === undefined ? {} : { categoryId: blogId(r.categoryId) }), ...(r.tagId === undefined ? {} : { tagId: blogId(r.tagId) }) };
}
/** Quote ordinary words, never admit FTS operators/column selectors from an untrusted search box. */
export function blogSearchExpression(search: string): string {
  const words = search.normalize('NFC').match(/[\p{L}\p{N}]+/gu)?.slice(0, 16) ?? [];
  return words.map((word, index) => '"' + word + '"' + (index === words.length - 1 ? '*' : '')).join(' AND ');
}
