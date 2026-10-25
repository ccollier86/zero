/**
 * sitemap.ts
 *
 * Generates sitemap.xml from Zero's file-router tree. This file owns sitemap
 * discovery and XML rendering only; router-plugin.ts owns HTTP mounting.
 */

import { pathToFileURL } from 'node:url';
import {
  mergeRouteAuthRequirements,
  shouldRequireAuthForRoute,
  type RouteAuthMode,
  type RouteAuthRequirement,
} from '../router/auth-policy';
import type { RouteConfig, RouteNode } from '../router/types';
import type { RouteModule } from '../router/types';
import { matchRoute } from '../router/matcher';
import { mergePageMetadata, renderSeoMetadata, SeoError } from '../../seo';
import { seoUrl } from '../../seo/validation';
import type { SeoRuntime } from '../../seo/runtime';
import type { ResolvedSitemapConfig, SitemapEntry } from './types';

/** Options required to generate a sitemap for the current request. */
export interface GenerateSitemapXmlOptions {
  routeTree: RouteNode;
  config: ResolvedSitemapConfig;
  requestUrl: string;
  publicUrl?: string;
  routeAuth: RouteAuthMode;
  publicPaths: readonly string[];
  seo?: SeoRuntime;
  additionalEntries?: readonly SitemapEntry[];
}

interface RouteWalkState {
  segments: string[];
  layouts: string[];
  hasDynamicSegment: boolean;
}

interface SitemapRouteCandidate {
  href: string;
  layoutPaths: string[];
  pagePath: string;
  params?: Record<string, string>;
}

type RouteConfigCache = Map<string, Promise<(RouteModule & { config?: RouteConfig }) | undefined>>;

/**
 * Generate sitemap XML for public static page routes plus explicit config
 * entries. Dynamic routes are intentionally manual because route params cannot
 * be discovered safely from the file tree.
 */
export async function generateSitemapXml(options: GenerateSitemapXmlOptions): Promise<string> {
  const entries = await collectSitemapEntries(options);
  const baseUrl = getBaseUrl(options.publicUrl, options.requestUrl);

  return renderSitemapXml(entries, options.config, baseUrl);
}

/** Return sitemap entries after route discovery, filtering, and overrides. */
export async function collectSitemapEntries(
  options: GenerateSitemapXmlOptions,
): Promise<SitemapEntry[]> {
  const configCache: RouteConfigCache = new Map();
  const candidates = collectRouteCandidates(options.routeTree, {
    segments: [],
    layouts: [],
    hasDynamicSegment: false,
  });
  const base = getBaseUrl(options.publicUrl, options.requestUrl);
  const excluded = createExcludeMatcher(options.config.exclude, base);
  const entries = new Map<string, SitemapEntry>();
  if (options.seo?.indexingEnabled === false) return [];
  const add = (entry: SitemapEntry) => {
    if (excluded(entry.href)) return;
    const absolute = seoUrl(entry.href, base);
    // A canonical on another host belongs in that host's sitemap, never this one.
    if (new URL(absolute).origin !== new URL(base).origin) return;
    entries.set(absolute, entry);
    if (entries.size > 50000) throw new SeoError('sitemap.entries');
  };

  for (const candidate of candidates) {
    if (excluded(candidate.href)) continue;
    const entry = await resolveRouteCandidate(candidate, options, configCache);
    if (entry) add(entry);
  }

  for (const manualEntry of [...(options.additionalEntries ?? []), ...options.config.entries]) {
    const href = normalizeHref(manualEntry.href);
    if (excluded(href)) continue;
    const route = matchRoute(options.routeTree, sitemapPath(href, base));
    if (route.apiRoutePath && !route.pagePath) continue;
    if (route.pagePath) {
      const entry = await resolveRouteCandidate({ href, pagePath: route.pagePath, layoutPaths: route.layouts, params: route.params }, options, configCache);
      if (entry) add({ ...manualEntry, href: entry.href });
    } else add({ ...manualEntry, href });
  }

  return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
}

/** Render an XML response body for sitemap consumers and crawlers. */
export function renderSitemapXml(
  entries: readonly SitemapEntry[],
  config: ResolvedSitemapConfig,
  baseUrl: string,
): string {
  if (entries.length > 50000) throw new SeoError('sitemap.entries');
  for (const entry of entries) if (new URL(seoUrl(entry.href, baseUrl)).origin !== new URL(baseUrl).origin) throw new SeoError('sitemap.origin');
  const urls = entries.map((entry) => renderUrlEntry(entry, config, baseUrl)).join('\n');
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ]
    .filter(Boolean)
    .join('\n');
  if (new TextEncoder().encode(xml).byteLength > 50 * 1024 * 1024) throw new SeoError('sitemap.bytes');
  return xml;
}

function collectRouteCandidates(node: RouteNode, state: RouteWalkState): SitemapRouteCandidate[] {
  const nextLayouts = node.layoutPath ? [...state.layouts, node.layoutPath] : state.layouts;
  const candidates: SitemapRouteCandidate[] = [];

  if (node.pagePath && !state.hasDynamicSegment) {
    candidates.push({
      href: routeSegmentsToPath(state.segments),
      layoutPaths: nextLayouts,
      pagePath: node.pagePath,
    });
  }

  for (const child of getSortedChildren(node)) {
    const childSegments = child.isGroup ? state.segments : [...state.segments, child.segment];
    const childHasDynamic = state.hasDynamicSegment || child.isDynamic || child.isCatchAll;
    candidates.push(...collectRouteCandidates(child, {
      segments: childSegments,
      layouts: nextLayouts,
      hasDynamicSegment: childHasDynamic,
    }));
  }

  return candidates;
}

async function resolveRouteCandidate(
  candidate: SitemapRouteCandidate,
  options: GenerateSitemapXmlOptions,
  configCache: RouteConfigCache,
): Promise<SitemapEntry | null> {
  const modules = await Promise.all(
    [...candidate.layoutPaths, candidate.pagePath].map((filePath) =>
      loadRouteConfig(filePath, configCache)
    )
  );
  const routeRequirement = mergeRouteAuthRequirements(
    modules.map((module) => module?.config?.auth as RouteAuthRequirement),
  );

  if (modules.some(module => !module) || shouldRequireAuthForRoute({
    routeAuth: options.routeAuth,
    pathname: sitemapPath(candidate.href, getBaseUrl(options.publicUrl, options.requestUrl)),
    publicPaths: options.publicPaths,
    routeRequirement,
  })) return null;
  // Metadata is evaluated without running page loaders or request/data services.
  const meta = mergePageMetadata(...await Promise.all(modules.map(module => typeof module?.meta === 'function'
    ? module.meta(candidate.params ?? {}) : module?.meta)));
  const base = getBaseUrl(options.publicUrl, options.requestUrl);
  const result = renderSeoMetadata(meta, { requestUrl: new URL(sitemapPath(candidate.href, base), options.requestUrl).href,
    siteUrl: options.publicUrl, defaults: options.seo?.defaults });
  return result.indexable ? { href: result.canonical ?? candidate.href } : null;
}

function loadRouteConfig(
  filePath: string,
  cache: RouteConfigCache,
): Promise<(RouteModule & { config?: RouteConfig }) | undefined> {
  const existing = cache.get(filePath);
  if (existing) return existing;

  const promise = import(pathToFileURL(filePath).href)
    .then((module) => module as RouteModule & { config?: RouteConfig })
    .catch(() => undefined);
  cache.set(filePath, promise);
  return promise;
}

function getSortedChildren(node: RouteNode): RouteNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
    if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1;
    if (a.isDynamic !== b.isDynamic) return a.isDynamic ? 1 : -1;
    return a.segment.localeCompare(b.segment);
  });
}

function routeSegmentsToPath(segments: readonly string[]): string {
  if (segments.length === 0) return '/';
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

function normalizeHref(href: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(href) && !isAbsoluteUrl(href)) throw new SeoError('sitemap.href');
  if (isAbsoluteUrl(href)) return href;
  const path = href.startsWith('/') ? href : `/${href}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function createExcludeMatcher(patterns: readonly string[], base: string): (href: string) => boolean {
  const normalized = patterns.map(pattern => ({ origin: new URL(seoUrl(normalizeHref(pattern), base)).origin, path: sitemapPath(pattern, base) }));
  return href => {
    const origin = new URL(seoUrl(href, base)).origin, path = sitemapPath(href, base);
    return normalized.some(pattern => pattern.origin === origin && (path === pattern.path || pattern.path === '/' || path.startsWith(pattern.path + '/')));
  };
}

/** Absolute entries include the deployment prefix; file-router matching does not. */
function sitemapPath(href: string, base: string): string {
  const pathname = new URL(seoUrl(normalizeHref(href), base)).pathname;
  const prefix = new URL(base).pathname.replace(/\/+$/, '');
  return prefix && (pathname === prefix || pathname.startsWith(prefix + '/')) ? pathname.slice(prefix.length) || '/' : pathname;
}

function getBaseUrl(publicUrl: string | undefined, requestUrl: string): string {
  const source = publicUrl || new URL(requestUrl).origin;
  return source.replace(/\/+$/, '');
}

function renderUrlEntry(
  entry: SitemapEntry,
  config: ResolvedSitemapConfig,
  baseUrl: string,
): string {
  const lastmod = formatLastmod(entry.lastmod);
  const changefreq = entry.changefreq ?? config.changefreq;
  const priority = formatPriority(entry.priority ?? config.priority);
  const lines = [
    '  <url>',
    `    <loc>${escapeXml(toAbsoluteUrl(entry.href, baseUrl))}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : '',
    priority ? `    <priority>${priority}</priority>` : '',
    '  </url>',
  ].filter(Boolean);

  return lines.join('\n');
}

function toAbsoluteUrl(href: string, baseUrl: string): string {
  return seoUrl(href, baseUrl);
}

function formatLastmod(value: SitemapEntry['lastmod']): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function formatPriority(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isAbsoluteUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
