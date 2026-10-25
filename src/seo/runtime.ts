/** App-local metadata policy and live, explicitly published plugin sitemap contributions. */
import type { SitemapEntry } from '../frontend/server/types';
import type { PageMetadata, SeoConfig, SeoDocument } from './types';
import { mergePageMetadata, renderSeoMetadata } from './metadata';
import { SeoError, seoSiteUrl, seoText, seoUrl } from './validation';

export type SeoSitemapProvider = () => readonly SitemapEntry[] | Promise<readonly SitemapEntry[]>;
export interface SeoRuntime {
  readonly defaults: SeoConfig | false;
  readonly siteUrl: string | undefined;
  readonly indexingEnabled: boolean;
  render(meta: PageMetadata | undefined, request: Request, options?: { nonce?: string; status?: number; indexable?: boolean }): SeoDocument;
  /** Registered providers must return only deliberately public, currently admitted pages. */
  registerSitemap(name: string, provider: SeoSitemapProvider): () => void;
  sitemapEntries(): Promise<readonly SitemapEntry[]>;
  robotsTxt(sitemapPath?: string): string;
}

export function resolveSeoConfig(input: SeoConfig | false | undefined, siteUrl?: string): SeoConfig | false {
  if (input === false || input === undefined) return false;
  const allowed = ['title', 'description', 'canonical', 'openGraph', 'twitter', 'robots', 'jsonLd', 'alternates', 'titleTemplate', 'indexing', 'robotsTxt'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new SeoError('config');
  if (input.indexing !== undefined && typeof input.indexing !== 'boolean') throw new SeoError('indexing');
  if (input.robotsTxt !== undefined && typeof input.robotsTxt !== 'boolean'
    && (!input.robotsTxt || typeof input.robotsTxt !== 'object' || Array.isArray(input.robotsTxt))) throw new SeoError('robotsTxt');
  if (input.titleTemplate !== undefined && (typeof input.titleTemplate !== 'string' || input.titleTemplate.split('%s').length !== 2)) throw new SeoError('titleTemplate');
  mergePageMetadata(input);
  let result: SeoConfig;
  try { result = structuredClone({ ...input, openGraph: input.openGraph ?? {}, twitter: input.twitter ?? {}, robotsTxt: input.robotsTxt ?? true }); }
  catch { throw new SeoError('config'); }
  renderSeoMetadata({}, { requestUrl: 'https://zero.example/', siteUrl, defaults: result });
  renderRobotsTxt(result, siteUrl);
  return freeze(result);
}

export function createSeoRuntime(defaults: SeoConfig | false, publicUrl?: string): SeoRuntime {
  let siteUrl: string | undefined;
  try { siteUrl = seoSiteUrl(publicUrl); } catch (error) { if (defaults !== false) throw error; }
  const providers = new Map<string, SeoSitemapProvider>();
  const runtime: SeoRuntime = { defaults, siteUrl, indexingEnabled: !defaults || defaults.indexing !== false,
    render(meta, request, options = {}) { return renderSeoMetadata(meta, { requestUrl: request.url, siteUrl, defaults, ...options }); },
    registerSitemap(name, provider) {
      if (providers.has(name) || typeof provider !== 'function') throw new SeoError('sitemap.provider');
      providers.set(name, provider);
      return () => { if (providers.get(name) === provider) providers.delete(name); };
    },
    async sitemapEntries() {
      if (defaults && defaults.indexing === false) return [];
      const results = await Promise.all([...providers.values()].map(provider => provider()));
      if (results.some(entries => !Array.isArray(entries) || entries.length > 50000)
        || results.reduce((count, entries) => count + entries.length, 0) > 50000) throw new SeoError('sitemap.entries');
      return results.flat();
    },
    robotsTxt(sitemapPath) { return renderRobotsTxt(defaults, siteUrl, sitemapPath); },
  };
  return Object.freeze(runtime);
}

export function renderRobotsTxt(config: SeoConfig | false, siteUrl?: string, sitemapPath?: string): string {
  const explicit = config && typeof config.robotsTxt === 'object' ? config.robotsTxt : {};
  if (config && config.robotsTxt !== undefined && typeof config.robotsTxt !== 'boolean'
    && (!config.robotsTxt || Array.isArray(config.robotsTxt) || typeof config.robotsTxt !== 'object')) throw new SeoError('robotsTxt');
  const rules = explicit.rules ?? [{ userAgent: '*', allow: '/' }];
  if (!Array.isArray(rules) || rules.length > 100) throw new SeoError('robotsTxt.rules');
  const list = (input: string | readonly string[] | undefined, field: string): string[] => {
    if (input === undefined) return [];
    const values = typeof input === 'string' ? [input] : input;
    if (!Array.isArray(values) || values.length > 100) throw new SeoError(field);
    return values.map(value => seoText(value, field, 2048));
  };
  const lines: string[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new SeoError('robotsTxt.rules');
    const agents = list(rule.userAgent, 'robotsTxt.userAgent');
    if (!agents.length || agents.some(agent => !agent || /\s/u.test(agent))) throw new SeoError('robotsTxt.userAgent');
    for (const agent of agents) lines.push(`User-agent: ${agent}`);
    for (const [key, label] of [['allow', 'Allow'], ['disallow', 'Disallow']] as const) for (const path of list(rule[key], `robotsTxt.${key}`)) {
      if (path && !path.startsWith('/')) throw new SeoError(`robotsTxt.${key}`);
      lines.push(`${label}: ${path}`);
    }
    lines.push('');
  }
  const maps = explicit.sitemaps ?? [];
  if (!Array.isArray(maps) || maps.length > 100) throw new SeoError('robotsTxt.sitemaps');
  const sitemapUrls = [...maps.map(value => seoUrl(value, siteUrl)), ...(siteUrl && sitemapPath && (!config || config.indexing !== false) ? [seoUrl(sitemapPath, siteUrl)] : [])];
  for (const url of new Set(sitemapUrls)) lines.push(`Sitemap: ${url}`);
  return lines.join('\n') + '\n';
}

function freeze<T>(value: T, ancestors = new Set<object>(), depth = 0): T {
  if (value && typeof value === 'object') {
    if (depth > 32 || ancestors.has(value)) throw new SeoError('config');
    ancestors.add(value);
    try { Object.freeze(value); for (const child of Object.values(value)) freeze(child, ancestors, depth + 1); }
    finally { ancestors.delete(value); }
  }
  return value;
}
