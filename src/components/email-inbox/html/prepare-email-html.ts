/** Network-free HTML5 parse before any browser DOM sees a sender's markup. */
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { createEmailCssBudget, sanitizeEmailCss } from './email-css';
import { EMAIL_HTML_ATTRIBUTES, EMAIL_HTML_DROP, EMAIL_HTML_LIMITS, EMAIL_HTML_TAGS,
  EmailHtmlError, emailUrl, escapeEmailHtml, normalizedContentId } from './email-html-policy';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
export interface EmailInlineImage { contentId: string; url: string }
export interface PreparedEmailHtml {
  html: string;
  blockedImages: number;
  contentIds: string[];
  remoteOrigins: string[];
  /** Remote URLs stay outside DOMPurify's detached DOM until CSP/referrer policy exists. */
  remoteImages: { token: string; url: string }[];
}
export interface PrepareEmailHtmlOptions {
  appOrigin?: string;
  loadRemoteImages?: boolean;
  /** Only reader-created, validated image data URLs are admitted. */
  inlineImages?: readonly EmailInlineImage[];
}

export function prepareEmailHtml(source: string, options: PrepareEmailHtmlOptions = {}): PreparedEmailHtml {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > EMAIL_HTML_LIMITS.bytes) {
    throw new EmailHtmlError('Email HTML exceeds the safe rendering limit.');
  }
  const document = parse(source, { scriptingEnabled: true });
  const budget = createEmailCssBudget(), styles: string[] = [], contentIds = new Set<string>(), origins = new Set<string>();
  const images = new Map<string, string>(), duplicates = new Set<string>();
  for (const image of options.inlineImages ?? []) {
    const id = normalizedContentId(image.contentId);
    if (images.has(id)) duplicates.add(id);
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image.url) && image.url.length <= EMAIL_HTML_LIMITS.imageBytes * 1.4) images.set(id, image.url);
  }
  for (const id of duplicates) images.delete(id);
  let nodes = 0, resources = 0, blocked = 0; const bodyAttributes: string[] = [], remoteImages: PreparedEmailHtml['remoteImages'] = [];
  const walk = (node: Node, depth: number, inHead = false): string => {
    if (++nodes > EMAIL_HTML_LIMITS.nodes || depth > EMAIL_HTML_LIMITS.depth) throw new EmailHtmlError('Email markup exceeds the safe rendering complexity limit.');
    if (node.nodeName === '#text') return escapeEmailHtml((node as DefaultTreeAdapterMap['textNode']).value);
    if (!('childNodes' in node)) return '';
    const element = node as Element;
    const tag = element.tagName;
    if (tag && element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return '';
    if (tag === 'style') {
      const text = node.childNodes.filter(child => child.nodeName === '#text').map(child => (child as DefaultTreeAdapterMap['textNode']).value).join('');
      const clean = sanitizeEmailCss(text, false, budget); if (clean) styles.push(clean);
      return '';
    }
    if (tag && EMAIL_HTML_DROP.has(tag)) return '';
    if (tag === 'head') { node.childNodes.forEach(child => walk(child, depth + 1, true)); return ''; }
    const children = () => node.childNodes.map(child => walk(child, depth + 1, inHead)).join('');
    if (tag === 'body') {
      for (const attr of element.attrs) {
        if (attr.name === 'style') { const clean = sanitizeEmailCss(attr.value, true, budget); if (clean) bodyAttributes.push(`style="${escapeEmailHtml(clean)}"`); }
        else if (['class', 'lang', 'dir'].includes(attr.name) && attr.value.length <= 4096) bodyAttributes.push(`${attr.name}="${escapeEmailHtml(attr.value)}"`);
      }
      return children();
    }
    if (!tag || tag === 'html') return children();
    if (inHead) return '';
    if (!EMAIL_HTML_TAGS.has(tag)) return children();
    const attrs: string[] = [];
    let src: string | undefined, alt = '', hasAlt = false;
    for (const attr of element.attrs) {
      const { name, value } = attr;
      if (attr.namespace) continue;
      if (name === 'style') { const clean = sanitizeEmailCss(value, true, budget); if (clean) attrs.push(`style="${escapeEmailHtml(clean)}"`); }
      else if (name === 'href' && tag === 'a') {
        const url = emailUrl(value, 'link', options.appOrigin);
        if (url) attrs.push(`href="${escapeEmailHtml(url)}" rel="noopener noreferrer"`);
      } else if (tag === 'img' && name === 'src') src = value;
      else if (tag === 'img' && name === 'alt') { alt = value; hasAlt = true; }
      else if (EMAIL_HTML_ATTRIBUTES.has(name) && value.length <= 4096) {
        if (name === 'id' && /^zero-email-/i.test(value)) continue;
        if (['width', 'height', 'rowspan', 'colspan', 'size'].includes(name) && !/^\d{1,4}%?$/.test(value)) continue;
        attrs.push(`${name}="${escapeEmailHtml(value)}"`);
      }
    }
    if (tag === 'img') {
      if (++resources > EMAIL_HTML_LIMITS.resources) throw new EmailHtmlError('Email contains too many image resources.');
      let safe: string | undefined, remoteImage = false;
      if (src && /^cid:/i.test(src)) {
        const id = normalizedContentId(src); if (id) contentIds.add(id);
        safe = images.get(id);
      } else if (src) {
        const url = emailUrl(src, 'image', options.appOrigin);
        if (url && options.loadRemoteImages) { remoteImage = true; const token = String(remoteImages.length); remoteImages.push({ token, url });
          attrs.push(`data-zero-email-remote-image="${token}"`); origins.add(new URL(url).origin); }
        else if (url) blocked++;
      }
      attrs.push(`alt="${escapeEmailHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"`);
      if (safe) attrs.push(`src="${escapeEmailHtml(safe)}"`);
      else if (!remoteImage) attrs.push('data-zero-email-image-blocked="true"');
      if (!hasAlt && !safe && !remoteImage) attrs.push('title="Image not loaded"');
    }
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    return ['img', 'br', 'hr', 'wbr', 'col'].includes(tag) ? open : `${open}${children()}</${tag}>`;
  };
  const body = walk(document, 0);
  return { html: `<!doctype html><html><head>${styles.map(style => `<style>${style}</style>`).join('')}</head><body${bodyAttributes.length ? ' ' + bodyAttributes.join(' ') : ''}>${body}</body></html>`,
    blockedImages: blocked, contentIds: [...contentIds], remoteOrigins: [...origins], remoteImages };
}
