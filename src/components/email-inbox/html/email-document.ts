/** Browser-only final security pass. Never import a server DOM implementation. */
import createDOMPurify from 'dompurify';
import { EMAIL_HTML_ATTRIBUTES, EMAIL_HTML_TAGS, escapeEmailHtml } from './email-html-policy';
import type { PreparedEmailHtml } from './prepare-email-html';

const READER_CSS = `html{color-scheme:light;background:#fff;color:#202124}html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;overflow:visible!important}body{font:14px/1.65 system-ui,-apple-system,sans-serif;overflow-wrap:break-word}img{max-width:100%;height:auto}img[data-zero-email-image-blocked]{display:inline-block;min-width:20px;min-height:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#2765c9}blockquote{margin-inline:0;padding-inline-start:16px;border-inline-start:2px solid #dadce0}table{max-width:100%}*{box-sizing:border-box} @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

export function createEmailDocument(prepared: PreparedEmailHtml, view: Window & typeof globalThis): string {
  const purifier = createDOMPurify(view);
  let clean = purifier.sanitize(prepared.html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: ['html', 'head', 'body', 'style', ...EMAIL_HTML_TAGS],
    ALLOWED_ATTR: [...EMAIL_HTML_ATTRIBUTES, 'style', 'href', 'src', 'alt', 'rel', 'loading', 'decoding', 'referrerpolicy', 'data-zero-email-image-blocked', 'data-zero-email-remote-image'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, SANITIZE_DOM: true,
    FORBID_TAGS: ['svg', 'math', 'script', 'template', 'noscript'],
    FORBID_ATTR: ['name', 'is', 'slot', 'nonce', 'srcset'],
    RETURN_TRUSTED_TYPE: false,
  });
  const resources = new Map(prepared.remoteImages.map(image => [image.token, image.url]));
  // This is trusted serialization of prevalidated URLs, not another HTML parse.
  clean = clean.replace(/data-zero-email-remote-image="(\d+)"/g, (_attribute, token: string) => resources.has(token) ? `src="${escapeEmailHtml(resources.get(token)!)}"` : '');
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${prepared.remoteOrigins.map(origin => ' ' + origin).join('')}; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
  // Security policy and baseline precede authored styles. Only sanitized complete HTML is composed here.
  return clean.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${escapeEmailHtml(csp)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${READER_CSS}</style>`);
}
