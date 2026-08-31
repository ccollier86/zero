/**
 * pdf-content-policy.ts
 *
 * Builds and injects the renderer CSP that enforces inline resource switches
 * before Chromium parses document markup. HTTP(S) policy remains owned by the
 * request interceptor so exact origins and private-network rules still apply.
 */

import type { ResolvedPdfResourcePolicy } from './pdf-types';

/** Inject Zero's renderer CSP as the first element in the document head. */
export function applyPdfContentPolicy(
  html: string,
  baseUrl: string | undefined,
  resources: ResolvedPdfResourcePolicy,
  javaScriptEnabled: boolean
): string {
  const content = buildPdfContentSecurityPolicy(baseUrl, resources, javaScriptEnabled);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(content)}">`;
  const openHead = html.match(/<head(?:\s[^>]*)?>/i);
  if (openHead?.index !== undefined) {
    const index = openHead.index + openHead[0].length;
    return `${html.slice(0, index)}\n${meta}${html.slice(index)}`;
  }

  const openHtml = html.match(/<html(?:\s[^>]*)?>/i);
  if (openHtml?.index !== undefined) {
    const index = openHtml.index + openHtml[0].length;
    return `${html.slice(0, index)}\n<head>\n${meta}\n</head>${html.slice(index)}`;
  }

  const doctype = html.match(/<!doctype\s+html[^>]*>/i);
  if (doctype?.index !== undefined) {
    const index = doctype.index + doctype[0].length;
    return `${html.slice(0, index)}\n<head>\n${meta}\n</head>${html.slice(index)}`;
  }

  return `<head>\n${meta}\n</head>\n${html}`;
}

/** Build a restrictive CSP while leaving HTTP(S) decisions to route policy. */
export function buildPdfContentSecurityPolicy(
  baseUrl: string | undefined,
  resources: ResolvedPdfResourcePolicy,
  javaScriptEnabled: boolean
): string {
  const sources = ['http:', 'https:'];
  if (resources.allowDataUrls) sources.push('data:');
  if (resources.allowBlobUrls) sources.push('blob:');
  const resourceSources = sources.join(' ');
  const baseSource = baseUrl ? new URL(baseUrl).origin : "'none'";
  const scriptSources = javaScriptEnabled
    ? `'unsafe-inline' ${resourceSources}`
    : "'none'";

  return [
    `default-src ${resourceSources}`,
    `img-src ${resourceSources}`,
    `font-src ${resourceSources}`,
    `media-src ${resourceSources}`,
    `style-src 'unsafe-inline' ${resourceSources}`,
    `script-src ${scriptSources}`,
    `connect-src ${resourceSources}`,
    `frame-src ${resourceSources}`,
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    `base-uri ${baseSource}`,
  ].join('; ');
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
