import type { RouteNode, MatchResult } from './types';

// ─── URL Matcher ───────────────────────────────────────────────────────────

/**
 * Match a URL pathname against the route tree.
 *
 * Resolution order per segment:
 * 1. Exact static match
 * 2. Dynamic segment ([id])
 * 3. Catch-all ([...path])
 *
 * Collects layouts from root → leaf for nested rendering.
 * Builds a pattern string (e.g., '/posts/[id]') for client manifest lookup.
 *
 * @param root - The route tree root
 * @param pathname - URL pathname (e.g., '/about', '/posts/123')
 * @returns MatchResult with pattern, params, layouts, page/API paths
 */
export function matchRoute(root: RouteNode, pathname: string): MatchResult {
  const segments = pathname === '/'
    ? []
    : pathname.replace(/^\/|\/$/g, '').split('/');

  const params: Record<string, string> = {};
  const layouts: string[] = [];
  const patternSegments: string[] = [];
  let notFoundPath: string | undefined;

  // Always collect root layout
  if (root.layoutPath) layouts.push(root.layoutPath);
  if (root.notFoundPath) notFoundPath = root.notFoundPath;

  let current = root;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    let matched: RouteNode | undefined;

    // 1. Exact static match
    matched = current.children.get(segment);

    // 2. Dynamic segment — check all children for [param]
    if (!matched) {
      for (const child of current.children.values()) {
        if (child.isDynamic && !child.isCatchAll) {
          matched = child;
          params[child.paramName!] = segment;
          break;
        }
      }
    }

    // 3. Catch-all — consumes rest of URL
    if (!matched) {
      for (const child of current.children.values()) {
        if (child.isCatchAll) {
          matched = child;
          params[child.paramName!] = segments.slice(i).join('/');
          // Collect layout + return immediately (catch-all consumes everything)
          if (matched.layoutPath) layouts.push(matched.layoutPath);
          if (matched.notFoundPath) notFoundPath = matched.notFoundPath;
          patternSegments.push(matched.segment);
          return {
            pattern: '/' + patternSegments.join('/'),
            params,
            layouts,
            pagePath: matched.pagePath ?? null,
            notFoundPath,
            apiRoutePath: matched.apiRoutePath ?? null,
          };
        }
      }
    }

    if (!matched) {
      // No match — 404
      return {
        pattern: '/' + patternSegments.join('/'),
        params,
        layouts,
        pagePath: null,
        notFoundPath,
        apiRoutePath: null,
      };
    }

    patternSegments.push(matched.segment);
    current = matched;

    // Collect layout at each level
    if (current.layoutPath) layouts.push(current.layoutPath);
    if (current.notFoundPath) notFoundPath = current.notFoundPath;
  }

  return {
    pattern: patternSegments.length > 0 ? '/' + patternSegments.join('/') : '/',
    params,
    layouts,
    pagePath: current.pagePath ?? null,
    notFoundPath,
    apiRoutePath: current.apiRoutePath ?? null,
  };
}
