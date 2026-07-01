import type { RouteNode } from './types';
import type { ScannedFile } from './scanner';

// ─── Route Tree Builder ────────────────────────────────────────────────────

/**
 * Create a new empty route node.
 */
function createNode(segment: string): RouteNode {
  const isGroup = segment.startsWith('(') && segment.endsWith(')');
  const isDynamic = !isGroup && segment.startsWith('[') && segment.endsWith(']');
  const isCatchAll = isDynamic && segment.startsWith('[...');

  let paramName: string | undefined;
  if (isCatchAll) {
    paramName = segment.slice(4, -1); // [...path] → 'path'
  } else if (isDynamic) {
    paramName = segment.slice(1, -1); // [id] → 'id'
  }

  return {
    segment,
    children: new Map(),
    isGroup,
    isDynamic,
    paramName,
    isCatchAll,
  };
}

/**
 * Build a route tree from scanned files.
 *
 * The tree root represents '/' — its children are top-level segments.
 * Each node can have a page, layout, not-found, and/or API route.
 *
 * @param files - Output from scanRoutes()
 * @returns The root RouteNode
 */
export function buildRouteTree(files: ScannedFile[]): RouteNode {
  const root = createNode('');

  for (const file of files) {
    // Walk/create path through tree
    let current = root;

    for (const segment of file.segments) {
      if (!current.children.has(segment)) {
        current.children.set(segment, createNode(segment));
      }
      current = current.children.get(segment)!;
    }

    // Attach file to the terminal node
    switch (file.kind) {
      case 'page':
        current.pagePath = file.absolutePath;
        break;
      case 'layout':
        current.layoutPath = file.absolutePath;
        break;
      case 'not-found':
        current.notFoundPath = file.absolutePath;
        break;
      case 'route':
        current.apiRoutePath = file.absolutePath;
        break;
    }
  }

  return root;
}

// ─── Debug ─────────────────────────────────────────────────────────────────

/** Format the route tree for debug or CLI presentation. */
export function formatRouteTree(node: RouteNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const segment = node.segment || '/';
  const flags = [
    node.pagePath ? 'page' : '',
    node.layoutPath ? 'layout' : '',
    node.apiRoutePath ? 'api' : '',
    node.notFoundPath ? '404' : '',
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [`${indent}${segment}${flags ? ` [${flags}]` : ''}`];

  // Sort children: static first, then dynamic, then catch-all
  const sorted = [...node.children.values()].sort((a, b) => {
    if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1;
    if (a.isDynamic !== b.isDynamic) return a.isDynamic ? 1 : -1;
    return a.segment.localeCompare(b.segment);
  });

  for (const child of sorted) {
    lines.push(formatRouteTree(child, depth + 1));
  }

  return lines.join('\n');
}

/** Return a formatted route tree string for debug callers. */
export function printRouteTree(node: RouteNode, depth = 0): string {
  return formatRouteTree(node, depth);
}
