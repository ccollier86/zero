/** Server-owned static route patterns only. Dynamic values, URLs, query strings and page contents are never retained. */
import type { RouteNode } from '../frontend/router/types';
import { loggingDigest } from './logging-hash';
export function loggingPagePatterns(root: RouteNode): readonly string[] {
  const patterns: string[] = [];
  const walk = (node: RouteNode, parent: string[]) => {
    const segments = node.isGroup || !node.segment ? parent : [...parent, node.segment];
    if (node.pagePath) patterns.push('/' + segments.join('/'));
    for (const child of node.children.values()) walk(child, segments);
  };
  walk(root, []); return Object.freeze(patterns);
}
export function loggingPageDescriptor(pattern: string, label?: string): Readonly<{ id: string; label: string }> {
  const segments = pattern.split('/').filter(segment => segment && !['app', 'dashboard'].includes(segment));
  const fallback = segments.map(segment => segment.startsWith('[') ? 'Record' : segment.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())).join(' · ') || 'Home';
  return Object.freeze({ id: 'page:' + loggingDigest(pattern), label: label ?? fallback.slice(0, 120) });
}
