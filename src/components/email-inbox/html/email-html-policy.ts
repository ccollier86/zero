/** Email-only presentation policy. This never grants trust to sender HTML. */
export const EMAIL_HTML_POLICY_VERSION = '1';
export const EMAIL_HTML_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, nodes: 25_000, depth: 128,
  cssBytes: 256 * 1024, rules: 4_000, resources: 100, imageBytes: 5 * 1024 * 1024, imagePixels: 40_000_000 });

export class EmailHtmlError extends Error {
  constructor(message: string) { super(message); this.name = 'EmailHtmlError'; }
}

export const EMAIL_HTML_TAGS = new Set(('a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup '
  + 'dd del details div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark '
  + 'ol p pre q s samp section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul wbr').split(' '));
export const EMAIL_HTML_DROP = new Set(('script noscript template iframe frame frameset object embed applet svg math '
  + 'form input button select option textarea link meta base audio video source track canvas picture style title').split(' '));
export const EMAIL_HTML_ATTRIBUTES = new Set(('class id title lang dir align valign bgcolor border cellpadding cellspacing '
  + 'colspan rowspan span width height color face size start type reversed scope headers datetime cite open abbr').split(' '));

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** No relative URLs, credentials, executable schemes or application-local resource requests. */
export function emailUrl(value: string, kind: 'link' | 'image', appOrigin?: string): string | null {
  if (value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (kind === 'link' && /^#[\w.:-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (kind === 'link' && url.protocol === 'mailto:') return url.href;
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (kind === 'image') {
      const host = url.hostname.toLowerCase();
      // No loopback, link-local, private-name or literal-IP fetch surfaces, even after image consent.
      if (host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) || host === 'localhost' || /\.(?:localhost|local|internal)$/.test(host)) return null;
      if (appOrigin && host === new URL(appOrigin).hostname.toLowerCase()) return null;
    }
    return url.href;
  } catch { return null; }
}

export function normalizedContentId(value: string): string {
  try { return decodeURIComponent(value.replace(/^cid:/i, '')).trim().replace(/^<|>$/g, ''); }
  catch { return ''; }
}
