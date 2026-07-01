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
import type { ResolvedSitemapConfig, SitemapEntry } from './types';

/** Options required to generate a sitemap for the current request. */
export interface GenerateSitemapXmlOptions {
  routeTree: RouteNode;
  config: ResolvedSitemapConfig;
  requestUrl: string;
  publicUrl?: string;
  routeAuth: RouteAuthMode;
  publicPaths: readonly string[];
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
}

type RouteConfigCache = Map<string, Promise<RouteConfig | undefined>>;

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
  const excluded = createExcludeMatcher(options.config.exclude);
  const entries = new Map<string, SitemapEntry>();

  for (const candidate of candidates) {
    if (excluded(candidate.href)) continue;
    if (await shouldIncludeRouteCandidate(candidate, options, configCache)) {
      entries.set(candidate.href, { href: candidate.href });
    }
  }

  for (const manualEntry of options.config.entries) {
    const href = normalizeHref(manualEntry.href);
    if (excluded(href)) continue;
    entries.set(href, { ...manualEntry, href });
  }

  return [...entries.values()].sort((a, b) => a.href.localeCompare(b.href));
}

/** Render an XML response body for sitemap consumers and crawlers. */
export function renderSitemapXml(
  entries: readonly SitemapEntry[],
  config: ResolvedSitemapConfig,
  baseUrl: string,
): string {
  const urls = entries.map((entry) => renderUrlEntry(entry, config, baseUrl)).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ]
    .filter(Boolean)
    .join('\n');
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

async function shouldIncludeRouteCandidate(
  candidate: SitemapRouteCandidate,
  options: GenerateSitemapXmlOptions,
  configCache: RouteConfigCache,
): Promise<boolean> {
  const configs = await Promise.all(
    [...candidate.layoutPaths, candidate.pagePath].map((filePath) =>
      loadRouteConfig(filePath, configCache)
    )
  );
  const routeRequirement = mergeRouteAuthRequirements(
    configs.map((config) => config?.auth as RouteAuthRequirement),
  );

  return !shouldRequireAuthForRoute({
    routeAuth: options.routeAuth,
    pathname: candidate.href,
    publicPaths: options.publicPaths,
    routeRequirement,
  });
}

function loadRouteConfig(
  filePath: string,
  cache: RouteConfigCache,
): Promise<RouteConfig | undefined> {
  const existing = cache.get(filePath);
  if (existing) return existing;

  const promise = import(pathToFileURL(filePath).href)
    .then((module) => (module as { config?: RouteConfig }).config)
    .catch(() => ({ auth: true }));
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
  if (isAbsoluteUrl(href)) return href;
  const path = href.startsWith('/') ? href : `/${href}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function createExcludeMatcher(patterns: readonly string[]): (href: string) => boolean {
  const normalized = patterns.map(normalizeHref);
  return (href) => normalized.some((pattern) =>
    href === pattern || (!isAbsoluteUrl(href) && href.startsWith(`${pattern}/`))
  );
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
  if (isAbsoluteUrl(href)) return href;
  return `${baseUrl}${href === '/' ? '/' : href}`;
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
