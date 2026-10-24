/** Plain quotation of HTML-only mail without a live DOM, network loads or editor HTML import. */
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { EMAIL_HTML_DROP, EMAIL_HTML_LIMITS, EmailHtmlError } from './email-html-policy';
const BLOCKS = new Set('div p blockquote li ul ol h1 h2 h3 h4 h5 h6 table tr section article header footer br hr'.split(' '));
export function emailQuotedText(html: string): string {
  if (new TextEncoder().encode(html).length > EMAIL_HTML_LIMITS.bytes) throw new EmailHtmlError('This HTML-only message is too large to quote safely.');
  let nodes = 0;
  const walk = (node: DefaultTreeAdapterMap['node'], depth: number): string => {
    if (++nodes > EMAIL_HTML_LIMITS.nodes || depth > EMAIL_HTML_LIMITS.depth) throw new EmailHtmlError('This message is too complex to quote safely.');
    if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
    if (!('childNodes' in node)) return '';
    const tag = (node as DefaultTreeAdapterMap['element']).tagName;
    if (tag === 'head' || EMAIL_HTML_DROP.has(tag)) return '';
    const text = node.childNodes.map(child => walk(child, depth + 1)).join('');
    return BLOCKS.has(tag) ? `\n${text}\n` : tag === 'td' || tag === 'th' ? `${text}\t` : text;
  };
  return walk(parse(html), 0).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
