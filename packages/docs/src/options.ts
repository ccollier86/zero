/** Progressive public options for one independent read-only Markdown documentation mount. */
import type { DocsCompilerLimits } from './content/types';
import { docsFailure } from './content/errors';
import { freezeDocsValue, normalizeDocsBasePath } from './content/identity';
import { resolveDocsLimits } from './content/limits';

export interface DocsOptions {
  /** Relative paths resolve against Zero's captured application projectRoot, never process.cwd(). */
  readonly contentDir: string;
  readonly name?: string;
  readonly basePath?: string;
  readonly title?: string;
  readonly include?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly ignoreFile?: string | false;
  readonly allowEmpty?: boolean;
  readonly limits?: DocsCompilerLimits;
  readonly breadcrumbs?: boolean;
  readonly search?: boolean;
  readonly toc?: boolean;
  readonly pageNavigation?: boolean;
  readonly headerLinks?: readonly { readonly label: string; readonly href: string }[];
  /** An explicit public origin/base URL; never inferred from a request's Host header. */
  readonly siteUrl?: string;
  /** Repository directory URL. Each source-relative pathname is encoded and appended on the server. */
  readonly editUrl?: string;
  readonly themeStorageKey?: string;
  /** Development-only file watching; production always consumes compiled artifacts. */
  readonly watch?: boolean;
}
export type ResolvedDocsOptions = Readonly<Omit<DocsOptions, 'name' | 'basePath' | 'title' | 'breadcrumbs' | 'search' | 'toc' | 'pageNavigation' | 'headerLinks' | 'themeStorageKey' | 'watch'> & {
  name: string; basePath: string; title: string; breadcrumbs: boolean; search: boolean;
  toc: boolean; pageNavigation: boolean; headerLinks: readonly { readonly label: string; readonly href: string }[];
  themeStorageKey: string; watch: boolean;
}>;
const KEYS = new Set(['contentDir', 'name', 'basePath', 'title', 'include', 'exclusions', 'ignoreFile', 'allowEmpty', 'limits', 'breadcrumbs', 'search', 'toc', 'pageNavigation', 'headerLinks', 'siteUrl', 'editUrl', 'themeStorageKey', 'watch']);

export function resolveDocsOptions(input: DocsOptions): ResolvedDocsOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !KEYS.has(key))) docsFailure('DOCS_CONFIG_INVALID', 'Documentation options contain an unsupported setting. Protected mounts, versions and executable previews are not enabled by this read-only package.');
  const contentDir = text(input.contentDir, 'contentDir', 4_096);
  const basePath = normalizeDocsBasePath(input.basePath);
  const name = input.name === undefined ? 'zero.docs' + (basePath === '/docs' ? '' : ':' + basePath) : text(input.name, 'name', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/%-]*$/u.test(name)) docsFailure('DOCS_CONFIG_INVALID', 'name must be a bounded plugin identifier.', { field: 'name' });
  const boolean = (key: 'breadcrumbs' | 'search' | 'toc' | 'pageNavigation' | 'watch' | 'allowEmpty', fallback: boolean): boolean => {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') docsFailure('DOCS_CONFIG_INVALID', 'A boolean option was expected.', { field: key });
    return input[key] ?? fallback;
  };
  if (input.ignoreFile !== undefined && input.ignoreFile !== false && typeof input.ignoreFile !== 'string') docsFailure('DOCS_CONFIG_INVALID', 'ignoreFile must be a relative path or false.', { field: 'ignoreFile' });
  for (const key of ['include', 'exclusions'] as const) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key]!.length > 1_000 || input[key]!.some(pattern => typeof pattern !== 'string' || !pattern.trim() || pattern.length > 2_048 || pattern.startsWith('!') || /[\r\n\u0000]/u.test(pattern)))) docsFailure('DOCS_CONFIG_INVALID', 'Publication patterns must be a bounded list of positive Git-style patterns.', { field: key });
  resolveDocsLimits(input.limits);
  if (input.headerLinks !== undefined && (!Array.isArray(input.headerLinks) || input.headerLinks.length > 12)) docsFailure('DOCS_CONFIG_INVALID', 'headerLinks must be a bounded list.', { field: 'headerLinks' });
  const headerLinks = (input.headerLinks ?? []).map(link => {
    if (!link || typeof link !== 'object') docsFailure('DOCS_CONFIG_INVALID', 'A header link requires a label and safe URL.', { field: 'headerLinks' });
    return { label: text(link.label, 'headerLinks.label', 80), href: safeHref(link.href, 'headerLinks.href', true) };
  });
  return freezeDocsValue({ ...input, contentDir, name, basePath, title: input.title === undefined ? 'Documentation' : text(input.title, 'title', 256),
    breadcrumbs: boolean('breadcrumbs', false), search: boolean('search', true), toc: boolean('toc', true),
    pageNavigation: boolean('pageNavigation', true), watch: boolean('watch', true), allowEmpty: boolean('allowEmpty', false), headerLinks,
    ...(input.siteUrl === undefined ? {} : { siteUrl: safeHref(input.siteUrl, 'siteUrl', false).replace(/\/$/u, '') }),
    ...(input.editUrl === undefined ? {} : { editUrl: safeHref(input.editUrl, 'editUrl', false).replace(/\/$/u, '') + '/' }),
    themeStorageKey: input.themeStorageKey === undefined ? 'theme' : text(input.themeStorageKey, 'themeStorageKey', 128),
    ...(input.include ? { include: [...input.include] } : {}), ...(input.exclusions ? { exclusions: [...input.exclusions] } : {}),
    ...(input.limits ? { limits: { ...input.limits } } : {}),
  });
}
/** Defaults use trusted app configuration only, never a request Host or another app's global services. */
export function applyDocsAppDefaults(options: ResolvedDocsOptions, identity: { readonly name?: string; readonly publicUrl?: string }, explicitTitle: boolean): ResolvedDocsOptions {
  return freezeDocsValue({ ...options,
    title: !explicitTitle && identity.name?.trim() ? text(identity.name, 'app.name', 220) + ' Documentation' : options.title,
    ...(options.siteUrl === undefined && identity.publicUrl ? { siteUrl: safeHref(identity.publicUrl, 'app.publicUrl', false).replace(/\/$/u, '') } : {}),
  });
}
function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/u.test(value)) docsFailure('DOCS_CONFIG_INVALID', 'A bounded non-empty string was expected.', { field });
  return value.trim();
}
function safeHref(value: unknown, field: string, local: boolean): string {
  const href = text(value, field, 2_048);
  if (local && href.startsWith('/') && !href.startsWith('//') && !/[\\\s]/u.test(href)) return href;
  try { const url = new URL(href); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !local && (url.hash || url.search)) throw new Error(); return url.href; }
  catch { docsFailure('DOCS_CONFIG_INVALID', 'Use an absolute HTTP(S) URL without credentials, query or fragment.', { field }); }
}
