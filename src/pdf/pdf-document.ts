/**
 * pdf-document.ts
 *
 * Builds the complete HTML document sent to a renderer. This file owns safe
 * metadata/base/style insertion only; it does not validate limits or fetch
 * resources.
 */

import { PdfError } from './pdf-error';
import type { PdfRenderInput } from './pdf-types';

/** Compose a full HTML document while preserving full documents supplied by apps. */
export function composePdfDocument(input: PdfRenderInput): { html: string; baseUrl?: string } {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const additions = buildHeadAdditions(input, baseUrl);
  const source = input.html;

  if (isFullDocument(source)) {
    const withLanguage = addMissingLanguage(source, input.document?.lang);
    return {
      html: insertIntoHead(withLanguage, additions),
      baseUrl,
    };
  }

  const lang = escapeAttribute(input.document?.lang ?? 'en');
  return {
    html: [
      '<!doctype html>',
      `<html lang="${lang}">`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      additions,
      '</head>',
      '<body>',
      source,
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n'),
    baseUrl,
  };
}

function buildHeadAdditions(input: PdfRenderInput, baseUrl: string | undefined): string {
  const additions: string[] = [];
  if (baseUrl) additions.push(`<base href="${escapeAttribute(baseUrl)}">`);
  if (input.document?.title && !/<title(?:\s|>)/i.test(input.html)) {
    additions.push(`<title>${escapeText(input.document.title)}</title>`);
  }
  if (input.css) {
    if (/<\/style(?:\s|\/|>)/i.test(input.css)) {
      throw new PdfError(
        'Supplemental PDF CSS cannot contain a closing style tag.',
        'PDF_INPUT_INVALID',
        { field: 'css' }
      );
    }
    additions.push(`<style data-zero-pdf>\n${input.css}\n</style>`);
  }
  return additions.join('\n');
}

function insertIntoHead(html: string, additions: string): string {
  if (!additions) return html;
  const closeHead = html.search(/<\/head\s*>/i);
  if (closeHead >= 0) return `${html.slice(0, closeHead)}${additions}\n${html.slice(closeHead)}`;

  const openHead = html.match(/<head(?:\s[^>]*)?>/i);
  if (openHead?.index !== undefined) {
    const index = openHead.index + openHead[0].length;
    return `${html.slice(0, index)}\n${additions}${html.slice(index)}`;
  }

  const openHtml = html.match(/<html(?:\s[^>]*)?>/i);
  if (openHtml?.index !== undefined) {
    const index = openHtml.index + openHtml[0].length;
    return `${html.slice(0, index)}\n<head>\n${additions}\n</head>${html.slice(index)}`;
  }

  const body = html.search(/<body(?:\s|>)/i);
  if (body >= 0) return `${html.slice(0, body)}\n<head>\n${additions}\n</head>\n${html.slice(body)}`;

  const doctype = html.match(/<!doctype\s+html[^>]*>/i);
  if (doctype?.index !== undefined) {
    const index = doctype.index + doctype[0].length;
    return `${html.slice(0, index)}\n<head>\n${additions}\n</head>${html.slice(index)}`;
  }

  return `<head>\n${additions}\n</head>\n${html}`;
}

function addMissingLanguage(html: string, language: string | undefined): string {
  if (!language || /<html\s[^>]*\blang\s*=/i.test(html)) return html;
  return html.replace(/<html(\s|>)/i, `<html lang="${escapeAttribute(language)}"$1`);
}

function isFullDocument(html: string): boolean {
  return /<!doctype\s+html/i.test(html) || /<html(?:\s|>)/i.test(html);
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    if (url.username || url.password) throw new Error('credentials are not allowed');
    return url.href;
  } catch {
    throw new PdfError('PDF baseUrl must be an HTTP(S) URL without credentials.', 'PDF_INPUT_INVALID', {
      field: 'baseUrl',
    });
  }
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
