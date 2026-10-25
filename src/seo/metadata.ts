/** One metadata resolver/serializer used by every native HTML renderer. */
import type { PageMetadata, RobotsMeta, SeoConfig, SeoDocument, SeoImage, SeoRenderContext } from './types';
import { escapeSeo, SeoError, seoSiteUrl, seoText, seoUrl, serializeSeoJson } from './validation';

/** Undefined inherits, scalar values replace, social/robot fields merge; false clears social metadata. */
export function mergePageMetadata(...layers: readonly (PageMetadata | undefined)[]): PageMetadata {
  const result: PageMetadata = {};
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(layer))) throw new SeoError('meta');
    for (const key of ['title', 'description', 'canonical', 'openGraph', 'twitter', 'robots', 'jsonLd', 'alternates'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(layer, key);
      if (descriptor?.get || descriptor?.set) throw new SeoError(key);
      const value = layer[key];
      if (value === undefined) continue;
      if (['robots', 'openGraph', 'twitter', 'alternates'].includes(key)
        && !(value === false && (key === 'openGraph' || key === 'twitter'))
        && (!value || typeof value !== 'object' || Array.isArray(value)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new SeoError(key);
      if (['robots', 'openGraph', 'twitter'].includes(key) && value && typeof value === 'object') {
        const existing = result[key];
        (result as Record<string, unknown>)[key] = { ...(existing && typeof existing === 'object' ? existing : {}), ...value };
      } else (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export function renderSeoMetadata(page: PageMetadata = {}, context: SeoRenderContext): SeoDocument {
  const defaults: SeoConfig = context.defaults || {}, meta = mergePageMetadata(defaults, page);
  for (const key of ['openGraph', 'twitter', 'robots', 'alternates'] as const) {
    const value = meta[key];
    if (value !== undefined && value !== false && (!value || typeof value !== 'object' || Array.isArray(value))) throw new SeoError(key);
  }
  const site = seoSiteUrl(context.siteUrl), parts: string[] = [];
  let title = meta.title === undefined ? undefined : seoText(meta.title, 'title');
  if (title && defaults.titleTemplate && page.title !== undefined) {
    const template = seoText(defaults.titleTemplate, 'titleTemplate');
    if (template.split('%s').length !== 2) throw new SeoError('titleTemplate');
    title = template.replace('%s', () => title!);
  }
  const description = meta.description === undefined ? undefined : seoText(meta.description, 'description');
  const tag = (name: string, value: unknown, property = false) => {
    if (value !== undefined) parts.push(`<meta ${property ? 'property' : 'name'}="${name}" content="${escapeSeo(seoText(value, name))}">`);
  };
  if (title) parts.push(`<title>${escapeSeo(title)}</title>`);
  tag('description', description);
  const canonical = meta.canonical === false ? undefined : meta.canonical !== undefined
    ? seoUrl(meta.canonical, site) : site && context.defaults !== false && context.defaults !== undefined
      ? seoUrl(new URL(context.requestUrl).pathname, site) : undefined;
  const forceNoindex = defaults.indexing === false || context.indexable === false || (context.status ?? 200) >= 400;
  const indexable = !forceNoindex && meta.robots?.index !== false;
  if (canonical && (context.status ?? 200) < 400) parts.push(`<link rel="canonical" href="${escapeSeo(canonical)}">`);
  const robots = renderRobots(meta.robots, forceNoindex);
  // Preserve legacy title/description-only output when no SEO metadata/config is supplied.
  if (meta.robots || context.defaults || !indexable) tag('robots', robots);
  if (meta.openGraph) {
    const graph = meta.openGraph;
    for (const [key, value] of Object.entries({ title: graph.title ?? title, description: graph.description ?? description,
      url: graph.url ? seoUrl(graph.url, site) : canonical, type: graph.type ?? 'website', site_name: graph.siteName, locale: graph.locale })) tag(`og:${key}`, value, true);
    renderImages(graph.images, site, (key, value) => tag(`og:image${key ? ':' + key : ''}`, value, true));
  }
  if (meta.twitter) {
    const twitter = meta.twitter, images = twitter.images ?? (meta.openGraph ? meta.openGraph.images : undefined);
    if (twitter.card !== undefined && !['summary', 'summary_large_image'].includes(twitter.card)) throw new SeoError('twitter.card');
    for (const [key, value] of Object.entries({ card: twitter.card ?? (images?.length ? 'summary_large_image' : 'summary'),
      site: twitter.site, creator: twitter.creator, title: twitter.title ?? title, description: twitter.description ?? description })) tag(`twitter:${key}`, value);
    renderImages(images, site, (key, value) => { if (key === '' || key === 'alt') tag(`twitter:image${key ? ':' + key : ''}`, value); });
  }
  if (meta.alternates) {
    if (!meta.alternates.languages || typeof meta.alternates.languages !== 'object' || Array.isArray(meta.alternates.languages)) throw new SeoError('alternates.languages');
    const languages = Object.entries(meta.alternates.languages);
    if (languages.length > 100) throw new SeoError('alternates');
    for (const [language, url] of languages) {
      if (!/^(?:x-default|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/u.test(language)) throw new SeoError('alternates.language');
      parts.push(`<link rel="alternate" hreflang="${escapeSeo(language)}" href="${escapeSeo(seoUrl(url, site))}">`);
    }
  }
  if (meta.jsonLd !== undefined) parts.push(`<script type="application/ld+json"${context.nonce ? ` nonce="${escapeSeo(seoText(context.nonce, 'nonce'))}"` : ''}>${serializeSeoJson(meta.jsonLd)}</script>`);
  const headers: Record<string, string> = {};
  if (meta.robots || context.defaults || !indexable) headers['X-Robots-Tag'] = robots;
  return { head: parts.join('\n'), ...(canonical && (context.status ?? 200) < 400 ? { canonical } : {}), robots, indexable, headers };
}

function renderImages(images: readonly (string | SeoImage)[] | undefined, site: string | undefined, emit: (key: string, value: string) => void): void {
  if (images === undefined) return;
  if (!Array.isArray(images) || images.length > 12) throw new SeoError('images');
  for (const value of images) {
    const image = typeof value === 'string' ? { url: value } : value;
    if (!image || typeof image !== 'object' || Array.isArray(image)) throw new SeoError('images');
    emit('', seoUrl(image.url, site));
    for (const key of ['alt', 'type'] as const) if (image[key] !== undefined) emit(key, seoText(image[key], `image.${key}`));
    for (const key of ['width', 'height'] as const) if (image[key] !== undefined) {
      if (!Number.isSafeInteger(image[key]) || image[key]! <= 0) throw new SeoError(`image.${key}`);
      emit(key, String(image[key]));
    }
  }
}
export function renderRobots(options: RobotsMeta = {}, forceNoindex = false): string {
  const result = [forceNoindex || options.index === false ? 'noindex' : 'index', forceNoindex || options.follow === false ? 'nofollow' : 'follow'];
  for (const key of ['index', 'follow', 'noarchive', 'nosnippet'] as const) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new SeoError(`robots.${key}`);
  for (const key of ['noarchive', 'nosnippet'] as const) if (options[key]) result.push(key);
  for (const key of ['maxSnippet', 'maxVideoPreview'] as const) if (options[key] !== undefined) {
    if (!Number.isSafeInteger(options[key]) || options[key]! < -1) throw new SeoError(`robots.${key}`);
    result.push(`${key === 'maxSnippet' ? 'max-snippet' : 'max-video-preview'}:${options[key]}`);
  }
  if (options.maxImagePreview !== undefined) {
    if (!['none', 'standard', 'large'].includes(options.maxImagePreview)) throw new SeoError('robots.maxImagePreview');
    result.push(`max-image-preview:${options.maxImagePreview}`);
  }
  return result.join(', ');
}
