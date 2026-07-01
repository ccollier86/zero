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
  let notFoundPath: string | undefined;

  // Always collect root layout
  if (root.layoutPath) layouts.push(root.layoutPath);
  if (root.notFoundPath) notFoundPath = root.notFoundPath;

  const result = matchFromNode({
    node: root,
    segments,
    index: 0,
    params,
    layouts,
    patternSegments: [],
    notFoundPath,
  });

  if (result) return result;

  return {
    pattern: '/',
    params,
    layouts,
    pagePath: null,
    notFoundPath,
    apiRoutePath: null,
  };
}

interface MatchTraversalState {
  node: RouteNode;
  segments: string[];
  index: number;
  params: Record<string, string>;
  layouts: string[];
  patternSegments: string[];
  notFoundPath?: string;
}

function matchFromNode(state: MatchTraversalState): MatchResult | null {
  const notFoundPath = state.node.notFoundPath ?? state.notFoundPath;

  if (state.index >= state.segments.length) {
    if (state.node.pagePath || state.node.apiRoutePath) {
      return {
        pattern: formatPattern(state.patternSegments),
        params: state.params,
        layouts: state.layouts,
        pagePath: state.node.pagePath ?? null,
        notFoundPath,
        apiRoutePath: state.node.apiRoutePath ?? null,
      };
    }

    return matchGroupChildren({ ...state, notFoundPath });
  }

  const segment = state.segments[state.index]!;

  // 1. Exact static match
  const exact = state.node.children.get(segment);
  if (exact && !exact.isGroup) {
    const matched = descendIntoChild(state, exact, {
      index: state.index + 1,
      patternSegments: [...state.patternSegments, exact.segment],
      notFoundPath,
    });
    if (matched) return matched;
  }

  // 2. Dynamic segment — check all non-group children for [param]
  for (const child of state.node.children.values()) {
    if (child.isGroup || !child.isDynamic || child.isCatchAll) continue;

    const matched = descendIntoChild(
      { ...state, params: { ...state.params, [child.paramName!]: segment } },
      child,
      {
        index: state.index + 1,
        patternSegments: [...state.patternSegments, child.segment],
        notFoundPath,
      },
    );
    if (matched) return matched;
  }

  // 3. Catch-all — consumes the rest of the URL
  for (const child of state.node.children.values()) {
    if (child.isGroup || !child.isCatchAll) continue;

    const matched = descendIntoChild(
      {
        ...state,
        params: {
          ...state.params,
          [child.paramName!]: state.segments.slice(state.index).join('/'),
        },
      },
      child,
      {
        index: state.segments.length,
        patternSegments: [...state.patternSegments, child.segment],
        notFoundPath,
      },
    );
    if (matched) return matched;
  }

  return matchGroupChildren({ ...state, notFoundPath });
}

function descendIntoChild(
  state: MatchTraversalState,
  child: RouteNode,
  next: Pick<MatchTraversalState, 'index' | 'patternSegments' | 'notFoundPath'>,
): MatchResult | null {
  return matchFromNode({
    ...state,
    node: child,
    index: next.index,
    layouts: child.layoutPath ? [...state.layouts, child.layoutPath] : state.layouts,
    patternSegments: next.patternSegments,
    notFoundPath: next.notFoundPath,
  });
}

function matchGroupChildren(state: MatchTraversalState): MatchResult | null {
  for (const child of state.node.children.values()) {
    if (!child.isGroup) continue;

    const matched = descendIntoChild(state, child, {
      index: state.index,
      patternSegments: state.patternSegments,
      notFoundPath: state.notFoundPath,
    });
    if (matched) return matched;
  }

  return null;
}

function formatPattern(patternSegments: string[]): string {
  return patternSegments.length > 0 ? '/' + patternSegments.join('/') : '/';
}
