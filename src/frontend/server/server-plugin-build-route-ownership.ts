/** Reject declarative page-mount collisions before content compilation or runtime setup. */
import { existsSync } from 'node:fs';
import { scanRoutes } from '../router/scanner';
import { buildRouteTree } from '../router/route-tree';
import type { RouteNode } from '../router/types';
import type { ZeroPluginDefinition } from './server-extensions';
import { AppPluginBuildError } from './server-plugin-build-error';

/** Core namespaces that content page mounts must not reinterpret as documentation. */
export const RESERVED_APP_ROUTE_PREFIXES: readonly string[] = Object.freeze(['/_build', '/api', '/auth', '/sync', '/storage', '/workflows', '/rooms', '/notifications', '/scheduler', '/.well-known']);

/** Check a canonical route against the same reserved namespace registry used by build admission. */
export function isReservedAppRoutePath(path: string): boolean {
  let logicalPath: string;
  try { logicalPath = '/' + decodeMountSegments(path.replace(/\/+$/, '') || '/').join('/'); } catch { return true; }
  return RESERVED_APP_ROUTE_PREFIXES.some((reserved) => logicalPath === reserved || logicalPath.startsWith(`${reserved}/`));
}

/** Validate mount prefixes against other declarations and actual file-page/API ownership. */
export function assertPluginBuildRouteOwnership(appDir: string, contributors: readonly ZeroPluginDefinition[]): void {
  const patterns = existsSync(appDir) ? collectPatterns(buildRouteTree(scanRoutes(appDir))) : [];
  const claimed: Array<{ owner: string; path: string }> = [];
  for (const plugin of contributors) {
    for (const raw of plugin.build?.mountPaths ?? []) {
      const path = normalizeMount(raw);
      if (path !== '/' && RESERVED_APP_ROUTE_PREFIXES.some((reserved) => overlaps(path, reserved))) throw invalid(`Plugin "${plugin.name}" cannot claim a reserved platform/API path.`);
      if (claimed.some((claim) => overlaps(path, claim.path))) throw invalid(`Plugin "${plugin.name}" page mount overlaps another plugin's mount.`);
      if (patterns.some((pattern) => patternIntersectsMount(pattern, path))) throw invalid(`Plugin "${plugin.name}" page mount conflicts with an application page or file API route.`);
      claimed.push({ owner: plugin.name, path });
    }
  }
}

function normalizeMount(path: string): string {
  if (typeof path !== 'string') throw invalid('Plugin page mount must be a canonical absolute URL prefix.');
  const normalized = path.replace(/\/+$/, '') || '/';
  const segments = decodeMountSegments(normalized);
  const canonical = '/' + segments.map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
  if (normalized !== canonical) throw invalid('Plugin page mount must use a canonical encoded absolute URL prefix.');
  return canonical;
}

/** Decode exactly once; encoded separators/traversal cannot change route ownership. */
function decodeMountSegments(path: string): string[] {
  if (typeof path !== 'string' || !path.startsWith('/') || /[?#\\\x00-\x20\x7f]/.test(path) || path.includes('//')) throw invalid('Plugin page mount must be a canonical absolute URL prefix.');
  if (path === '/') return [];
  return path.slice(1).split('/').map((part) => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw invalid('Plugin page mount encoding is invalid.'); }
    if (!decoded || decoded === '.' || decoded === '..' || /[/\\\x00-\x1f\x7f]/.test(decoded)) throw invalid('Plugin page mount contains an unsafe encoded segment.');
    return decoded;
  });
}
function overlaps(left: string, right: string): boolean { return left === '/' || right === '/' || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`); }

function collectPatterns(tree: RouteNode): readonly string[][] {
  const patterns: string[][] = [];
  function walk(node: RouteNode, parent: string[]): void {
    const segments = node.isGroup || !node.segment ? parent : [...parent, node.segment];
    if (node.pagePath || node.apiRoutePath) patterns.push(segments);
    for (const child of node.children.values()) walk(child, segments);
  }
  walk(tree, []);
  return patterns;
}

function patternIntersectsMount(pattern: readonly string[], mount: string): boolean {
  const segments = decodeMountSegments(mount);
  if (segments.length === 0) return true;
  for (let index = 0; index < segments.length; index += 1) {
    const part = pattern[index];
    if (part === undefined) return false;
    if (/^\[\.\.\./.test(part)) return true;
    if (!/^\[.*\]$/.test(part) && part !== segments[index]) return false;
  }
  return true;
}
function invalid(message: string): AppPluginBuildError { return new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', message); }
