/** Safe presentation helpers, not URL fetching or publication admission. */
import type { BlogContentBlock, BlogPost, BlogTocItem } from './blog.types';

export function safeBlogHref(value: string | undefined, mail = false): string | undefined {
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value) || value.startsWith('//')) return undefined;
  if (/^[#?]/u.test(value) || value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
    if (mail && url.protocol === 'mailto:') return value;
  } catch { /* Unsafe or ambiguous relative URLs remain inert. */ }
  return undefined;
}
export function blogPostHref(post: BlogPost, baseUrl = '/blog'): string {
  return safeBlogHref(post.href) ?? `${safeBlogHref(baseUrl)?.replace(/\/+$/u, '') ?? '/blog'}/${encodeURIComponent(['.', '..'].includes(post.slug) ? post.id : post.slug)}`;
}
export function blogDate(value: string | undefined, locale = 'en-US'): { label: string; iso: string } | undefined {
  if (!value) return undefined;
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return undefined;
  try { return { label: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date), iso: date.toISOString() }; }
  catch { return { label: date.toISOString().slice(0, 10), iso: date.toISOString() }; }
}
export function blogHeadingId(text: string, index: number): string {
  return `${text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '') || 'section'}-${index + 1}`;
}
export function blogBlockToc(blocks: readonly BlogContentBlock[]): BlogTocItem[] {
  return blocks.flatMap((block, index) => block.type === 'heading' ? [{ id: block.anchor ?? blogHeadingId(block.text, index), text: block.text, level: block.level }] : []);
}
/** Ellipsis windows are bounded even for very large result sets. */
export function blogPageWindow(page: number, total: number): (number | 'start-gap' | 'end-gap')[] {
  const count = Number.isSafeInteger(total) && total > 0 ? total : 1;
  const current = Math.min(count, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const lo = Math.max(2, Math.min(current - 1, count - 4)), hi = Math.min(count - 1, Math.max(current + 1, 5));
  return [1, ...(lo > 2 ? ['start-gap' as const] : []), ...Array.from({ length: hi - lo + 1 }, (_, index) => lo + index), ...(hi < count - 1 ? ['end-gap' as const] : []), count];
}
