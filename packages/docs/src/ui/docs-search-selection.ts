/** Short-lived, per-tab search context. Canonical links never contain a reader's query. */
import { emitFrontendCode, FRONTEND_OBS_CODES } from '@zero/framework/react';
import type { DocsSearchResult } from './types';
import { readDocsSearchRoute } from './read-docs-search-results';

export const DOCS_SEARCH_LANDING_EVENT = 'zero-docs-search-landing';
const MAXIMUM_AGE = 5 * 60_000;
export interface DocsSearchSelection {
  readonly basePath: string;
  readonly pageRoute: string;
  readonly route: string;
  readonly pageHash?: string;
  readonly passageId?: string;
  readonly query: string;
  readonly createdAt: number;
}
function key(basePath: string) { return `zero-docs-search:${basePath}`; }
function report(stage: string) {
  emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_DOCS_SEARCH_FAILED, { metadata: { stage } });
}
export function createDocsSearchSelection(basePath: string, result: DocsSearchResult, query: string): DocsSearchSelection {
  return { basePath, pageRoute: result.pageRoute, route: result.route, pageHash: result.pageHash,
    passageId: result.passageId, query: query.trim().slice(0, 200), createdAt: Date.now() };
}
export function rememberDocsSearchSelection(selection: DocsSearchSelection) {
  try { sessionStorage.setItem(key(selection.basePath), JSON.stringify(selection)); }
  catch { report('selection-store'); }
}
export function validDocsSearchSelection(value: unknown, basePath: string, pageRoute: string, pageHash: string, now = Date.now()): value is DocsSearchSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.basePath !== basePath || item.pageRoute !== pageRoute || typeof item.route !== 'string'
    || item.route.length > 6401 || item.route.split('#')[0] !== pageRoute
    || !pageRoute.startsWith('/') || pageRoute.startsWith('//') || /[\\\u0000-\u0020?]/u.test(item.route)
    || !(pageRoute === basePath || pageRoute.startsWith(basePath === '/' ? '/' : `${basePath}/`))
    || typeof item.query !== 'string' || item.query.trim().length < 2 || item.query.length > 200
    || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)
    || now - item.createdAt < 0 || now - item.createdAt > MAXIMUM_AGE) return false;
  try { readDocsSearchRoute(item.route, basePath); readDocsSearchRoute(pageRoute, basePath, true); }
  catch { return false; }
  if (item.pageHash !== undefined && item.pageHash !== pageHash) return false;
  return item.passageId === undefined || typeof item.passageId === 'string' && /^docs-p-\d{1,16}$/u.test(item.passageId);
}
export function consumeDocsSearchSelection(basePath: string, pageRoute: string, pageHash: string): DocsSearchSelection | null {
  try {
    const stored = sessionStorage.getItem(key(basePath));
    if (!stored) return null;
    sessionStorage.removeItem(key(basePath));
    if (stored.length > 16_384) return null;
    const item: unknown = JSON.parse(stored);
    return validDocsSearchSelection(item, basePath, pageRoute, pageHash) ? item : null;
  } catch { report('selection-read'); return null; }
}
